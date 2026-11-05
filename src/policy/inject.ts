import { reservedAgentIDs } from "../agents/ids.js";
import { PreferenceStateError } from "../state/schema.js";
import type { PreferenceStore } from "../state/store.js";
import {
  type ModelCatalog,
  validatePreferenceAxes,
} from "../validation/models.js";
import { OWNED_MARKER, renderDelegationPolicy } from "./render.js";

// Puts the policy block into the main agent's requests, and nowhere else. It only edits the system
// parts of the request it is handed: never the model, the tools, the messages or any permission.
//
// Where it runs, decided with the Advisors on 2026-11-05: the `context` hook only. Compaction is left
// alone because a summary model should not follow delegation rules and the next turn carries the
// block again; `generate` waits until the host shows it is a user-turn path. Child sessions never get
// the block: a delegated child must not delegate or consult.

export const POLICY_METADATA_KEY = "opencode-delegation-policy";

type SystemPart = {
  readonly type: "text";
  readonly text: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

function isOwned(part: {
  readonly text?: unknown;
  readonly metadata?: unknown;
}) {
  const metadata = part.metadata;
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>)[POLICY_METADATA_KEY] === true
  ) {
    return true;
  }
  return typeof part.text === "string" && part.text.includes(OWNED_MARKER);
}

// Removes every block this plugin added before and appends the current one, if any. Running it twice
// on the same parts leaves exactly one block. Appending keeps the parts before it, which other
// instructions and the provider's prompt cache depend on, exactly as they were.
export function replacePolicyBlock(
  system: SystemPart[],
  block: string | undefined,
): void {
  for (let index = system.length - 1; index >= 0; index -= 1) {
    const part = system[index];
    if (part !== undefined && isOwned(part)) system.splice(index, 1);
  }
  if (block !== undefined) {
    system.push({
      type: "text",
      text: block,
      metadata: { [POLICY_METADATA_KEY]: true },
    });
  }
}

// What happened on the latest request, for the status. A missing block is otherwise invisible, and
// "nothing active" and "could not read the preferences" must not look the same.
export type InjectionReport =
  | { readonly outcome: "none-yet" }
  | { readonly outcome: "injected" }
  | {
      readonly outcome: "skipped";
      readonly reason: "plugin-agent" | "child-session" | "nothing-active";
    }
  | {
      readonly outcome: "failed";
      readonly reason:
        | "session-lookup"
        | "preferences-unreadable"
        | "unexpected-error";
    };

export type InjectorPorts = {
  readonly store: Pick<PreferenceStore, "readSession">;
  readonly catalog: ModelCatalog;
  // Only `parentID` is read. A child is a session launched from another; it never changes parents.
  readonly session: (
    sessionID: string,
  ) => Promise<{ readonly parentID?: string | undefined }>;
};

export type PolicyInjector = {
  apply(request: {
    readonly sessionID: string;
    readonly agent: string;
    system: SystemPart[];
  }): Promise<void>;
  last(): InjectionReport;
};

export function createPolicyInjector(ports: InjectorPorts): PolicyInjector {
  // A session's parent is fixed when it is created, so the lookup is kept for the plugin's lifetime.
  const roots = new Map<string, boolean>();
  let report: InjectionReport = { outcome: "none-yet" };

  async function isRoot(sessionID: string): Promise<boolean> {
    const known = roots.get(sessionID);
    if (known !== undefined) return known;
    const info = await ports.session(sessionID);
    const root = info.parentID === undefined || info.parentID === "";
    roots.set(sessionID, root);
    return root;
  }

  return {
    async apply(request) {
      // The previous block goes first, so a request that fails below never keeps a stale one.
      replacePolicyBlock(request.system, undefined);

      if (reservedAgentIDs().includes(request.agent)) {
        report = { outcome: "skipped", reason: "plugin-agent" };
        return;
      }

      let root: boolean;
      try {
        root = await isRoot(request.sessionID);
      } catch {
        report = { outcome: "failed", reason: "session-lookup" };
        return;
      }
      if (!root) {
        report = { outcome: "skipped", reason: "child-session" };
        return;
      }

      // A hook that throws could break the person's request, so every failure ends here with no
      // block, as Pi injects nothing on error. The status says which failure it was.
      let block: string | undefined;
      try {
        const { preferences } = await ports.store.readSession(
          request.sessionID,
        );
        const validation = await validatePreferenceAxes({
          preferences,
          catalog: ports.catalog,
        });
        block = renderDelegationPolicy({ preferences, validation });
      } catch (error) {
        report = {
          outcome: "failed",
          reason:
            error instanceof PreferenceStateError
              ? "preferences-unreadable"
              : "unexpected-error",
        };
        return;
      }

      replacePolicyBlock(request.system, block);
      report =
        block === undefined
          ? { outcome: "skipped", reason: "nothing-active" }
          : { outcome: "injected" };
    },
    last: () => report,
  };
}
