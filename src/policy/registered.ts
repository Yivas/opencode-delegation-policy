import { advisorAgentID, ROLE_AGENTS } from "../agents/ids.js";
import type { AgentDefinition } from "../agents/register.js";
import type {
  DelegationValidation,
  ModelReference,
  ValidationIssue,
} from "../validation/models.js";

// A session can turn delegation on, but agents exist only for what the defaults defined when
// OpenCode started. The policy must not name an agent the host does not have, or one created with a
// different model: the main agent would be told to launch something that is not there. So the
// session's validation is narrowed to what is registered, and what is left out is reported as such.

function sameModel(
  agent: AgentDefinition | undefined,
  model: ModelReference,
): boolean {
  return (
    agent !== undefined &&
    agent.model.providerID === model.providerID &&
    agent.model.id === model.id
  );
}

export function restrictToRegistered(
  validation: DelegationValidation,
  agents: readonly AgentDefinition[],
): DelegationValidation {
  const byID = new Map(agents.map((agent) => [agent.id, agent]));
  return {
    delegation: restrictDelegation(validation.delegation, byID),
    advisor: restrictAdvisor(validation.advisor, byID),
  };
}

function restrictDelegation(
  axis: DelegationValidation["delegation"],
  byID: ReadonlyMap<string, AgentDefinition>,
): DelegationValidation["delegation"] {
  if (axis.status !== "active") return axis;
  const missing: ValidationIssue[] = axis.roles
    .filter(
      (selection) =>
        !sameModel(byID.get(ROLE_AGENTS[selection.role].id), selection.model),
    )
    .map((selection) => ({
      field: "roles",
      role: selection.role,
      code: "agent-not-registered",
    }));
  if (missing.length === 0) return axis;
  // A missing role changes which roles exist, and task fit would plan around a gap the user did not
  // choose. As with an unset ordinary role, delegation stops rather than half-working; the status
  // says which agent is missing and that a restart picks up the defaults.
  return { status: "error", issues: missing };
}

function restrictAdvisor(
  axis: DelegationValidation["advisor"],
  byID: ReadonlyMap<string, AgentDefinition>,
): DelegationValidation["advisor"] {
  if (axis.status !== "active" && axis.status !== "partial") return axis;
  const missing: ValidationIssue[] = [];
  const advisors = axis.advisors.filter((selection) => {
    const present = sameModel(
      byID.get(advisorAgentID(selection.advisor)),
      selection.model,
    );
    if (!present) {
      missing.push({
        field: "advisors",
        advisor: selection.advisor,
        code: "agent-not-registered",
      });
    }
    return present;
  });
  if (missing.length === 0) return axis;
  const issues = [
    ...(axis.status === "partial" ? axis.issues : []),
    ...missing,
  ];
  // Advisors stand alone, as in validation: the registered ones are still consulted.
  if (advisors.length === 0) return { status: "error", issues };
  return { status: "partial", advisors, issues, warnings: axis.warnings };
}
