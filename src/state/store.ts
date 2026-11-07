import { createHash, randomUUID } from "node:crypto";
import type { Plugin } from "@opencode/plugin";

import {
  BUILT_IN_GLOBAL_PREFERENCES,
  INHERITING_SESSION_PREFERENCES,
  type PreferenceView,
  resolvePreferences,
} from "./effective.js";
import {
  CURRENT_SCHEMA_VERSION,
  type GlobalPreferenceChange,
  type GlobalPreferences,
  type PendingNextSession,
  PreferenceStateError,
  type PreferenceStateErrorCode,
  parseGlobalChange,
  parseGlobalPreferences,
  parsePendingNextSession,
  parseSessionChange,
  parseSessionPreferences,
  type SessionPreferenceChange,
  type SessionPreferences,
} from "./schema.js";

export type {
  GlobalPreferenceChange,
  SessionPreferenceChange,
} from "./schema.js";
export { PreferenceStateError } from "./schema.js";

export type PreferenceStorage = Pick<
  Plugin.Context["storage"],
  "get" | "set" | "remove"
>;

// The host's storage is one global key-value space, so keys carry this product's own
// namespace. Session identifiers are hex-encoded: any identifier maps to a key made only of
// lowercase letters, digits, dots and nothing that could collide with another session.
const GLOBAL_KEY = "preferences.v1.global";
const SESSION_KEY_PREFIX = "preferences.v1.session.";
const NEXT_KEY = "preferences.v1.next";
const MAX_SESSION_ID_BYTES = 128;
const SESSION_ID_RULE = `session identifiers must be well-formed text of 1 to ${MAX_SESSION_ID_BYTES} UTF-8 bytes`;

const SESSION_RESET_INTENSITY = "off";
const SESSION_RESET_ADVISOR_MODE = "off";

export type PreferenceSnapshot = {
  readonly revision: string;
  readonly sessionID?: string;
  readonly view: PreferenceView;
};

// What the next session would use. A pending document this build cannot read is reported instead of
// thrown: it is never claimed, so the next session falls back to the defaults, and the panel and the
// status can say why it was ignored.
export type NextSessionState =
  | { readonly status: "none"; readonly view: PreferenceView }
  | {
      readonly status: "pending";
      readonly savedAt: number;
      readonly view: PreferenceView;
    }
  | {
      readonly status: "unreadable";
      readonly code: PreferenceStateErrorCode;
      readonly view: PreferenceView;
    };

export type NextSessionSnapshot = NextSessionState & {
  readonly revision: string;
};

// Why a session did not take the pending setting. Every value is a decision, not an error: the
// setting stays where it is for a session that can claim it.
export type PendingClaim =
  | { readonly claimed: true; readonly view: PreferenceView }
  | {
      readonly claimed: false;
      readonly reason:
        | "no-pending"
        | "unreadable-pending"
        | "unknown-creation-time"
        | "session-created-before-save"
        | "session-has-settings";
    };

export class PreferenceStore {
  readonly #storage: PreferenceStorage;
  readonly #generation = randomUUID();
  #tail: Promise<unknown> = Promise.resolve();

  constructor(storage: PreferenceStorage) {
    this.#storage = storage;
  }

  // Each public operation waits for the previous one on this instance, so two callers on the
  // same instance cannot overwrite each other's confirmed changes. Other instances over the
  // same storage are not coordinated. A storage call that never settles stalls later
  // operations on this instance: the store has no timeout or cancellation.
  readGlobal(): Promise<PreferenceView> {
    return this.#serialize(async () =>
      resolvePreferences(await this.#loadGlobal(), undefined),
    );
  }

  readSession(sessionID: string): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const key = sessionKey(sessionID);
      return resolvePreferences(
        await this.#loadGlobal(),
        await this.#loadSession(key),
      );
    });
  }

  // An editor revision covers the source documents, scope and this store generation, not just the
  // effective values. It is opaque to the TUI and invalid after a restart. This is not host-wide CAS.
  readForEdit(sessionID?: string): Promise<PreferenceSnapshot> {
    return this.#serialize(async () => {
      const key = sessionID === undefined ? undefined : sessionKey(sessionID);
      const global = await this.#loadGlobal();
      const session =
        key === undefined ? undefined : await this.#loadSession(key);
      return {
        revision: this.#revision(global, session, sessionID),
        ...(sessionID === undefined ? {} : { sessionID }),
        view: resolvePreferences(global, session),
      };
    });
  }

  // Preview uses the same parsers as persistence but never writes. Re-reading under the queue also
  // refuses a preview against stale sources rather than validating a silently changed draft.
  previewForEdit(
    revision: string,
    change: unknown,
    sessionID?: string,
  ): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const key = sessionID === undefined ? undefined : sessionKey(sessionID);
      const global = await this.#loadGlobal();
      const session =
        key === undefined ? undefined : await this.#loadSession(key);
      this.#expectRevision(revision, global, session, sessionID);
      return sessionID === undefined
        ? resolvePreferences(
            parseGlobalChange(global ?? BUILT_IN_GLOBAL_PREFERENCES, change),
            undefined,
          )
        : resolvePreferences(
            global,
            parseSessionChange(
              session ?? INHERITING_SESSION_PREFERENCES,
              change,
            ),
          );
    });
  }

  // What the next session would use: the pending setting over the defaults.
  readNext(): Promise<NextSessionState> {
    return this.#serialize(async () => (await this.#loadNext()).state);
  }

  // The pending scope for the editor. Its revision covers the defaults and the stored pending
  // document, including one this build cannot read, so an explicit save can replace a damaged one
  // while a concurrent change to either still refuses the draft.
  readNextForEdit(): Promise<NextSessionSnapshot> {
    return this.#serialize(async () => {
      const { stored, global, state } = await this.#loadNext();
      return { ...state, revision: this.#nextRevision(global, stored) };
    });
  }

  previewNextForEdit(
    revision: string,
    change: unknown,
  ): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const { stored, global } = await this.#loadNext();
      this.#expectNextRevision(revision, global, stored);
      return resolvePreferences(
        global,
        parseSessionChange(INHERITING_SESSION_PREFERENCES, change),
      );
    });
  }

  // The pending setting is written whole. The panel merges its draft over what it read, so a partial
  // change here would drop a value the person did not touch; an empty change removes the document,
  // which is what choosing "follow defaults" in every row means. The previous document is not parsed:
  // the revision already proves it is the one the caller read, and a damaged one must stay
  // replaceable.
  saveNext(
    change: SessionPreferenceChange,
    expectedRevision?: string,
  ): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const { stored, global } = await this.#loadNext();
      if (expectedRevision !== undefined) {
        this.#expectNextRevision(expectedRevision, global, stored);
      }
      const session = parseSessionChange(
        INHERITING_SESSION_PREFERENCES,
        change,
      );
      const scalars = pendingScalars(session);
      if (scalars === undefined) {
        if (stored !== undefined) await this.#remove(NEXT_KEY);
        return resolvePreferences(global, undefined);
      }
      const document: PendingNextSession = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        savedAt: Date.now(),
        change: scalars,
      };
      await this.#write(NEXT_KEY, document);
      return resolvePreferences(global, session);
    });
  }

  // The one place a pending setting becomes a session's own values. The whole decision runs as one
  // queued operation, so two sessions seen at the same moment cannot both claim it: the second finds
  // nothing. `createdAt` is asked only once a readable pending exists, and only from inside the queue,
  // so the creation time is compared against the document this operation is about to consume.
  //
  // The claim writes the session document and then removes the pending one. A removal that fails
  // leaves both, and a later session can claim the setting again; a crash between the two is the same
  // case. Two plugin instances over the same storage are not coordinated at all: the store has no
  // compare-and-set across processes, so both could claim. These are the limits of the host's
  // storage, not of this sequence.
  claimNextSession(
    sessionID: string,
    createdAt: () => Promise<number>,
  ): Promise<PendingClaim> {
    return this.#serialize(async () => {
      const key = sessionKey(sessionID);
      const { stored, global } = await this.#loadNext();
      if (stored === undefined) return { claimed: false, reason: "no-pending" };
      let pending: PendingNextSession;
      try {
        pending = parsePendingNextSession(stored, "stored");
      } catch (error) {
        if (!(error instanceof PreferenceStateError)) throw error;
        return { claimed: false, reason: "unreadable-pending" };
      }

      let created: number;
      try {
        created = await createdAt();
      } catch {
        // Without the host's creation time nothing proves this session is newer than the setting.
        return { claimed: false, reason: "unknown-creation-time" };
      }
      // A session that already existed when the setting was saved has had its turn; the pending waits
      // for one created after it. Equal counts as after: both times come from this process's clock.
      if (!(created >= pending.savedAt)) {
        return { claimed: false, reason: "session-created-before-save" };
      }
      // A session with its own document was edited on purpose; the pending must not overwrite it.
      if ((await this.#loadSession(key)) !== undefined) {
        return { claimed: false, reason: "session-has-settings" };
      }

      const session = parseSessionChange(
        INHERITING_SESSION_PREFERENCES,
        pending.change,
      );
      await this.#write(key, session);
      await this.#remove(NEXT_KEY);
      return { claimed: true, view: resolvePreferences(global, session) };
    });
  }

  // Explicit defaults: this is the only operation that writes the global document. An editor may
  // require its source revision; the check and write are one serialized operation on this instance.
  saveDefaults(
    change: GlobalPreferenceChange,
    expectedRevision?: string,
  ): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const current = await this.#loadGlobal();
      if (expectedRevision !== undefined)
        this.#expectRevision(expectedRevision, current);
      const next = parseGlobalChange(
        current ?? BUILT_IN_GLOBAL_PREFERENCES,
        change,
      );
      await this.#write(GLOBAL_KEY, next);
      return resolvePreferences(next, undefined);
    });
  }

  applySession(
    sessionID: string,
    change: SessionPreferenceChange,
    expectedRevision?: string,
  ): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const key = sessionKey(sessionID);
      const global = await this.#loadGlobal();
      const current = await this.#loadSession(key);
      if (expectedRevision !== undefined)
        this.#expectRevision(expectedRevision, global, current, sessionID);
      const next = parseSessionChange(
        current ?? INHERITING_SESSION_PREFERENCES,
        change,
      );
      await this.#write(key, next);
      return resolvePreferences(global, next);
    });
  }

  clearSession(sessionID: string): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const key = sessionKey(sessionID);
      const global = await this.#loadGlobal();
      if ((await this.#loadSession(key)) !== undefined) {
        await this.#remove(key);
      }
      return resolvePreferences(global, undefined);
    });
  }

  resetSession(sessionID: string): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const key = sessionKey(sessionID);
      const global = await this.#loadGlobal();
      // The stored override is read only so a corrupt document is refused instead of being
      // overwritten. A valid override is replaced: reset returns only intensity and Advisor
      // mode to "off", and every other field inherits again.
      await this.#loadSession(key);
      const next: SessionPreferences = {
        ...INHERITING_SESSION_PREFERENCES,
        intensity: SESSION_RESET_INTENSITY,
        advisorMode: SESSION_RESET_ADVISOR_MODE,
      };
      await this.#write(key, next);
      return resolvePreferences(global, next);
    });
  }

  #revision(
    global: GlobalPreferences | undefined,
    session?: SessionPreferences,
    sessionID?: string,
  ): string {
    return createHash("sha256")
      .update(this.#generation)
      .update(
        JSON.stringify([sessionID ?? null, global ?? null, session ?? null]),
      )
      .digest("hex");
  }

  // The pending revision is separate from the editor's other revisions: the pending scope resolves
  // against the defaults, so a defaults change invalidates its draft too. The stored document is
  // hashed as it is, so a damaged one still has a revision that an explicit save can match.
  #nextRevision(
    global: GlobalPreferences | undefined,
    stored: unknown,
  ): string {
    return createHash("sha256")
      .update(this.#generation)
      .update(JSON.stringify(["next", global ?? null, stored ?? null]))
      .digest("hex");
  }

  #expectNextRevision(
    expected: string,
    global: GlobalPreferences | undefined,
    stored: unknown,
  ): void {
    if (expected !== this.#nextRevision(global, stored)) {
      throw new PreferenceStateError(
        "stale-preferences",
        "the setting for the next session changed or the server restarted; reopen the editor before applying this draft",
      );
    }
  }

  #expectRevision(
    expected: string,
    global: GlobalPreferences | undefined,
    session?: SessionPreferences,
    sessionID?: string,
  ): void {
    if (expected !== this.#revision(global, session, sessionID)) {
      throw new PreferenceStateError(
        "stale-preferences",
        "the saved settings changed or the server restarted; reopen the editor before applying this draft",
      );
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #loadGlobal(): Promise<GlobalPreferences | undefined> {
    const stored = await this.#read(GLOBAL_KEY, "global");
    return stored === undefined
      ? undefined
      : parseGlobalPreferences(stored, "stored");
  }

  async #loadNext(): Promise<{
    readonly stored: unknown;
    readonly global: GlobalPreferences | undefined;
    readonly state: NextSessionState;
  }> {
    const global = await this.#loadGlobal();
    const stored = await this.#read(NEXT_KEY, "pending");
    const fallback: PreferenceView = resolvePreferences(global, undefined);
    if (stored === undefined) {
      return { stored, global, state: { status: "none", view: fallback } };
    }
    try {
      const pending = parsePendingNextSession(stored, "stored");
      return {
        stored,
        global,
        state: {
          status: "pending",
          savedAt: pending.savedAt,
          view: resolvePreferences(
            global,
            parseSessionChange(INHERITING_SESSION_PREFERENCES, pending.change),
          ),
        },
      };
    } catch (error) {
      if (!(error instanceof PreferenceStateError)) throw error;
      return {
        stored,
        global,
        state: { status: "unreadable", code: error.code, view: fallback },
      };
    }
  }

  async #loadSession(key: string): Promise<SessionPreferences | undefined> {
    const stored = await this.#read(key, "session");
    return stored === undefined
      ? undefined
      : parseSessionPreferences(stored, "stored");
  }

  async #read(
    key: string,
    scope: "global" | "session" | "pending",
  ): Promise<unknown> {
    try {
      return await this.#storage.get(key);
    } catch (error) {
      throw new PreferenceStateError(
        "storage-read-failed",
        `${scope} preferences could not be read`,
        { cause: error },
      );
    }
  }

  // The caller receives a view only after the host accepts the write. A rejection does not
  // prove the host kept the previous document, so the error is marked as uncertain.
  async #write(
    key: string,
    document: GlobalPreferences | SessionPreferences | PendingNextSession,
  ): Promise<void> {
    try {
      await this.#storage.set(key, document);
    } catch (error) {
      throw new PreferenceStateError(
        "storage-write-failed",
        "preferences could not be saved; the host may have stored the change, so read the preferences again before relying on them",
        { cause: error, persistence: "unknown" },
      );
    }
  }

  async #remove(key: string): Promise<void> {
    try {
      await this.#storage.remove(key);
    } catch (error) {
      throw new PreferenceStateError(
        "storage-write-failed",
        "preferences could not be removed; the host may have removed the override, so read the preferences again before relying on them",
        { cause: error, persistence: "unknown" },
      );
    }
  }
}

// The scalars of a session document, which are exactly what a pending setting holds. Undefined when
// every one of them inherits.
function pendingScalars(
  session: SessionPreferences,
): SessionPreferenceChange | undefined {
  const change: SessionPreferenceChange = {
    ...(session.intensity === "inherit"
      ? {}
      : { intensity: session.intensity }),
    ...(session.advisorMode === "inherit"
      ? {}
      : { advisorMode: session.advisorMode }),
    ...(session.preference === "inherit"
      ? {}
      : { preference: session.preference }),
  };
  return Object.keys(change).length === 0 ? undefined : change;
}

// Only text names a session. Numbers and null would otherwise be coerced into the key of a
// string with the same spelling, and a lone surrogate would be replaced by U+FFFD and collide
// with that character. Both are rejected before any storage call.
function sessionKey(sessionID: unknown): string {
  if (typeof sessionID !== "string" || !sessionID.isWellFormed()) {
    throw new PreferenceStateError("invalid-session-id", SESSION_ID_RULE);
  }
  const bytes = new TextEncoder().encode(sessionID);
  if (bytes.length === 0 || bytes.length > MAX_SESSION_ID_BYTES) {
    throw new PreferenceStateError("invalid-session-id", SESSION_ID_RULE);
  }
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${SESSION_KEY_PREFIX}${hex}`;
}
