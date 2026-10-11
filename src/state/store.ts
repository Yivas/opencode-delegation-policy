import type { Plugin } from "@opencode/plugin";

import {
  BUILT_IN_GLOBAL_PREFERENCES,
  INHERITING_SESSION_PREFERENCES,
  type PreferenceView,
  resolvePreferences,
} from "./effective.js";
import {
  type GlobalPreferenceChange,
  type GlobalPreferences,
  PreferenceStateError,
  parseGlobalChange,
  parseGlobalPreferences,
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
const MAX_SESSION_ID_BYTES = 128;
const SESSION_ID_RULE = `session identifiers must be well-formed text of 1 to ${MAX_SESSION_ID_BYTES} UTF-8 bytes`;

const SESSION_RESET_INTENSITY = "off";
const SESSION_RESET_ADVISOR_MODE = "off";

export class PreferenceStore {
  readonly #storage: PreferenceStorage;
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

  // Explicit defaults: this is the only operation that writes the global document.
  saveDefaults(change: GlobalPreferenceChange): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const current = (await this.#loadGlobal()) ?? BUILT_IN_GLOBAL_PREFERENCES;
      const next = parseGlobalChange(current, change);
      await this.#write(GLOBAL_KEY, next);
      return resolvePreferences(next, undefined);
    });
  }

  applySession(
    sessionID: string,
    change: SessionPreferenceChange,
  ): Promise<PreferenceView> {
    return this.#serialize(async () => {
      const key = sessionKey(sessionID);
      const global = await this.#loadGlobal();
      const current =
        (await this.#loadSession(key)) ?? INHERITING_SESSION_PREFERENCES;
      const next = parseSessionChange(current, change);
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

  async #loadSession(key: string): Promise<SessionPreferences | undefined> {
    const stored = await this.#read(key, "session");
    return stored === undefined
      ? undefined
      : parseSessionPreferences(stored, "stored");
  }

  async #read(key: string, scope: "global" | "session"): Promise<unknown> {
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
    document: GlobalPreferences | SessionPreferences,
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
