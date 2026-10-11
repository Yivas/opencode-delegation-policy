// Product-owned schema for delegation preferences. It is not a copy of Pi's persisted
// schemas: OpenCode stores these documents through ctx.storage, so the plugin defines its
// own version 1 and rejects anything it cannot read exactly.

export const CURRENT_SCHEMA_VERSION = 1;

export const INTENSITIES = [
  "off",
  "normal",
  "aggressive",
  "orchestrator",
] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const PREFERENCES = ["efficient", "standard", "intensive"] as const;
export type Preference = (typeof PREFERENCES)[number];

export const ADVISOR_MODES = ["off", "on", "with-delegation"] as const;
export type AdvisorMode = (typeof ADVISOR_MODES)[number];

export const ROLE_KEYS = [
  "small",
  "medium",
  "large",
  "visualDesign",
  "advisor",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

// Model references and thinking levels are bounded text here. Their syntax and whether the
// host offers them are checked by the model validator, which reports an axis error instead
// of replacing the value.
export const MAX_MODEL_REFERENCE_LENGTH = 256;
export const MAX_THINKING_LEVEL_LENGTH = 64;

export type RoleSetting =
  | { readonly kind: "unset" }
  | { readonly kind: "disabled" }
  | { readonly kind: "configured"; readonly model: string };

export type ThinkingSetting =
  | { readonly kind: "unset" }
  | { readonly kind: "fixed"; readonly level: string }
  | { readonly kind: "range"; readonly from: string; readonly to: string };

// A session value that defers to the global document. Stored explicitly so an override
// never relies on a missing key or a null meaning "inherit".
export type InheritMarker = { readonly kind: "inherit" };
export type SessionRoleSetting = RoleSetting | InheritMarker;
export type SessionThinkingSetting = ThinkingSetting | InheritMarker;

export type GlobalPreferences = {
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly intensity: Intensity;
  readonly preference: Preference;
  readonly advisorMode: AdvisorMode;
  readonly roles: Readonly<Record<RoleKey, RoleSetting>>;
  readonly thinking: Readonly<Record<RoleKey, ThinkingSetting>>;
};

export type SessionPreferences = {
  readonly schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  readonly intensity: Intensity | "inherit";
  readonly preference: Preference | "inherit";
  readonly advisorMode: AdvisorMode | "inherit";
  readonly roles: Readonly<Record<RoleKey, SessionRoleSetting>>;
  readonly thinking: Readonly<Record<RoleKey, SessionThinkingSetting>>;
};

// Omitted keys keep their current value. An undefined value is not a valid setting.
export type GlobalPreferenceChange = {
  readonly intensity?: Intensity;
  readonly preference?: Preference;
  readonly advisorMode?: AdvisorMode;
  readonly roles?: Readonly<Partial<Record<RoleKey, RoleSetting>>>;
  readonly thinking?: Readonly<Partial<Record<RoleKey, ThinkingSetting>>>;
};

export type SessionPreferenceChange = {
  readonly intensity?: Intensity | "inherit";
  readonly preference?: Preference | "inherit";
  readonly advisorMode?: AdvisorMode | "inherit";
  readonly roles?: Readonly<Partial<Record<RoleKey, SessionRoleSetting>>>;
  readonly thinking?: Readonly<
    Partial<Record<RoleKey, SessionThinkingSetting>>
  >;
};

export type PreferenceStateErrorCode =
  | "corrupt-document"
  | "future-document"
  | "invalid-change"
  | "invalid-session-id"
  | "storage-read-failed"
  | "storage-write-failed";

export class PreferenceStateError extends Error {
  readonly code: PreferenceStateErrorCode;
  // Only write and removal failures set this. The host may have stored the change even though
  // the call rejected, so the caller must read the preferences again before relying on them.
  readonly persistence: "unknown" | undefined;

  constructor(
    code: PreferenceStateErrorCode,
    message: string,
    options?: { cause?: unknown; persistence?: "unknown" },
  ) {
    super(message, options);
    this.name = "PreferenceStateError";
    this.code = code;
    this.persistence = options?.persistence;
  }
}

// "stored" values come from the host and fail as corruption; "change" values come from a
// caller and fail as invalid input. Both use the same rules so a valid document can always
// be produced from a valid change.
export type ParseOrigin = "stored" | "change";

type Scope = "global" | "session";

type ParseContext = {
  readonly origin: ParseOrigin;
  readonly scope: Scope;
};

const DOCUMENT_KEYS = [
  "schemaVersion",
  "intensity",
  "preference",
  "advisorMode",
  "roles",
  "thinking",
] as const;

const SESSION_INTENSITIES = [...INTENSITIES, "inherit"] as const;
const SESSION_PREFERENCES = [...PREFERENCES, "inherit"] as const;
const SESSION_ADVISOR_MODES = [...ADVISOR_MODES, "inherit"] as const;

const ROLE_SETTING_KINDS = ["unset", "disabled", "configured"] as const;
const THINKING_KINDS = ["unset", "fixed", "range"] as const;

export function mapRoles<T>(mapRole: (role: RoleKey) => T): Record<RoleKey, T> {
  return {
    small: mapRole("small"),
    medium: mapRole("medium"),
    large: mapRole("large"),
    visualDesign: mapRole("visualDesign"),
    advisor: mapRole("advisor"),
  };
}

export function parseGlobalPreferences(
  value: unknown,
  origin: ParseOrigin,
): GlobalPreferences {
  const context: ParseContext = { origin, scope: "global" };
  const record = readEnvelope(value, context);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    intensity: parseEnum(record.intensity, INTENSITIES, context, "intensity"),
    preference: parseEnum(
      record.preference,
      PREFERENCES,
      context,
      "preference",
    ),
    advisorMode: parseEnum(
      record.advisorMode,
      ADVISOR_MODES,
      context,
      "advisorMode",
    ),
    roles: parseRoles(record.roles, context, "roles", parseRoleSetting),
    thinking: parseRoles(
      record.thinking,
      context,
      "thinking",
      parseThinkingSetting,
    ),
  };
}

export function parseSessionPreferences(
  value: unknown,
  origin: ParseOrigin,
): SessionPreferences {
  const context: ParseContext = { origin, scope: "session" };
  const record = readEnvelope(value, context);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    intensity: parseEnum(
      record.intensity,
      SESSION_INTENSITIES,
      context,
      "intensity",
    ),
    preference: parseEnum(
      record.preference,
      SESSION_PREFERENCES,
      context,
      "preference",
    ),
    advisorMode: parseEnum(
      record.advisorMode,
      SESSION_ADVISOR_MODES,
      context,
      "advisorMode",
    ),
    roles: parseRoles(record.roles, context, "roles", parseSessionRoleSetting),
    thinking: parseRoles(
      record.thinking,
      context,
      "thinking",
      parseSessionThinkingSetting,
    ),
  };
}

const CHANGE_KEYS = [
  "intensity",
  "preference",
  "advisorMode",
  "roles",
  "thinking",
] as const;

// A change is caller input and may later arrive as untrusted JSON, so it is checked before it
// is merged: it must be a plain object with only preference fields, no member may be undefined,
// and each axis must be a plain object with only role keys. The merged candidate is then parsed
// as a whole with the stored-document rules, so one rule set guards both paths.
export function parseGlobalChange(
  current: GlobalPreferences,
  change: unknown,
): GlobalPreferences {
  return parseGlobalPreferences(
    mergeChange(current, change, "global"),
    "change",
  );
}

export function parseSessionChange(
  current: SessionPreferences,
  change: unknown,
): SessionPreferences {
  return parseSessionPreferences(
    mergeChange(current, change, "session"),
    "change",
  );
}

function mergeChange(
  current: GlobalPreferences | SessionPreferences,
  change: unknown,
  scope: Scope,
): Record<string, unknown> {
  const context: ParseContext = { origin: "change", scope };
  const record = requireRecord(change, context, "change");
  requireKeys(record, CHANGE_KEYS, [], context, "change");
  for (const key of CHANGE_KEYS) {
    if (Object.hasOwn(record, key) && record[key] === undefined) {
      fail(context, `change.${key}`, "undefined is not a valid value");
    }
  }

  return {
    ...current,
    ...record,
    roles: mergeAxis(current.roles, record.roles, context, "change.roles"),
    thinking: mergeAxis(
      current.thinking,
      record.thinking,
      context,
      "change.thinking",
    ),
  };
}

function mergeAxis(
  current: Readonly<Record<RoleKey, unknown>>,
  change: unknown,
  context: ParseContext,
  path: string,
): Record<string, unknown> {
  if (change === undefined) {
    return { ...current };
  }
  const record = requireRecord(change, context, path);
  requireKeys(record, ROLE_KEYS, [], context, path);
  return { ...current, ...record };
}

function readEnvelope(
  value: unknown,
  context: ParseContext,
): Record<string, unknown> {
  const record = requireRecord(value, context, "root");

  // Checked before the shape: a newer version may add fields this version must not interpret.
  const version = record.schemaVersion;
  if (
    context.origin === "stored" &&
    typeof version === "number" &&
    Number.isInteger(version) &&
    version > CURRENT_SCHEMA_VERSION
  ) {
    throw new PreferenceStateError(
      "future-document",
      `${context.scope} preferences document uses schema version ${version}; this build reads version ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  requireKeys(record, DOCUMENT_KEYS, DOCUMENT_KEYS, context, "root");
  if (record.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    fail(context, "schemaVersion", "unsupported schema version");
  }
  return record;
}

function parseRoles<T>(
  value: unknown,
  context: ParseContext,
  path: string,
  parseSetting: (value: unknown, context: ParseContext, path: string) => T,
): Record<RoleKey, T> {
  const record = requireRecord(value, context, path);
  requireKeys(record, ROLE_KEYS, ROLE_KEYS, context, path);
  return mapRoles((role) =>
    parseSetting(record[role], context, `${path}.${role}`),
  );
}

function parseRoleSetting(
  value: unknown,
  context: ParseContext,
  path: string,
): RoleSetting {
  const record = requireRecord(value, context, path);
  const kind = parseEnum(
    record.kind,
    ROLE_SETTING_KINDS,
    context,
    `${path}.kind`,
  );

  if (kind === "configured") {
    requireKeys(record, ["kind", "model"], ["kind", "model"], context, path);
    return {
      kind,
      model: parseText(
        record.model,
        MAX_MODEL_REFERENCE_LENGTH,
        context,
        `${path}.model`,
      ),
    };
  }

  requireKeys(record, ["kind"], ["kind"], context, path);
  return kind === "unset" ? { kind: "unset" } : { kind: "disabled" };
}

function parseSessionRoleSetting(
  value: unknown,
  context: ParseContext,
  path: string,
): SessionRoleSetting {
  if (isInheritRecord(value)) {
    requireKeys(value, ["kind"], ["kind"], context, path);
    return { kind: "inherit" };
  }
  return parseRoleSetting(value, context, path);
}

function parseThinkingSetting(
  value: unknown,
  context: ParseContext,
  path: string,
): ThinkingSetting {
  const record = requireRecord(value, context, path);
  const kind = parseEnum(record.kind, THINKING_KINDS, context, `${path}.kind`);

  if (kind === "fixed") {
    requireKeys(record, ["kind", "level"], ["kind", "level"], context, path);
    return {
      kind,
      level: parseText(
        record.level,
        MAX_THINKING_LEVEL_LENGTH,
        context,
        `${path}.level`,
      ),
    };
  }
  if (kind === "range") {
    requireKeys(
      record,
      ["kind", "from", "to"],
      ["kind", "from", "to"],
      context,
      path,
    );
    return {
      kind,
      from: parseText(
        record.from,
        MAX_THINKING_LEVEL_LENGTH,
        context,
        `${path}.from`,
      ),
      to: parseText(
        record.to,
        MAX_THINKING_LEVEL_LENGTH,
        context,
        `${path}.to`,
      ),
    };
  }

  requireKeys(record, ["kind"], ["kind"], context, path);
  return { kind: "unset" };
}

function parseSessionThinkingSetting(
  value: unknown,
  context: ParseContext,
  path: string,
): SessionThinkingSetting {
  if (isInheritRecord(value)) {
    requireKeys(value, ["kind"], ["kind"], context, path);
    return { kind: "inherit" };
  }
  return parseThinkingSetting(value, context, path);
}

function isInheritRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.kind === "inherit";
}

// Only plain objects are records. Class instances such as Date or Map have no JSON form and
// would otherwise pass as empty records.
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(
  value: unknown,
  context: ParseContext,
  path: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    fail(context, path, "expected an object");
  }
  return value;
}

// Unknown keys are reported without their names: a stored document may contain
// unexpected material, and diagnostics must not copy it.
function requireKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  context: ParseContext,
  path: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      fail(context, path, "unknown field");
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      fail(context, path, `missing field ${key}`);
    }
  }
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  context: ParseContext,
  path: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    fail(context, path, "unsupported value");
  }
  return match;
}

function parseText(
  value: unknown,
  maxLength: number,
  context: ParseContext,
  path: string,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    fail(context, path, `expected text of 1 to ${maxLength} characters`);
  }
  return value;
}

function fail(context: ParseContext, path: string, reason: string): never {
  const code =
    context.origin === "stored" ? "corrupt-document" : "invalid-change";
  const subject = context.origin === "stored" ? "document" : "change";
  throw new PreferenceStateError(
    code,
    `${context.scope} preferences ${subject} at ${path}: ${reason}`,
  );
}
