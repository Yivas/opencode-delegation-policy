import type { PreferenceView } from "../state/effective.js";
import { ADVISOR_MODES, INTENSITIES, PREFERENCES } from "../state/schema.js";

export type EditorScope = "defaults" | "session";
export type EditorTarget = {
  readonly scope: EditorScope;
  readonly sessionID?: string;
};
export type EditorModel = {
  readonly reference: string;
  readonly variants: readonly string[];
};
export type EditorSnapshot = EditorTarget & {
  readonly ok: true;
  readonly revision: string;
  readonly view: PreferenceView;
  readonly models: readonly EditorModel[];
  readonly text: string;
};

const role = {
  anyOf: [
    {
      type: "object",
      properties: { kind: { const: "unset" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "disabled" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "configured" },
        model: { type: "string", maxLength: 256 },
      },
      required: ["kind", "model"],
      additionalProperties: false,
    },
  ],
} as const;
const thinking = {
  anyOf: [
    {
      type: "object",
      properties: { kind: { const: "unset" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "fixed" },
        level: { type: "string", maxLength: 64 },
      },
      required: ["kind", "level"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "range" },
        from: { type: "string", maxLength: 64 },
        to: { type: "string", maxLength: 64 },
      },
      required: ["kind", "from", "to"],
      additionalProperties: false,
    },
  ],
} as const;
const advisors = {
  anyOf: [
    {
      type: "object",
      properties: { kind: { const: "unset" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { kind: { const: "disabled" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "configured" },
        models: {
          type: "array",
          items: { type: "string", maxLength: 256 },
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ["kind", "models"],
      additionalProperties: false,
    },
  ],
} as const;
const roleNames = ["small", "medium", "large", "visualDesign"] as const;
const axis = <T>(setting: T) =>
  ({
    type: "object",
    properties: {
      small: setting,
      medium: setting,
      large: setting,
      visualDesign: setting,
    },
    required: roleNames,
    additionalProperties: false,
  }) as const;
const source = {
  type: "string",
  enum: ["default", "global", "session"],
} as const;
const sourceSchema = {
  type: "object",
  properties: {
    intensity: source,
    preference: source,
    advisorMode: source,
    roles: axis(source),
    thinking: axis(source),
    advisors: source,
  },
  required: [
    "intensity",
    "preference",
    "advisorMode",
    "roles",
    "thinking",
    "advisors",
  ],
  additionalProperties: false,
} as const;
const preferences = {
  type: "object",
  properties: {
    intensity: { type: "string", enum: INTENSITIES },
    advisorMode: { type: "string", enum: ADVISOR_MODES },
    preference: { type: "string", enum: PREFERENCES },
    roles: axis(role),
    thinking: axis(thinking),
    advisors,
  },
  required: [
    "intensity",
    "preference",
    "advisorMode",
    "roles",
    "thinking",
    "advisors",
  ],
  additionalProperties: false,
} as const;

export const editorTargetProperties = {
  scope: { type: "string", enum: ["defaults", "session"] },
  sessionID: { type: "string", minLength: 1, maxLength: 128 },
} as const;
export const editorReadInput = {
  type: "object",
  properties: editorTargetProperties,
  required: ["scope"],
  additionalProperties: false,
} as const;
const editorSnapshotSchema = {
  type: "object",
  properties: {
    ...editorTargetProperties,
    ok: { const: true },
    revision: { type: "string", pattern: "^[0-9a-f]{64}$" },
    view: {
      type: "object",
      properties: { preferences, provenance: sourceSchema },
      required: ["preferences", "provenance"],
      additionalProperties: false,
    },
    models: {
      type: "array",
      items: {
        type: "object",
        properties: {
          reference: { type: "string", maxLength: 256 },
          variants: {
            type: "array",
            items: { type: "string", maxLength: 256 },
          },
        },
        required: ["reference", "variants"],
        additionalProperties: false,
      },
    },
    text: { type: "string" },
  },
  required: ["ok", "scope", "revision", "view", "models", "text"],
  additionalProperties: false,
} as const;

const inherit = {
  type: "object",
  properties: { kind: { const: "inherit" } },
  required: ["kind"],
  additionalProperties: false,
} as const;
const partialAxis = <T>(setting: T) =>
  ({ ...axis(setting), required: [] }) as const;
export const editorChangeInput = {
  type: "object",
  properties: {
    ...editorTargetProperties,
    revision: { type: "string", pattern: "^[0-9a-f]{64}$" },
    change: {
      type: "object",
      properties: {
        intensity: { type: "string", enum: [...INTENSITIES, "inherit"] },
        advisorMode: { type: "string", enum: [...ADVISOR_MODES, "inherit"] },
        preference: { type: "string", enum: [...PREFERENCES, "inherit"] },
        roles: partialAxis(role),
        thinking: partialAxis(thinking),
        advisors: { anyOf: [advisors, inherit] },
      },
      additionalProperties: false,
    },
  },
  required: ["scope", "revision", "change"],
  additionalProperties: false,
} as const;
const editorFailureSchema = {
  type: "object",
  properties: { ok: { const: false }, text: { type: "string" } },
  required: ["ok", "text"],
  additionalProperties: false,
} as const;
export const editorReadOutput = {
  anyOf: [editorSnapshotSchema, editorFailureSchema],
} as const;
export const editorChangeOutput = {
  anyOf: [
    {
      type: "object",
      properties: {
        ...editorTargetProperties,
        ok: { const: true },
        text: { type: "string" },
      },
      required: ["ok", "scope", "text"],
      additionalProperties: false,
    },
    editorFailureSchema,
  ],
} as const;
export type EditorFailure = { readonly ok: false; readonly text: string };
export type EditorReply =
  | (EditorTarget & { readonly ok: true; readonly text: string })
  | EditorFailure;
