import type { EffectivePreferences } from "../state/effective.js";
import { ROLE_KEYS, type RoleKey } from "../state/schema.js";

// Pi 0.22's configuration notice, adapted. After an effective change, the next request of the main
// agent carries a short notice of what changed, so earlier settings quoted in the conversation do not
// keep steering it. Two host facts make this possible here, both from the published plugin docs at
// the pinned revision (build/plugins/index.mdx): a `context` hook's changes "affect only the outgoing
// model call, not persisted history", and the event stream reports `session.execution.succeeded`.
// The notice is repeated on every request of a turn and consumed only when that turn succeeds; a
// failed or interrupted turn leaves it for the next one, as Pi never consumes on an unknown outcome.

export const NOTICE_METADATA_KEY = "opencode-delegation-policy.notice";
export const NOTICE_MARKER = "<!-- opencode-delegation-policy:notice -->";
export const BOTH_OFF_LINE = "Delegation and Advisor disabled by this policy.";

const ROLE_LABELS: Readonly<Record<RoleKey, string>> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
  visualDesign: "Visual Design",
};

// The values the notice compares. Derived status stays out: model availability, validation results
// and which agents the host has cannot produce a notice, and neither can the rendered policy text.
export type NoticeProjection = {
  readonly fields: readonly {
    readonly label: string;
    readonly value: string;
  }[];
  readonly axesOff: boolean;
};

export function projectNotice(
  preferences: EffectivePreferences,
): NoticeProjection {
  const role = (key: RoleKey) => {
    const setting = preferences.roles[key];
    if (setting.kind === "configured") return setting.model;
    return setting.kind === "disabled" ? "disabled" : "not configured";
  };
  const thinking = (key: RoleKey) => {
    const setting = preferences.thinking[key];
    if (setting.kind === "fixed") return `fixed ${setting.level}`;
    if (setting.kind === "range") return `range ${setting.from}..${setting.to}`;
    return "unset";
  };
  const advisors =
    preferences.advisors.kind === "configured"
      ? preferences.advisors.models
      : [];
  return {
    fields: [
      { label: "Delegation intensity", value: preferences.intensity },
      { label: "Model preference", value: preferences.preference },
      ...ROLE_KEYS.map((key) => ({
        label: `${ROLE_LABELS[key]} model`,
        value: role(key),
      })),
      ...ROLE_KEYS.map((key) => ({
        label: `${ROLE_LABELS[key]} thinking`,
        value: thinking(key),
      })),
      { label: "Advisor mode", value: preferences.advisorMode },
      ...[0, 1, 2].map((index) => ({
        label: `Advisor ${index + 1} model`,
        value: advisors[index] ?? "none",
      })),
    ],
    // "with-delegation" consults only while delegation is on, so with intensity off it is off too.
    axesOff:
      preferences.intensity === "off" && preferences.advisorMode !== "on",
  };
}

// One `- label: previous -> current` line per changed field, in a fixed order. While both axes are
// already off, an edit changes nothing the model can act on, so only the transition into that state
// speaks, once.
export function noticeLines(
  previous: NoticeProjection,
  current: NoticeProjection,
): string[] {
  const lines = current.fields.flatMap((field, index) => {
    const before = previous.fields[index]?.value;
    return before === field.value
      ? []
      : [`- ${field.label}: ${before ?? "none"} -> ${field.value}`];
  });
  if (lines.length === 0 || !current.axesOff) return lines;
  return previous.axesOff ? [] : [`- ${BOTH_OFF_LINE}`];
}

export function renderNotice(lines: readonly string[]): string {
  return [
    "<delegation_config_notice>",
    NOTICE_MARKER,
    "This notice comes from the opencode-delegation-policy plugin, not from the user.",
    "The /delegate configuration changed before this turn:",
    ...lines,
    "The delegation policy in the system prompt, when present, states the values in force for the present request.",
    "For new work, follow the current valid assignments and thinking rules in this policy, not earlier settings in the conversation.",
    "This notice only records what changed in this plugin's configuration and revokes no other instruction, permission, or authority.",
    "</delegation_config_notice>",
  ].join("\n");
}

// Sessions whose notice state is remembered; past it the oldest is forgotten and starts again from
// whatever it sees next, which only means one change may go unannounced.
const MAX_SESSIONS = 512;

type SessionNotice = {
  // What the model has been told: the configuration of the last notice consumed by a successful turn,
  // or the first one this process saw for the session.
  baseline: NoticeProjection;
  // The configuration shown in the notice of the turn in progress, until that turn succeeds.
  presented?: NoticeProjection;
};

export type NoticeTracker = {
  // The notice text for this request, or undefined when nothing changed since the baseline.
  forRequest(sessionID: string, current: NoticeProjection): string | undefined;
  // A turn that succeeded consumed whatever notice it carried.
  succeeded(sessionID: string): void;
};

export function createNoticeTracker(): NoticeTracker {
  const sessions = new Map<string, SessionNotice>();
  return {
    forRequest(sessionID, current) {
      const known = sessions.get(sessionID);
      if (known === undefined) {
        // Nothing was told before in this process, so there is nothing to correct yet. A restart loses
        // the baseline: a change made while OpenCode was stopped is not announced.
        sessions.set(sessionID, { baseline: current });
        if (sessions.size > MAX_SESSIONS) {
          const oldest = sessions.keys().next().value;
          if (oldest !== undefined) sessions.delete(oldest);
        }
        return undefined;
      }
      const lines = noticeLines(known.baseline, current);
      if (lines.length === 0) {
        // No change, or a change that was reverted before any turn consumed it.
        known.presented = undefined;
        return undefined;
      }
      known.presented = current;
      return renderNotice(lines);
    },
    succeeded(sessionID) {
      const known = sessions.get(sessionID);
      if (known?.presented === undefined) return;
      known.baseline = known.presented;
      known.presented = undefined;
    },
  };
}
