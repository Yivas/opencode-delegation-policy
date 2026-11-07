// The interactive way into `/delegate`: one host dialog that lists every setting with its effective
// value, edits a local draft and saves it through the same server path as the typed commands. It
// adds discoverability, not a second implementation: the grammar, validation and storage stay where
// they are, and closing without saving changes nothing.
// It uses only the host's promise dialogs, so it needs no UI library at runtime.

import {
  display,
  type EditorChangeRequest,
  type EditorClient,
  type EditorDialogs,
  parseRead,
  parseReply,
  type SelectOption,
} from "./editor/client.js";
import type {
  EditorModel,
  EditorReply,
  EditorScope,
  EditorSnapshot,
  EditorTarget,
} from "./editor/contract.js";
import type { PreferenceSource, PreferenceView } from "./state/effective.js";
import {
  ADVISOR_MODES,
  type AdvisorMode,
  type AdvisorsSetting,
  type GlobalPreferenceChange,
  INTENSITIES,
  type Intensity,
  MAX_ADVISORS,
  PREFERENCES,
  type Preference,
  ROLE_KEYS,
  type RoleKey,
  type RoleSetting,
  type SessionPreferenceChange,
  type ThinkingSetting,
} from "./state/schema.js";
import { THINKING_LEVELS } from "./thinking/levels.js";

const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  visualDesign: "Visual Design",
};

// One value column for every row, wide enough for the longest label plus two spaces. The width is
// fixed by the label set, not by the rows on screen, so hiding a thinking row never moves the
// values of the rows below it.
const LABELS = [
  "Intensity",
  "Advisor mode",
  "Preference",
  ...ROLE_KEYS.flatMap((role) => [
    ROLE_LABELS[role],
    `${ROLE_LABELS[role]} thinking`,
  ]),
  ...Array.from(
    { length: MAX_ADVISORS },
    (_unused, index) => `Advisor ${index + 1}`,
  ),
];
const VALUE_COLUMN = Math.max(...LABELS.map((label) => label.length)) + 2;

function row(label: string, value: string): string {
  return `${label.padEnd(VALUE_COLUMN)}${value}`;
}

const SOURCES: Readonly<Record<PreferenceSource, string>> = {
  default: "built-in",
  global: "defaults",
  session: "this session",
};

function provenance(source: PreferenceSource, changed: boolean): string {
  return changed ? `${SOURCES[source]} · changed` : SOURCES[source];
}

function roleText(setting: RoleSetting): string {
  return setting.kind === "configured"
    ? display(setting.model)
    : setting.kind === "disabled"
      ? "off"
      : "not set";
}

function roleValue(setting: RoleSetting): string {
  return setting.kind === "configured"
    ? setting.model
    : setting.kind === "disabled"
      ? "off"
      : "unset";
}

function thinkingText(setting: ThinkingSetting): string {
  return setting.kind === "fixed"
    ? display(setting.level)
    : setting.kind === "range"
      ? `${display(setting.from)}..${display(setting.to)}`
      : "per launch";
}

// The draft holds only what the person changed. Scalars may inherit in a session; models, thinking
// and Advisors exist only in the defaults, so a session can draft them but not apply them.
type PanelDraft = {
  readonly intensity?: Intensity | "inherit";
  readonly advisorMode?: AdvisorMode | "inherit";
  readonly preference?: Preference | "inherit";
  readonly roles?: Readonly<Partial<Record<RoleKey, RoleSetting>>>;
  readonly thinking?: Readonly<Partial<Record<RoleKey, ThinkingSetting>>>;
  readonly advisors?: AdvisorsSetting;
};

type PanelState = {
  readonly defaults: EditorSnapshot;
  readonly session?: EditorSnapshot;
};

function effective(state: PanelState): EditorSnapshot {
  return state.session ?? state.defaults;
}

function hasDraft(draft: PanelDraft): boolean {
  return Object.keys(draft).length > 0;
}

function sessionChange(draft: PanelDraft): SessionPreferenceChange | undefined {
  const change: SessionPreferenceChange = {
    ...(draft.intensity === undefined ? {} : { intensity: draft.intensity }),
    ...(draft.advisorMode === undefined
      ? {}
      : { advisorMode: draft.advisorMode }),
    ...(draft.preference === undefined ? {} : { preference: draft.preference }),
  };
  return Object.keys(change).length === 0 ? undefined : change;
}

function defaultsChange(draft: PanelDraft): GlobalPreferenceChange | undefined {
  // A session value that inherits has nothing to save in the defaults.
  const change: GlobalPreferenceChange = {
    ...(draft.intensity === undefined || draft.intensity === "inherit"
      ? {}
      : { intensity: draft.intensity }),
    ...(draft.advisorMode === undefined || draft.advisorMode === "inherit"
      ? {}
      : { advisorMode: draft.advisorMode }),
    ...(draft.preference === undefined || draft.preference === "inherit"
      ? {}
      : { preference: draft.preference }),
    ...(draft.roles === undefined ? {} : { roles: draft.roles }),
    ...(draft.thinking === undefined ? {} : { thinking: draft.thinking }),
    ...(draft.advisors === undefined ? {} : { advisors: draft.advisors }),
  };
  return Object.keys(change).length === 0 ? undefined : change;
}

// What a successful save has already stored. A defaults save stores every concrete scalar and every
// model row; an inherit marker and the other scope's pending changes stay in the draft. A scalar the
// open session overrides also stays: the defaults took it, but the session still shows its own value,
// so the draft keeps it ready for `Apply to this session` instead of dropping it unseen.
function clearSaved(
  draft: PanelDraft,
  scope: EditorScope,
  session?: PreferenceView["provenance"],
): PanelDraft {
  if (scope === "session")
    return {
      ...(draft.roles === undefined ? {} : { roles: draft.roles }),
      ...(draft.thinking === undefined ? {} : { thinking: draft.thinking }),
      ...(draft.advisors === undefined ? {} : { advisors: draft.advisors }),
    };
  const keep = (field: "intensity" | "advisorMode" | "preference") =>
    draft[field] !== undefined &&
    (draft[field] === "inherit" || session?.[field] === "session");
  return {
    ...(keep("intensity") ? { intensity: draft.intensity } : {}),
    ...(keep("advisorMode") ? { advisorMode: draft.advisorMode } : {}),
    ...(keep("preference") ? { preference: draft.preference } : {}),
  };
}

function scalarOptions<T extends string>(
  values: readonly T[],
  inherited: T | undefined,
): SelectOption<T | "inherit">[] {
  return [
    ...(inherited === undefined
      ? []
      : [
          {
            title: `follow defaults (${inherited})`,
            value: "inherit" as const,
            description: "Drop this session's value and follow the defaults.",
          },
        ]),
    ...values.map((value) => ({ title: value, value })),
  ];
}

function levelOptions<T extends string>(
  values: readonly T[],
): SelectOption<T>[] {
  return values.map((value) => ({ title: value, value }));
}

async function chooseModel(
  dialogs: EditorDialogs,
  models: readonly EditorModel[],
  title: string,
  current: string | undefined,
): Promise<string | undefined> {
  // A stored reference may carry a variant; the host's search lists base models, so the current
  // entry is matched without it and the variant step keeps the full reference.
  const base = current?.split("#")[0];
  const chosen = await dialogs.select({
    title,
    options: [
      {
        title: "off",
        value: "off",
        description:
          "Disable this role, or remove this Advisor from the draft.",
      },
      {
        title: "not set",
        value: "unset",
        description:
          "No model configured; ordinary roles must be explicitly off or configured.",
      },
      ...models.map((model) => ({
        title: display(model.reference),
        value: model.reference,
        description: `${model.variants.length} proven variants`,
      })),
    ],
    ...(base === undefined ? {} : { current: base }),
  });
  if (chosen === undefined || chosen === "off" || chosen === "unset")
    return chosen;
  const model = models.find((entry) => entry.reference === chosen);
  if (model === undefined) throw new Error("unknown editor model choice");
  if (model.variants.length === 0) return model.reference;
  return dialogs.select({
    title: `Default variant for ${display(model.reference)}`,
    options: [
      {
        title: "choose per launch",
        value: model.reference,
        description:
          "No default variant; the policy still lists proven choices.",
      },
      ...model.variants.map((id) => ({
        title: display(id),
        value: `${model.reference}#${id}`,
      })),
    ],
    current:
      current?.startsWith(`${model.reference}#`) === true
        ? current
        : model.reference,
  });
}

function thinkingChoice(setting: ThinkingSetting): string {
  if (setting.kind === "fixed") return `fixed:${setting.level}`;
  return setting.kind === "range" ? "range" : "unset";
}

// One list holds every choice: per launch, each level as a fixed policy, and a range that asks for
// its two bounds. A second level list would make "per launch" and "fixed" look like the same step.
async function chooseThinking(
  dialogs: EditorDialogs,
  title: string,
  current: ThinkingSetting,
): Promise<ThinkingSetting | undefined> {
  const choice = await dialogs.select({
    title,
    options: [
      {
        title: "per launch",
        value: "unset",
        description:
          "The policy lists its proven levels and one is chosen per launch.",
      },
      ...THINKING_LEVELS.map((level) => ({
        title: level,
        value: `fixed:${level}`,
        description: "Use this level for every launch.",
      })),
      {
        title: "range…",
        value: "range",
        description: "Choose an inclusive lowest and highest level.",
      },
    ],
    current: thinkingChoice(current),
  });
  if (choice === undefined) return undefined;
  if (choice === "unset") return { kind: "unset" };
  if (choice !== "range")
    return { kind: "fixed", level: choice.slice("fixed:".length) };
  const from = await dialogs.select({
    title: "Lowest thinking level",
    options: levelOptions(THINKING_LEVELS),
  });
  if (from === undefined) return undefined;
  const to = await dialogs.select({
    title: "Highest thinking level (inclusive)",
    options: levelOptions(THINKING_LEVELS.slice(THINKING_LEVELS.indexOf(from))),
  });
  return to === undefined ? undefined : { kind: "range", from, to };
}

function roleSetting(value: string): RoleSetting {
  if (value === "off") return { kind: "disabled" };
  if (value === "unset") return { kind: "unset" };
  return { kind: "configured", model: value };
}

function roleIn(action: string, prefix: string): RoleKey | undefined {
  return ROLE_KEYS.find((role) => action === `${prefix}:${role}`);
}

class SessionChanged extends Error {}
class ReadFailure extends Error {}

export type DelegatePanelPorts = {
  readonly client: EditorClient;
  readonly dialogs: EditorDialogs;
  readonly sessionID: () => string | undefined;
  // A typed `/delegate` line, answered by the server for the panel's own scope. Status and the local
  // log read through it so the panel and the typed commands cannot drift apart.
  readonly run: (line: string, target: EditorTarget) => Promise<string>;
};

// The draft is local and disposable. Only Apply and Save call the mutating RPC, and each of them
// previews the same draft, scope and revision first. The host owns every dialog, its keyboard
// interaction and presentation; this module adds no Solid runtime or separate renderer.
// Names what failed without echoing host text: an RPC error's type code, or this client's own fixed
// validation message. Anything else is reported only by its kind.
function failureKind(error: unknown): string {
  if (typeof error === "object" && error !== null && "type" in error) {
    const type = (error as { type: unknown }).type;
    if (typeof type === "string" && /^[\w.-]{1,64}$/.test(type))
      return `RPC ${type}`;
  }
  if (
    error instanceof Error &&
    /^(invalid|missing|wrong) editor [\w ]{1,40}$/.test(error.message)
  )
    return error.message;
  return error instanceof Error ? error.name : typeof error;
}

export async function runDelegatePanel(
  target: EditorTarget,
  ports: DelegatePanelPorts,
): Promise<void> {
  let openedSession: string | undefined;
  const ensureSession = () => {
    if (ports.sessionID() !== openedSession) throw new SessionChanged();
  };
  const dialogs: EditorDialogs = {
    select: async (input) => {
      const value = await ports.dialogs.select(input);
      ensureSession();
      return value;
    },
    prompt: async (input) => {
      const value = await ports.dialogs.prompt(input);
      ensureSession();
      return value;
    },
    confirm: async (input) => {
      const value = await ports.dialogs.confirm(input);
      ensureSession();
      return value;
    },
    alert: async (input) => {
      await ports.dialogs.alert(input);
      ensureSession();
    },
  };
  let draft: PanelDraft = {};
  // An unconfirmed save may already be stored; a refused or unread one leaves the revision in hand
  // possibly stale. Both block writing until a read succeeds, so a conflict is never overwritten.
  let unconfirmed = false;
  let stale = false;
  // A refused preview may be a validation error or a stale revision. Saving stays possible, so a
  // corrected draft needs no reload, but Reload is offered in case the settings moved meanwhile.
  let offerReload = false;
  let saved = false;
  let focused: string | undefined;

  const readScope = async (scope: EditorTarget): Promise<EditorSnapshot> => {
    const read = parseRead(await ports.client.read(scope), scope);
    ensureSession();
    if (!read.ok) throw new ReadFailure(read.text);
    return read.snapshot;
  };
  const loadState = async (): Promise<PanelState> => {
    const defaults = await readScope({ scope: "defaults" });
    if (target.scope !== "session") return { defaults };
    return { defaults, session: await readScope(target) };
  };
  const edit = (next: PanelDraft) => {
    draft = next;
    saved = false;
  };

  try {
    openedSession = ports.sessionID();
    if (target.scope === "session" && target.sessionID !== openedSession)
      throw new SessionChanged();
    let state: PanelState;
    try {
      state = await loadState();
    } catch (error) {
      ensureSession();
      await dialogs.alert({
        title: "Delegation",
        message:
          error instanceof ReadFailure
            ? error.message
            : `The saved settings could not be read. Nothing was changed. Reopen /delegate and try again. (${failureKind(error)})`,
      });
      return;
    }

    for (;;) {
      ensureSession();
      const shown = effective(state).view;
      const base = shown.preferences;
      const sources = shown.provenance;
      const advisors = draft.advisors ?? base.advisors;
      const advisorModels =
        advisors.kind === "configured" ? advisors.models : [];
      const scalarChanged =
        draft.intensity !== undefined ||
        draft.advisorMode !== undefined ||
        draft.preference !== undefined;
      const modelsChanged =
        draft.roles !== undefined ||
        draft.thinking !== undefined ||
        draft.advisors !== undefined;
      const blocked = unconfirmed || stale;
      const blockedReason = unconfirmed
        ? "The last save could not be confirmed; reload the saved settings first."
        : "The saved settings changed; reload them before saving this draft.";

      const rows: SelectOption<string>[] = [
        {
          title: row("Intensity", draft.intensity ?? base.intensity),
          value: "intensity",
          footer: provenance(sources.intensity, draft.intensity !== undefined),
        },
        {
          title: row("Advisor mode", draft.advisorMode ?? base.advisorMode),
          value: "advisorMode",
          footer: provenance(
            sources.advisorMode,
            draft.advisorMode !== undefined,
          ),
        },
        {
          title: row("Preference", draft.preference ?? base.preference),
          value: "preference",
          footer: provenance(
            sources.preference,
            draft.preference !== undefined,
          ),
        },
      ];
      for (const role of ROLE_KEYS) {
        const setting = draft.roles?.[role] ?? base.roles[role];
        rows.push({
          title: row(ROLE_LABELS[role], roleText(setting)),
          value: `role:${role}`,
          footer: provenance(
            sources.roles[role],
            draft.roles?.[role] !== undefined,
          ),
        });
        if (setting.kind !== "configured") continue;
        const thinking = draft.thinking?.[role] ?? base.thinking[role];
        rows.push({
          title: row(`${ROLE_LABELS[role]} thinking`, thinkingText(thinking)),
          value: `thinking:${role}`,
          footer: provenance(
            sources.thinking[role],
            draft.thinking?.[role] !== undefined,
          ),
        });
      }
      advisorModels.forEach((model, index) => {
        rows.push({
          title: row(`Advisor ${index + 1}`, display(model)),
          value: `advisor:${index}`,
          footer: provenance(sources.advisors, draft.advisors !== undefined),
        });
      });
      if (advisorModels.length < MAX_ADVISORS)
        rows.push({
          title: row(`Advisor ${advisorModels.length + 1}`, "add"),
          value: "advisor:add",
          footer: provenance(sources.advisors, draft.advisors !== undefined),
        });

      const saveable = defaultsChange(draft) !== undefined;
      const actions: SelectOption<string>[] = [];
      // The host hides disabled options, and a save action that comes and goes reads as missing. Both
      // stay listed, as in Pi; one that has nothing it may save says so and does nothing. Only an
      // uncertain or stale save hides them, and Reload then carries the reason.
      const applyNote = modelsChanged
        ? "models save only as defaults"
        : scalarChanged
          ? "intensity, Advisor mode and preference"
          : "no changes";
      if (target.scope === "session")
        actions.push({
          title: "Apply to this session",
          value: "apply",
          disabled: blocked,
          description: `(${applyNote})`,
        });
      actions.push({
        title: "Save as defaults",
        value: "save",
        disabled: blocked,
        description: saveable
          ? "(models and Advisors need a restart)"
          : "(no changes)",
      });
      if (blocked || offerReload)
        actions.push({
          title: "Reload saved settings",
          value: "reload",
          description: blocked
            ? `${blockedReason} The draft is kept.`
            : "Read the saved settings again; the draft is kept.",
        });
      actions.push(
        {
          title: "Status",
          value: "status",
          description: "Show the settings and whether they work.",
        },
        {
          title: "Local log",
          value: "log",
          description: "Newest entries of the local log.",
        },
        { title: "Close", value: "close" },
      );

      const options = [...rows, ...actions];
      const current = options.some(
        (option) => option.value === focused && !option.disabled,
      )
        ? focused
        : undefined;
      const action = await dialogs.select({
        title: `Delegation · ${target.scope === "session" ? "this session" : "defaults"}${hasDraft(draft) ? " · modified" : ""}${saved ? " · saved" : ""}`,
        options,
        ...(current === undefined ? {} : { current }),
      });
      focused = action;

      if (action === undefined || action === "close") {
        if (
          !hasDraft(draft) ||
          (await dialogs.confirm({
            title: "Discard delegation changes?",
            message: unconfirmed
              ? "The last save is unconfirmed and may have persisted. Close this panel and discard its local draft? Check status before relying on the settings."
              : "The draft has not been saved. Discard it and close?",
            label: { confirm: "Discard", cancel: "Keep editing" },
          })) === true
        )
          return;
        continue;
      }

      if (action === "status" || action === "log") {
        await dialogs.alert({
          title: "Delegation",
          message: await ports.run(action, target),
        });
        continue;
      }

      if (action === "reload") {
        try {
          state = await loadState();
          unconfirmed = false;
          stale = false;
          offerReload = false;
          await dialogs.alert({
            title: "Saved settings reloaded; draft kept",
            message:
              "The panel now shows the saved settings. Review the draft before saving it.",
          });
        } catch (error) {
          ensureSession();
          await dialogs.alert({
            title: "Delegation",
            message:
              error instanceof ReadFailure
                ? error.message
                : "The saved settings could not be reloaded. The draft and its previous save status are kept. Try Reload again or close with discard confirmation.",
          });
        }
        continue;
      }

      if (action === "apply" || action === "save") {
        const scope: EditorScope = action === "apply" ? "session" : "defaults";
        const change =
          scope === "session" ? sessionChange(draft) : defaultsChange(draft);
        const source = scope === "session" ? state.session : state.defaults;
        if (scope === "session" && modelsChanged) {
          await dialogs.alert({
            title: "Delegation",
            message:
              "Models, thinking and Advisors are shared by every session. Use Save as defaults, then restart OpenCode.",
          });
          continue;
        }
        if (change === undefined || source === undefined) continue;
        const requestTarget: EditorTarget =
          scope === "session" ? target : { scope: "defaults" };
        // Preview and write carry the same draft, scope and revision: the server refuses a preview
        // against stale sources, and the write repeats that check under its own queue.
        const request: EditorChangeRequest = {
          ...requestTarget,
          revision: source.revision,
          change,
        };
        let preview: EditorReply;
        try {
          preview = parseReply(
            await ports.client.preview(request),
            requestTarget,
          );
        } catch {
          ensureSession();
          await dialogs.alert({
            title: "Delegation",
            message:
              "The preview could not be confirmed. Nothing was saved; the draft is still here. Try again.",
          });
          continue;
        }
        ensureSession();
        if (!preview.ok) {
          offerReload = true;
          await dialogs.alert({
            title: "Delegation",
            message: preview.text,
          });
          continue;
        }
        let applied: EditorReply;
        // Set before the write is sent: if anything interrupts the wait, including a session change,
        // the save may already be stored and must not be reported as unsaved.
        unconfirmed = true;
        try {
          applied = parseReply(
            await ports.client.apply(request),
            requestTarget,
          );
        } catch {
          ensureSession();
          await dialogs.alert({
            title: "Delegation",
            message:
              "The save result could not be confirmed. The draft is kept, but it may already have persisted. Reload the saved settings before saving again.",
          });
          continue;
        }
        ensureSession();
        if (!applied.ok) {
          if (applied.persistence !== "unknown") {
            unconfirmed = false;
            stale = true;
          }
          await dialogs.alert({
            title: "Delegation",
            message: applied.text,
          });
          continue;
        }
        // The server confirmed the write, so the draft part it carried is no longer pending even if
        // the fresh read below fails.
        const restartNeeded =
          scope === "defaults" &&
          (draft.roles !== undefined ||
            draft.thinking !== undefined ||
            draft.advisors !== undefined);
        draft = clearSaved(draft, scope, state.session?.view.provenance);
        unconfirmed = false;
        stale = false;
        offerReload = false;
        saved = true;
        try {
          state = await loadState();
        } catch {
          ensureSession();
          stale = true;
          await dialogs.alert({
            title: "Delegation",
            message:
              "Saved, but the saved settings could not be read again. Reload them before making another change.",
          });
          continue;
        }
        if (restartNeeded)
          await dialogs.alert({
            title: "Delegation",
            message:
              "Saved. Restart OpenCode so the agents use the new models.",
          });
        continue;
      }

      if (action === "intensity") {
        const value = await dialogs.select({
          title: "Intensity",
          options: scalarOptions(
            INTENSITIES,
            target.scope === "session"
              ? state.defaults.view.preferences.intensity
              : undefined,
          ),
          current: draft.intensity ?? base.intensity,
        });
        if (value !== undefined) edit({ ...draft, intensity: value });
      } else if (action === "advisorMode") {
        const value = await dialogs.select({
          title: "Advisor mode",
          options: scalarOptions(
            ADVISOR_MODES,
            target.scope === "session"
              ? state.defaults.view.preferences.advisorMode
              : undefined,
          ),
          current: draft.advisorMode ?? base.advisorMode,
        });
        if (value !== undefined) edit({ ...draft, advisorMode: value });
      } else if (action === "preference") {
        const value = await dialogs.select({
          title: "Model preference",
          options: scalarOptions(
            PREFERENCES,
            target.scope === "session"
              ? state.defaults.view.preferences.preference
              : undefined,
          ),
          current: draft.preference ?? base.preference,
        });
        if (value !== undefined) edit({ ...draft, preference: value });
      } else if (action.startsWith("role:")) {
        const role = roleIn(action, "role");
        if (role === undefined) throw new Error("unknown role");
        const setting = draft.roles?.[role] ?? base.roles[role];
        const model = await chooseModel(
          dialogs,
          effective(state).models,
          `Model for ${ROLE_LABELS[role]}`,
          roleValue(setting),
        );
        if (model !== undefined)
          edit({
            ...draft,
            roles: { ...draft.roles, [role]: roleSetting(model) },
          });
      } else if (action.startsWith("thinking:")) {
        const role = roleIn(action, "thinking");
        if (role === undefined) throw new Error("unknown role");
        const setting = await chooseThinking(
          dialogs,
          `Thinking for ${ROLE_LABELS[role]}`,
          draft.thinking?.[role] ?? base.thinking[role],
        );
        if (setting !== undefined)
          edit({
            ...draft,
            thinking: { ...draft.thinking, [role]: setting },
          });
      } else if (action.startsWith("advisor:")) {
        const adding = action === "advisor:add";
        const index = adding
          ? advisorModels.length
          : Number(action.slice("advisor:".length));
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index > advisorModels.length ||
          index >= MAX_ADVISORS
        )
          throw new Error("unknown Advisor");
        const model = await chooseModel(
          dialogs,
          effective(state).models,
          `Model for Advisor ${index + 1}`,
          adding ? undefined : advisorModels[index],
        );
        if (
          model === undefined ||
          (adding && (model === "off" || model === "unset"))
        )
          continue;
        const next = [...advisorModels];
        if (model === "off" || model === "unset") next.splice(index, 1);
        else next[index] = model;
        edit({
          ...draft,
          advisors:
            next.length === 0
              ? { kind: "unset" }
              : { kind: "configured", models: next },
        });
      } else throw new Error("unknown panel choice");
    }
  } catch (error) {
    await ports.dialogs.alert({
      title: "Delegation",
      message: unconfirmed
        ? "The save result could not be confirmed in this view. Check /delegate status in the panel's original session or the defaults before relying on it."
        : error instanceof SessionChanged
          ? "The open session changed. The draft was not saved. Reopen /delegate in the session you want to edit."
          : "The delegation panel could not finish. The draft was not saved. Reopen /delegate and try again; typed commands remain available.",
    });
  }
}
