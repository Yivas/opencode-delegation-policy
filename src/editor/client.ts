import type { SelectOption, SelectorDialogs } from "../selector.js";
import type { PreferenceSource, PreferenceView } from "../state/effective.js";
import {
  ADVISOR_MODES,
  INTENSITIES,
  MAX_ADVISORS,
  MAX_MODEL_REFERENCE_LENGTH,
  mapRoles,
  PREFERENCES,
  parseGlobalPreferences,
  ROLE_KEYS,
  type RoleKey,
  type RoleSetting,
  type SessionPreferenceChange,
  type ThinkingSetting,
} from "../state/schema.js";
import { THINKING_LEVELS } from "../thinking/levels.js";
import type {
  EditorModel,
  EditorReply,
  EditorSnapshot,
  EditorTarget,
} from "./contract.js";

export type EditorChangeRequest = EditorTarget & {
  readonly revision: string;
  readonly change: SessionPreferenceChange;
};
export type EditorClient = {
  read(target: EditorTarget): Promise<unknown>;
  preview(input: EditorChangeRequest): Promise<unknown>;
  apply(input: EditorChangeRequest): Promise<unknown>;
};
export type EditorDialogs = SelectorDialogs & {
  alert(options: { title: string; message: string }): Promise<void>;
  confirm(options: {
    title: string;
    message: string;
    label?: { confirm?: string; cancel?: string };
  }): Promise<boolean | undefined>;
};
const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  visualDesign: "Visual Design",
};
const SOURCES: Readonly<Record<PreferenceSource, string>> = {
  default: "built-in",
  global: "defaults",
  session: "this session",
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("invalid editor reply");
  return value as Record<string, unknown>;
}
function source(value: unknown): PreferenceSource {
  if (value === "default" || value === "global" || value === "session")
    return value;
  throw new Error("invalid editor provenance");
}
function view(value: unknown): PreferenceView {
  const raw = record(value);
  const { schemaVersion: _version, ...preferences } = parseGlobalPreferences(
    { schemaVersion: 1, ...record(raw.preferences) },
    "change",
  );
  const origins = record(raw.provenance);
  const roles = record(origins.roles);
  const thinking = record(origins.thinking);
  return {
    preferences,
    provenance: {
      intensity: source(origins.intensity),
      advisorMode: source(origins.advisorMode),
      preference: source(origins.preference),
      advisors: source(origins.advisors),
      roles: mapRoles((key) => source(roles[key])),
      thinking: mapRoles((key) => source(thinking[key])),
    },
  };
}
function matches(raw: Record<string, unknown>, target: EditorTarget): boolean {
  return raw.scope === target.scope && raw.sessionID === target.sessionID;
}
function reference(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_MODEL_REFERENCE_LENGTH ||
    !value.isWellFormed() ||
    !/^[^/#\s]+\/[^#\s]+$/u.test(value) ||
    /\p{Cc}/u.test(value)
  )
    throw new Error("invalid editor model");
  return value;
}
function snapshot(value: unknown, target: EditorTarget): EditorSnapshot {
  const raw = record(value);
  if (
    raw.ok !== true ||
    !matches(raw, target) ||
    typeof raw.revision !== "string" ||
    !/^[0-9a-f]{64}$/.test(raw.revision) ||
    typeof raw.text !== "string" ||
    !Array.isArray(raw.models)
  )
    throw new Error("invalid editor snapshot");
  const models = Array.from(raw.models, (entry) => {
    const item = record(entry);
    const base = reference(item.reference);
    if (!Array.isArray(item.variants))
      throw new Error("invalid editor variants");
    const variants = Array.from(item.variants, (id) => {
      if (
        typeof id !== "string" ||
        id === "" ||
        /[#\s\p{Cc}]/u.test(id) ||
        !id.isWellFormed() ||
        `${base}#${id}`.length > MAX_MODEL_REFERENCE_LENGTH
      )
        throw new Error("invalid editor variant");
      return id;
    });
    return { reference: base, variants };
  });
  return {
    ok: true,
    ...target,
    revision: raw.revision,
    view: view(raw.view),
    models,
    text: raw.text,
  };
}
function reply(value: unknown, target: EditorTarget): EditorReply {
  const raw = record(value);
  if (typeof raw.text !== "string") throw new Error("missing editor report");
  if (
    raw.ok === false &&
    (raw.persistence === "unchanged" || raw.persistence === "unknown")
  )
    return { ok: false, persistence: raw.persistence, text: raw.text };
  if (raw.ok !== true || !matches(raw, target))
    throw new Error("wrong editor reply target");
  return { ok: true, ...target, text: raw.text };
}
function display(value: string): string {
  return value.replace(
    /[\p{Cc}\p{Cf}]/gu,
    (character) => `\\u{${character.codePointAt(0)?.toString(16)}}`,
  );
}
function roleText(setting: RoleSetting): string {
  return setting.kind === "configured"
    ? display(setting.model)
    : setting.kind === "disabled"
      ? "off"
      : "not set";
}
function thinkingText(setting: ThinkingSetting): string {
  return setting.kind === "fixed"
    ? display(setting.level)
    : setting.kind === "range"
      ? `${display(setting.from)}..${display(setting.to)}`
      : "choose per launch";
}
function options<T extends string>(values: readonly T[]): SelectOption<T>[] {
  return values.map((value) => ({ title: value, value }));
}

async function chooseModel(
  dialogs: EditorDialogs,
  models: readonly EditorModel[],
  title: string,
): Promise<string | undefined> {
  let filter = "";
  for (;;) {
    const shown = models.filter((model) =>
      model.reference.toLowerCase().includes(filter.toLowerCase()),
    );
    const chosen = await dialogs.select({
      title,
      options: [
        {
          title: "Off / remove entry",
          value: "off",
          description:
            "Disable this role, or remove this Advisor from the draft.",
        },
        {
          title: "Not set",
          value: "unset",
          description:
            "No model configured; ordinary roles must be explicitly off or configured.",
        },
        {
          title: `Filter models${filter === "" ? "" : `: ${display(filter)}`}`,
          value: "filter",
          description: `${shown.length} matching models; filters do not hide Off or Not set.`,
        },
        ...shown.map((model) => ({
          title: display(model.reference),
          value: model.reference,
          description: `${model.variants.length} proven variants`,
          footer:
            "Only a draft until Apply; changing models requires a host restart.",
        })),
      ],
    });
    if (chosen === undefined || chosen === "off" || chosen === "unset")
      return chosen;
    if (chosen === "filter") {
      const text = await dialogs.prompt({
        title: "Filter models by provider or model id",
        placeholder: "Leave empty to show all models.",
      });
      if (text !== undefined) filter = text.trim();
      continue;
    }
    const model = models.find((entry) => entry.reference === chosen);
    if (model === undefined) throw new Error("unknown editor model choice");
    if (model.variants.length === 0) return model.reference;
    return dialogs.select({
      title: `Default variant for ${display(model.reference)}`,
      options: [
        {
          title: "Choose per launch",
          value: model.reference,
          description:
            "No default variant; the policy still lists proven choices.",
        },
        ...model.variants.map((id) => ({
          title: display(id),
          value: `${model.reference}#${id}`,
        })),
      ],
    });
  }
}
async function chooseThinking(
  dialogs: EditorDialogs,
  title: string,
): Promise<ThinkingSetting | undefined> {
  const kind = await dialogs.select({
    title,
    options: [
      { title: "Choose per launch", value: "unset" },
      { title: "Fixed level", value: "fixed" },
      { title: "Inclusive range", value: "range" },
    ],
  });
  if (kind === undefined) return undefined;
  if (kind === "unset") return { kind: "unset" };
  const from = await dialogs.select({
    title: kind === "fixed" ? "Thinking level" : "Lowest thinking level",
    options: options(THINKING_LEVELS),
  });
  if (from === undefined) return undefined;
  if (kind === "fixed") return { kind: "fixed", level: from };
  const levels = THINKING_LEVELS.slice(THINKING_LEVELS.indexOf(from));
  const to = await dialogs.select({
    title: "Highest thinking level (inclusive)",
    options: options(levels),
  });
  return to === undefined ? undefined : { kind: "range", from, to };
}
class SessionChanged extends Error {}

// The draft is local and disposable. Only Apply calls the mutating RPC. The host owns every dialog,
// its keyboard interaction and presentation; this module adds no Solid runtime or separate renderer.
export async function runPreferenceEditor(
  target: EditorTarget,
  ports: {
    readonly client: EditorClient;
    readonly dialogs: EditorDialogs;
    readonly sessionID: () => string | undefined;
  },
): Promise<void> {
  let mayHaveWritten = false;
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
  try {
    openedSession = ports.sessionID();
    if (target.scope === "session" && target.sessionID !== openedSession)
      throw new SessionChanged();
    const read = await ports.client.read(target);
    ensureSession();
    if (record(read).ok === false) {
      await dialogs.alert({
        title: "Delegation editor",
        message: reply(read, target).text,
      });
      return;
    }
    let current = snapshot(read, target);
    let draft: SessionPreferenceChange = {};
    const changed = () => Object.keys(draft).length > 0;
    const origin = (text: string, dirty: boolean, from: PreferenceSource) =>
      `${text} (${dirty ? "draft" : SOURCES[from]})`;
    let focused: string | undefined;
    for (;;) {
      ensureSession();
      const base = current.view.preferences;
      const sources = current.view.provenance;
      const advisors = draft.advisors ?? base.advisors;
      const models = advisors.kind === "configured" ? advisors.models : [];
      const rows: SelectOption<string>[] = [
        {
          title: origin(
            `Intensity: ${draft.intensity ?? base.intensity}`,
            draft.intensity !== undefined,
            sources.intensity,
          ),
          value: "intensity",
          footer:
            "Off, normal, aggressive or orchestrator; independent of Advisor mode.",
        },
        {
          title: origin(
            `Advisor mode: ${draft.advisorMode ?? base.advisorMode}`,
            draft.advisorMode !== undefined,
            sources.advisorMode,
          ),
          value: "advisorMode",
          footer:
            "On consults even with delegation off; with-delegation follows active intensity.",
        },
        {
          title: origin(
            `Model preference: ${draft.preference ?? base.preference}`,
            draft.preference !== undefined,
            sources.preference,
          ),
          value: "preference",
          footer: "Small/Medium tie-break only; task fit comes first.",
        },
      ];
      for (const role of ROLE_KEYS) {
        const setting = draft.roles?.[role] ?? base.roles[role];
        const thinking = draft.thinking?.[role] ?? base.thinking[role];
        if (setting.kind === "inherit" || thinking.kind === "inherit")
          throw new Error("invalid defaults draft");
        rows.push(
          {
            title: origin(
              `${ROLE_LABELS[role]}: ${roleText(setting)}`,
              draft.roles?.[role] !== undefined,
              sources.roles[role],
            ),
            value: `role:${role}`,
            disabled: target.scope === "session",
            footer:
              "Global agent model; Off and Not set precede the filter. Restart after applying.",
          },
          {
            title: origin(
              `${ROLE_LABELS[role]} thinking: ${thinkingText(thinking)}`,
              draft.thinking?.[role] !== undefined,
              sources.thinking[role],
            ),
            value: `thinking:${role}`,
            disabled: target.scope === "session",
            footer:
              "Fixed or inclusive range; preview reports unsupported models or levels.",
          },
        );
      }
      if (target.scope === "defaults") {
        rows.push({
          title: origin(
            `Advisors: ${advisors.kind === "configured" ? models.length : advisors.kind}`,
            draft.advisors !== undefined,
            sources.advisors,
          ),
          value: "advisors",
          footer:
            "One to three, in order. Each receives the same question; no Advisor thinking policy.",
        });
        models.forEach((model, index) => {
          rows.push({
            title: `Advisor ${index + 1}: ${display(model)}`,
            value: `advisor:${index}`,
            footer:
              "Change this default model or remove this entry; later entries remain consecutive.",
          });
        });
        if (models.length < MAX_ADVISORS)
          rows.push({
            title: `Add Advisor ${models.length + 1}`,
            value: "advisor:add",
            footer:
              "Adds one extra consultation at each checkpoint; nothing launches from this editor.",
          });
      } else {
        rows.push({
          title: `Advisors: ${models.length} configured (${SOURCES[sources.advisors]})`,
          value: "advisors-readonly",
          disabled: true,
          footer: "Models are configured in the defaults, not per session.",
        });
        models.forEach((model, index) => {
          rows.push({
            title: `Advisor ${index + 1}: ${display(model)}`,
            value: `advisor-readonly:${index}`,
            disabled: true,
            footer:
              "Default model; preview shows warnings and usable Advisors.",
          });
        });
      }
      rows.push(
        {
          title: "Preview draft",
          value: "preview",
          description:
            "Validate without saving; shows effective values, origins and diagnostics.",
        },
        {
          title:
            target.scope === "defaults"
              ? "Apply to defaults"
              : "Apply to this session",
          value: "apply",
          disabled: !changed() || mayHaveWritten,
          description: mayHaveWritten
            ? "Last save unconfirmed; reload source settings before trying again."
            : "The only action that saves this draft.",
        },
        {
          title: "Reload source settings; keep draft",
          value: "reload",
          description:
            "Read a fresh revision without saving; review the retained draft before applying.",
        },
        { title: changed() ? "Discard and close" : "Close", value: "close" },
      );
      const action = await dialogs.select({
        title:
          target.scope === "defaults"
            ? "Delegation defaults — draft"
            : "Delegation for this session — draft",
        options: rows,
        ...(focused === undefined ? {} : { current: focused }),
      });
      focused = action;
      if (action === undefined || action === "close") {
        if (
          !changed() ||
          (await dialogs.confirm({
            title: "Discard delegation changes?",
            message: mayHaveWritten
              ? "The last save is unconfirmed and may have persisted. Close this editor and discard its local draft? Check status before relying on the settings."
              : "The draft has not been saved. Discard it and close?",
            label: { confirm: "Discard", cancel: "Keep editing" },
          })) === true
        )
          return;
        continue;
      }
      if (action === "reload") {
        try {
          const reloaded = await ports.client.read(target);
          ensureSession();
          if (record(reloaded).ok === false) {
            await dialogs.alert({
              title: "Delegation editor",
              message: reply(reloaded, target).text,
            });
            continue;
          }
          const fresh = snapshot(reloaded, target);
          await dialogs.alert({
            title: "Source settings reloaded; draft kept",
            message: fresh.text,
          });
          current = fresh;
          mayHaveWritten = false;
        } catch {
          ensureSession();
          await dialogs.alert({
            title: "Delegation editor",
            message:
              "Source settings could not be reloaded. The draft and its previous save status are kept. Try Reload again or close with discard confirmation.",
          });
        }
        continue;
      }
      const input = (): EditorChangeRequest => ({
        ...target,
        revision: current.revision,
        change: draft,
      });
      if (action === "preview" || action === "apply") {
        if (action === "apply" && (!changed() || mayHaveWritten)) continue;
        let preview: EditorReply;
        try {
          preview = reply(await ports.client.preview(input()), target);
        } catch {
          ensureSession();
          await dialogs.alert({
            title: "Delegation preview",
            message:
              "The preview could not be confirmed. No save was sent; the local draft is still here. Reload the source settings or try Preview again.",
          });
          continue;
        }
        ensureSession();
        await dialogs.alert({
          title: "Delegation preview",
          message: preview.text,
        });
        if (!preview.ok || action === "preview") continue;
        if (
          (await dialogs.confirm({
            title:
              target.scope === "defaults"
                ? "Apply delegation defaults?"
                : "Apply this session's delegation settings?",
            message:
              "Save the previewed draft? A concurrent settings change will refuse it; model changes require a restart.",
            label: { confirm: "Apply", cancel: "Keep editing" },
          })) !== true
        )
          continue;
        ensureSession();
        mayHaveWritten = true;
        let saved: EditorReply;
        try {
          saved = reply(await ports.client.apply(input()), target);
        } catch {
          ensureSession();
          await dialogs.alert({
            title: "Delegation",
            message:
              "The save result could not be confirmed. The draft is kept, but it may already have persisted. Reload source settings before applying again.",
          });
          continue;
        }
        ensureSession();
        await ports.dialogs.alert({ title: "Delegation", message: saved.text });
        if (saved.ok) return;
        mayHaveWritten = saved.persistence === "unknown";
        continue;
      }
      if (action === "intensity") {
        const values =
          target.scope === "session"
            ? (["inherit", ...INTENSITIES] as const)
            : INTENSITIES;
        const value = await dialogs.select({
          title: "Intensity",
          options: options(values),
        });
        if (value !== undefined) draft = { ...draft, intensity: value };
      } else if (action === "advisorMode") {
        const values =
          target.scope === "session"
            ? (["inherit", ...ADVISOR_MODES] as const)
            : ADVISOR_MODES;
        const value = await dialogs.select({
          title: "Advisor mode",
          options: options(values),
        });
        if (value !== undefined) draft = { ...draft, advisorMode: value };
      } else if (action === "preference") {
        const values =
          target.scope === "session"
            ? (["inherit", ...PREFERENCES] as const)
            : PREFERENCES;
        const value = await dialogs.select({
          title: "Model preference",
          options: options(values),
        });
        if (value !== undefined) draft = { ...draft, preference: value };
      } else if (action.startsWith("role:") && target.scope === "defaults") {
        const role = ROLE_KEYS.find((key) => action === `role:${key}`);
        if (role === undefined) throw new Error("unknown role");
        const model = await chooseModel(
          dialogs,
          current.models,
          `Model for ${ROLE_LABELS[role]}`,
        );
        if (model !== undefined)
          draft = {
            ...draft,
            roles: {
              ...draft.roles,
              [role]:
                model === "off"
                  ? { kind: "disabled" }
                  : model === "unset"
                    ? { kind: "unset" }
                    : { kind: "configured", model },
            },
          };
      } else if (
        action.startsWith("thinking:") &&
        target.scope === "defaults"
      ) {
        const role = ROLE_KEYS.find((key) => action === `thinking:${key}`);
        if (role === undefined) throw new Error("unknown role");
        const setting = await chooseThinking(
          dialogs,
          `Thinking for ${ROLE_LABELS[role]}`,
        );
        if (setting !== undefined)
          draft = {
            ...draft,
            thinking: { ...draft.thinking, [role]: setting },
          };
      } else if (action === "advisors" && target.scope === "defaults") {
        const value = await dialogs.select<"disabled" | "unset">({
          title: "Advisor list",
          options: [
            { title: "Off", value: "disabled" },
            { title: "Not set", value: "unset" },
          ],
        });
        if (value !== undefined)
          draft = { ...draft, advisors: { kind: value } };
      } else if (action.startsWith("advisor:") && target.scope === "defaults") {
        const index =
          action === "advisor:add"
            ? models.length
            : models.findIndex(
                (_model, offset) => action === `advisor:${offset}`,
              );
        if (index < 0 || index >= MAX_ADVISORS)
          throw new Error("unknown Advisor");
        const model = await chooseModel(
          dialogs,
          current.models,
          `Model for Advisor ${index + 1}`,
        );
        if (
          model === undefined ||
          (index === models.length && (model === "off" || model === "unset"))
        )
          continue;
        const next = [...models];
        if (model === "off" || model === "unset") next.splice(index, 1);
        else next[index] = model;
        draft = {
          ...draft,
          advisors:
            next.length === 0
              ? { kind: "unset" }
              : { kind: "configured", models: next },
        };
      } else throw new Error("unknown editor choice");
    }
  } catch (error) {
    await ports.dialogs.alert({
      title: "Delegation editor",
      message: mayHaveWritten
        ? "The save result could not be confirmed in this view. Check /delegate status in the editor's original session or the defaults before relying on it."
        : error instanceof SessionChanged
          ? "The open session changed. The draft was not saved. Reopen /delegate in the session you want to edit."
          : "The delegation editor could not finish. The draft was not saved. Reopen /delegate and try again; typed commands remain available.",
    });
  }
}
