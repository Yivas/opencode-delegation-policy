import type { PreferenceSource, PreferenceView } from "../state/effective.js";
import {
  MAX_MODEL_REFERENCE_LENGTH,
  mapRoles,
  parseGlobalPreferences,
  type SessionPreferenceChange,
} from "../state/schema.js";
import type { EditorReply, EditorSnapshot, EditorTarget } from "./contract.js";

// The host's promise dialogs, as this plugin uses them. They live here, beside `EditorDialogs` which
// extends them, so the panel, this client and the terminal entry share them without an import cycle.
export type SelectOption<Value> = {
  readonly title: string;
  readonly value: Value;
  readonly description?: string;
  readonly footer?: string;
  readonly disabled?: boolean;
};

export type SelectorDialogs = {
  readonly select: <Value>(options: {
    title: string;
    placeholder?: string;
    current?: Value;
    options: readonly SelectOption<Value>[];
  }) => Promise<Value | undefined>;
  readonly prompt: (options: {
    title: string;
    description?: string;
    placeholder?: string;
  }) => Promise<string | undefined>;
};

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

// Every reply crosses the RPC boundary as `unknown`, so it is checked where it arrives. A snapshot
// must describe the scope that was asked for, and a failure must carry the persistence it claims:
// a caller that cannot tell "unchanged" from "unknown" would report an unconfirmed save as safe.
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
// A read answers with a snapshot or with a failure that carries its own text; a caller that treats
// both as a snapshot would show an empty panel instead of the reason nothing could be read.
export type EditorRead =
  | { readonly ok: true; readonly snapshot: EditorSnapshot }
  | { readonly ok: false; readonly text: string };

export function parseRead(value: unknown, target: EditorTarget): EditorRead {
  const raw = record(value);
  return raw.ok === false
    ? { ok: false, text: parseReply(raw, target).text }
    : { ok: true, snapshot: parseSnapshot(raw, target) };
}

function parseSnapshot(value: unknown, target: EditorTarget): EditorSnapshot {
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
export function parseReply(value: unknown, target: EditorTarget): EditorReply {
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
// Model references and thinking levels come from the host, so control characters are escaped
// before they reach a dialog title or a footer.
export function display(value: string): string {
  return value.replace(
    /[\p{Cc}\p{Cf}]/gu,
    (character) => `\\u{${character.codePointAt(0)?.toString(16)}}`,
  );
}
