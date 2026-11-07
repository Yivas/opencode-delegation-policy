import type { AgentDefinition } from "./agents/register.js";
import type { AdvisorToken, DelegationToken, FooterState } from "./footer.js";
import { restrictToRegistered } from "./policy/registered.js";
import type { PreferenceView } from "./state/effective.js";
import { PreferenceStateError } from "./state/schema.js";
import type { PreferenceStore } from "./state/store.js";
import {
  type DelegationValidation,
  type ModelCatalog,
  validatePreferenceAxes,
} from "./validation/models.js";

// The server side of the footer: the same reading the policy injection makes, reduced to one token
// per axis. It describes what the main agent of that session would receive, not a saved value.

export type FooterStatePorts = {
  readonly store: Pick<PreferenceStore, "readNext" | "readSession">;
  readonly catalog: ModelCatalog;
  readonly agents: () => Promise<readonly AgentDefinition[]>;
  // The session's parent, if it has one. A child session never receives the policy.
  readonly parentOf: (sessionID: string) => Promise<string | undefined>;
};

const INTENSITY_TOKENS = {
  normal: "NORM",
  aggressive: "AGG",
  orchestrator: "ORCH",
} as const;

const OFF: FooterState = { delegation: "OFF", advisor: "OFF" };
const ERRORED: FooterState = { delegation: "ERR", advisor: "ERR" };

export async function footerState(
  ports: FooterStatePorts,
  sessionID: string | undefined,
): Promise<FooterState> {
  if (sessionID !== undefined) {
    let parent: string | undefined;
    try {
      parent = await ports.parentOf(sessionID);
    } catch {
      // The injection fails the same lookup and attaches nothing.
      return ERRORED;
    }
    if (parent !== undefined && parent !== "") return OFF;
  }

  let view: PreferenceView;
  try {
    // At home the label describes the session that would open next, so a setting saved for it is
    // shown as what it is: the values that session will start with.
    view =
      sessionID === undefined
        ? (await ports.store.readNext()).view
        : await ports.store.readSession(sessionID);
  } catch (error) {
    // An unreadable or future document fails both axes, as it does for the policy.
    if (error instanceof PreferenceStateError) return ERRORED;
    throw error;
  }

  const validated = await validatePreferenceAxes({
    preferences: view.preferences,
    catalog: ports.catalog,
  });
  let axes: DelegationValidation;
  try {
    axes = restrictToRegistered(validated, await ports.agents());
  } catch {
    // Without the host's agent list the injection attaches nothing, so no active axis works.
    axes = {
      delegation:
        validated.delegation.status === "off"
          ? validated.delegation
          : { status: "error", issues: [] },
      advisor:
        validated.advisor.status === "off"
          ? validated.advisor
          : { status: "error", issues: [] },
    };
  }

  const intensity = view.preferences.intensity;
  const delegation: DelegationToken =
    axes.delegation.status === "off" || intensity === "off"
      ? "OFF"
      : axes.delegation.status === "error"
        ? "ERR"
        : INTENSITY_TOKENS[intensity];
  const advisor: AdvisorToken =
    axes.advisor.status === "off"
      ? "OFF"
      : axes.advisor.status === "error"
        ? "ERR"
        : axes.advisor.status === "partial"
          ? "PART"
          : "ON";
  return { delegation, advisor };
}
