import {
  type AdvisorMode,
  type GlobalPreferences,
  type Intensity,
  mapRoles,
  type Preference,
  type RoleKey,
  type RoleSetting,
  type SessionPreferences,
  type SessionRoleSetting,
  type SessionThinkingSetting,
  type ThinkingSetting,
} from "./schema.js";

export type PreferenceSource = "default" | "global" | "session";

export type EffectivePreferences = {
  readonly intensity: Intensity;
  readonly preference: Preference;
  readonly advisorMode: AdvisorMode;
  readonly roles: Readonly<Record<RoleKey, RoleSetting>>;
  readonly thinking: Readonly<Record<RoleKey, ThinkingSetting>>;
};

export type PreferenceProvenance = {
  readonly intensity: PreferenceSource;
  readonly preference: PreferenceSource;
  readonly advisorMode: PreferenceSource;
  readonly roles: Readonly<Record<RoleKey, PreferenceSource>>;
  readonly thinking: Readonly<Record<RoleKey, PreferenceSource>>;
};

export type PreferenceView = {
  readonly preferences: EffectivePreferences;
  readonly provenance: PreferenceProvenance;
};

// Freezing covers the exported constants below. Views copy the settings they return, so a
// caller that mutates a view cannot reach these objects either.
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) {
      deepFreeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

// Used until the global document is saved explicitly. Once it exists, every field is
// reported as "global" even when its value equals the built-in one.
export const BUILT_IN_GLOBAL_PREFERENCES: GlobalPreferences = deepFreeze({
  schemaVersion: 1,
  intensity: "off",
  preference: "standard",
  advisorMode: "with-delegation",
  roles: mapRoles<RoleSetting>(() => ({ kind: "unset" })),
  thinking: mapRoles<ThinkingSetting>(() => ({ kind: "unset" })),
});

export const INHERITING_SESSION_PREFERENCES: SessionPreferences = deepFreeze({
  schemaVersion: 1,
  intensity: "inherit",
  preference: "inherit",
  advisorMode: "inherit",
  roles: mapRoles<SessionRoleSetting>(() => ({ kind: "inherit" })),
  thinking: mapRoles<SessionThinkingSetting>(() => ({ kind: "inherit" })),
});

// A session never reads its parent's override: child sessions resolve against the
// global document only, and the caller passes the session document for this session alone.
export function resolvePreferences(
  global: GlobalPreferences | undefined,
  session: SessionPreferences | undefined,
): PreferenceView {
  const base = global ?? BUILT_IN_GLOBAL_PREFERENCES;
  const baseSource: Exclude<PreferenceSource, "session"> =
    global === undefined ? "default" : "global";
  const override = session ?? INHERITING_SESSION_PREFERENCES;

  const intensity = resolveScalar(
    override.intensity,
    base.intensity,
    baseSource,
  );
  const preference = resolveScalar(
    override.preference,
    base.preference,
    baseSource,
  );
  const advisorMode = resolveScalar(
    override.advisorMode,
    base.advisorMode,
    baseSource,
  );
  const roles = mapRoles((role) =>
    resolveRole(override.roles[role], base.roles[role], baseSource),
  );
  const thinking = mapRoles((role) =>
    resolveThinking(override.thinking[role], base.thinking[role], baseSource),
  );

  return {
    preferences: {
      intensity: intensity.value,
      preference: preference.value,
      advisorMode: advisorMode.value,
      roles: mapRoles((role) => roles[role].value),
      thinking: mapRoles((role) => thinking[role].value),
    },
    provenance: {
      intensity: intensity.source,
      preference: preference.source,
      advisorMode: advisorMode.source,
      roles: mapRoles((role) => roles[role].source),
      thinking: mapRoles((role) => thinking[role].source),
    },
  };
}

type Resolved<T> = {
  readonly value: T;
  readonly source: PreferenceSource;
};

function resolveScalar<T extends string>(
  overrideValue: T | "inherit",
  baseValue: T,
  baseSource: Exclude<PreferenceSource, "session">,
): Resolved<T> {
  if (overrideValue === "inherit") {
    return { value: baseValue, source: baseSource };
  }
  return { value: overrideValue, source: "session" };
}

function resolveRole(
  overrideValue: SessionRoleSetting,
  baseValue: RoleSetting,
  baseSource: Exclude<PreferenceSource, "session">,
): Resolved<RoleSetting> {
  if (overrideValue.kind === "inherit") {
    return { value: { ...baseValue }, source: baseSource };
  }
  return { value: { ...overrideValue }, source: "session" };
}

function resolveThinking(
  overrideValue: SessionThinkingSetting,
  baseValue: ThinkingSetting,
  baseSource: Exclude<PreferenceSource, "session">,
): Resolved<ThinkingSetting> {
  if (overrideValue.kind === "inherit") {
    return { value: { ...baseValue }, source: baseSource };
  }
  return { value: { ...overrideValue }, source: "session" };
}
