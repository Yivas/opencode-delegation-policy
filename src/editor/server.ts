import {
  type DelegateCommandPorts,
  describePreferenceView,
} from "../command/delegate.js";
import {
  BUILT_IN_GLOBAL_PREFERENCES,
  INHERITING_SESSION_PREFERENCES,
  type PreferenceView,
} from "../state/effective.js";
import {
  type GlobalPreferenceChange,
  PreferenceStateError,
  parseGlobalChange,
  parseSessionChange,
  type SessionPreferenceChange,
} from "../state/schema.js";
import type { PreferenceStore } from "../state/store.js";
import { isPlainRecord } from "../thinking/protocols.js";
import { listEditorModels } from "../validation/models.js";
import type {
  EditorFailure,
  EditorReply,
  EditorSnapshot,
  EditorTarget,
} from "./contract.js";

export type EditorPorts = Omit<DelegateCommandPorts, "store"> & {
  readonly store: PreferenceStore;
};

function target(value: unknown): EditorTarget {
  if (!isPlainRecord(value)) throw new Error("invalid editor request");
  const { scope, sessionID } = value;
  if (scope === "defaults" && sessionID === undefined) return { scope };
  if (scope === "session" && typeof sessionID === "string" && sessionID !== "")
    return { scope, sessionID };
  throw new Error("invalid editor target");
}

function revision(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new Error("invalid editor revision");
  return value;
}

// These assertions use the persistence parsers, not a second interpretation of the change schema.
function requireDefaults(
  change: unknown,
): asserts change is GlobalPreferenceChange {
  parseGlobalChange(BUILT_IN_GLOBAL_PREFERENCES, change);
}
function requireSession(
  change: unknown,
): asserts change is SessionPreferenceChange {
  parseSessionChange(INHERITING_SESSION_PREFERENCES, change);
  if (
    !isPlainRecord(change) ||
    Object.keys(change).some(
      (key) => !["intensity", "advisorMode", "preference"].includes(key),
    )
  ) {
    throw new PreferenceStateError(
      "invalid-change",
      "session edits can change only intensity, Advisor mode and preference; configure models in the defaults",
    );
  }
}

function failure(error: unknown, mayHaveWritten: boolean): EditorFailure {
  if (error instanceof PreferenceStateError) {
    return {
      ok: false,
      persistence: error.persistence === "unknown" ? "unknown" : "unchanged",
      text: `${error.persistence === "unknown" ? "Could not confirm the save" : "Not applied"}: ${error.message}`,
    };
  }
  return {
    ok: false,
    persistence: mayHaveWritten ? "unknown" : "unchanged",
    text: mayHaveWritten
      ? "The save result could not be confirmed. Reopen /delegate status before relying on the settings."
      : "The delegation editor could not read or validate this request. Nothing was changed. Reopen /delegate and try again.",
  };
}

export function createPreferenceEditor(ports: EditorPorts) {
  const confirmSession = async (scope: EditorTarget) => {
    if (scope.scope !== "session") return;
    if (
      scope.sessionID === undefined ||
      ports.sessionExists === undefined ||
      !(await ports.sessionExists(scope.sessionID))
    ) {
      throw new PreferenceStateError(
        "invalid-session-id",
        "the host could not confirm the editor's session; nothing was changed",
      );
    }
  };
  return {
    async read(input: unknown): Promise<EditorSnapshot | EditorFailure> {
      try {
        const scope = target(input);
        await confirmSession(scope);
        const snapshot = await ports.store.readForEdit(scope.sessionID);
        // Catalogue failure does not prevent disabling settings. Model selection simply has no
        // candidates; the preview still reports the validator's unavailable-catalogue diagnostic.
        let models: EditorSnapshot["models"] = [];
        let catalogueNote = "";
        try {
          models = await listEditorModels(ports.catalog);
        } catch {
          catalogueNote =
            "\nModel catalogue unavailable; model selection has no candidates.";
        }
        return {
          ok: true,
          ...scope,
          revision: snapshot.revision,
          view: snapshot.view,
          models,
          text:
            (await describePreferenceView(
              snapshot.view,
              ports,
              scope.scope === "defaults"
                ? "Defaults editor:"
                : "This session's editor:",
            )) + catalogueNote,
        };
      } catch (error) {
        return failure(error, false);
      }
    },
    async preview(input: unknown): Promise<EditorReply> {
      try {
        const scope = target(input);
        await confirmSession(scope);
        if (!isPlainRecord(input)) throw new Error("invalid editor request");
        const expected = revision(input.revision);
        const change = input.change;
        if (scope.scope === "defaults") requireDefaults(change);
        else requireSession(change);
        const view = await ports.store.previewForEdit(
          expected,
          change,
          scope.sessionID,
        );
        return {
          ok: true,
          ...scope,
          text: await describePreferenceView(
            view,
            ports,
            "Draft preview; nothing has been saved:",
          ),
        };
      } catch (error) {
        return failure(error, false);
      }
    },
    async apply(input: unknown): Promise<EditorReply> {
      let mayHaveWritten = false;
      try {
        const scope = target(input);
        await confirmSession(scope);
        if (!isPlainRecord(input)) throw new Error("invalid editor request");
        const expected = revision(input.revision);
        const change = input.change;
        let view: PreferenceView;
        if (scope.scope === "defaults") {
          requireDefaults(change);
          mayHaveWritten = true;
          view = await ports.store.saveDefaults(change, expected);
        } else {
          requireSession(change);
          if (scope.sessionID === undefined)
            throw new Error("missing editor session");
          mayHaveWritten = true;
          view = await ports.store.applySession(
            scope.sessionID,
            change,
            expected,
          );
        }
        return {
          ok: true,
          ...scope,
          text: await describePreferenceView(
            view,
            ports,
            scope.scope === "defaults"
              ? "Defaults saved."
              : "This session, saved:",
          ),
        };
      } catch (error) {
        return failure(error, mayHaveWritten);
      }
    },
  };
}
