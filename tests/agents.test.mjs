import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentDefinitions,
  applyDefinition,
  registerAgentDefinitions,
} from "../dist/agents/register.js";
import { advisorAgentID, isAdvisorAgentID } from "../dist/agents/ids.js";
import {
  actionsNotDenied,
  advisorSafetyIssues,
} from "../dist/agents/safety.js";

// Editor double with the transform-input surface: agents are plain objects, updates mutate in place
// and an absent id is created, exactly as the host editor does.
function editorDouble(initial = {}) {
  const agents = new Map(Object.entries(structuredClone(initial)));
  const writes = [];
  return {
    agents,
    writes,
    editor: {
      get(id) {
        return agents.get(id);
      },
      list() {
        return [...agents.values()];
      },
      default() {},
      update(id, mutate) {
        writes.push(id);
        const existing = agents.get(id) ?? {
          id,
          name: id,
          mode: "primary",
          hidden: false,
          permissions: [],
        };
        mutate(existing);
        agents.set(id, existing);
      },
      remove(id) {
        agents.delete(id);
      },
    },
  };
}

function role(role, providerID, id, thinking = { kind: "unset" }) {
  return { role, model: { providerID, id }, thinking };
}

function advisor(entry, providerID, id, extra = {}) {
  return {
    advisor: entry,
    model: { providerID, id },
    launchModel: { providerID, id },
    variants: [],
    ...extra,
  };
}

// The actions the built-in tools of OpenCode 2.2.6 ask for, minus the read ones. Kept as a literal
// here so the profile is checked against the host's action names rather than against itself.
const ADVISOR_DENIED_ACTIONS = [
  "edit",
  "shell",
  "execute",
  "subagent",
  "skill",
  "webfetch",
  "websearch",
  "external_directory",
  "question",
];
const ADVISOR_READ_ACTIONS = ["read", "glob", "grep"];

test("an enabled role becomes a subagent with its exact model and a scope instruction", () => {
  const definitions = agentDefinitions({
    roles: [role("small", "acme", "small-model")],
    advisors: [],
  });

  assert.equal(definitions.length, 1);
  const [definition] = definitions;
  assert.equal(definition.id, "ocv2-small");
  assert.equal(definition.name, "Small");
  assert.equal(definition.mode, "subagent");
  assert.deepEqual(definition.model, { providerID: "acme", id: "small-model" });
  // An ordinary role declares no permission list, so registration leaves the host's base rules in
  // place; writing an empty list would turn every action into "ask".
  assert.equal(definition.permissions, undefined);
  assert.match(definition.system, /delegated task/);
});

test("a variant is registered only when the configuration leaves one choice", () => {
  const single = {
    kind: "options",
    options: [
      {
        variant: "deep",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
        evidence: "synthetic",
      },
    ],
  };
  const several = {
    kind: "options",
    options: [
      ...single.options,
      {
        variant: "fast",
        transportKind: "native",
        compatibleLevels: ["low"],
        admittedLevels: ["low"],
        evidence: "synthetic",
      },
    ],
  };
  const definitions = agentDefinitions({
    roles: [
      role("small", "acme", "one", single),
      role("medium", "acme", "many", several),
      role("large", "acme", "inline", {
        kind: "inline",
        variant: "deep",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
        evidence: "synthetic",
      }),
    ],
    advisors: [],
  });

  assert.deepEqual(
    definitions.map(({ id, model }) => [id, model]),
    [
      ["ocv2-small", { providerID: "acme", id: "one", variant: "deep" }],
      ["ocv2-medium", { providerID: "acme", id: "many" }],
      ["ocv2-large", { providerID: "acme", id: "inline", variant: "deep" }],
    ],
  );
});

test("each advisor is registered under its own number with read-only tools", () => {
  const definitions = agentDefinitions({
    roles: [],
    advisors: [
      advisor(1, "acme", "same-model"),
      advisor(2, "acme", "same-model"),
      advisor(3, "acme", "same-model", {
        variantSkipped: true,
        launchModel: { providerID: "acme", id: "other-model" },
      }),
    ],
  });

  // Two entries with the same model still get separate ids, in configuration order.
  assert.deepEqual(
    definitions.map(({ id, name }) => [id, name]),
    [
      ["ocv2-advisor-1", "Advisor 1"],
      ["ocv2-advisor-2", "Advisor 2"],
      ["ocv2-advisor-3", "Advisor 3"],
    ],
  );
  // The launch model is what the agent carries, so a skipped variant is never registered.
  assert.deepEqual(definitions[2]?.model, {
    providerID: "acme",
    id: "other-model",
  });
  for (const definition of definitions) {
    assert.equal(definition.mode, "subagent");
    assert.match(definition.system, /advice only/);
    // The read allows follow the wildcard deny, because the last matching rule wins; only the
    // environment-file narrowing of `read` comes after them.
    assert.deepEqual(definition.permissions.slice(-6), [
      { action: "read", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "allow" },
      { action: "grep", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "read", resource: "*.env.*", effect: "deny" },
      { action: "read", resource: "*.env.example", effect: "allow" },
    ]);
    assert.equal(ADVISOR_READ_ACTIONS.length, 3);
    // Every other action is denied explicitly, and the wildcard deny covers what the host or
    // another extension adds, including MCP tools named `<server>_<tool>`.
    for (const action of ADVISOR_DENIED_ACTIONS) {
      assert.ok(
        definition.permissions.some(
          (rule) => rule.action === action && rule.effect === "deny",
        ),
        action,
      );
    }
    assert.ok(
      definition.permissions.some(
        (rule) =>
          rule.action === "*" &&
          rule.resource === "*" &&
          rule.effect === "deny",
      ),
    );
    // Reading is the whole of the advisor's authority.
    assert.deepEqual(
      definition.permissions
        .filter((rule) => rule.effect === "allow")
        .map((rule) => rule.action)
        .sort(),
      // The second `read` re-allows only `*.env.example` after the environment files are denied.
      [...ADVISOR_READ_ACTIONS, "read"].sort(),
    );
  }
  assert.equal(advisorAgentID(2), "ocv2-advisor-2");
  // The same shape decides whether a definition is an advisor, so an id cannot be built one way and
  // recognised another.
  for (const definition of definitions) {
    assert.equal(isAdvisorAgentID(definition.id), true);
  }
  assert.equal(isAdvisorAgentID("ocv2-small"), false);
});

test("registering writes every defined field on the reserved ids", () => {
  const { editor, agents, writes } = editorDouble();
  const definitions = agentDefinitions({
    roles: [role("small", "acme", "small-model")],
    advisors: [advisor(1, "acme", "advisor-model")],
  });

  const result = registerAgentDefinitions({
    editor,
    definitions,
    created: new Set(),
  });

  assert.deepEqual(result, {
    registered: ["ocv2-small", "ocv2-advisor-1"],
    removed: [],
  });
  assert.deepEqual(writes, ["ocv2-small", "ocv2-advisor-1"]);
  assert.equal(agents.get("ocv2-small")?.model.id, "small-model");
  assert.equal(agents.get("ocv2-small")?.mode, "subagent");
  assert.deepEqual(agents.get("ocv2-advisor-1")?.permissions.at(-1), {
    action: "read",
    resource: "*.env.example",
    effect: "allow",
  });
});

test("an ordinary role keeps the host's base permission rules", () => {
  const baseRules = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
  ];
  const { editor, agents } = editorDouble({
    "ocv2-small": {
      id: "ocv2-small",
      name: "Small",
      mode: "subagent",
      hidden: false,
      permissions: structuredClone(baseRules),
    },
  });

  registerAgentDefinitions({
    editor,
    definitions: agentDefinitions({
      roles: [role("small", "acme", "small-model")],
      advisors: [],
    }),
    created: new Set(),
  });

  assert.deepEqual(agents.get("ocv2-small")?.permissions, baseRules);
});

test("the reserved ids are upserted without inspecting what is already there", () => {
  const userAgent = {
    id: "ocv2-small",
    name: "My own small",
    mode: "subagent",
    hidden: false,
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  };
  const { editor, agents } = editorDouble({ "ocv2-small": userAgent });

  const result = registerAgentDefinitions({
    editor,
    definitions: agentDefinitions({
      roles: [role("small", "acme", "small-model")],
      advisors: [],
    }),
    created: new Set(),
  });

  // No owner field exists and config can rewrite the fields we set, so ownership cannot be
  // inferred. The exact ids are reserved and documented; everything else is left untouched.
  assert.deepEqual(result.registered, ["ocv2-small"]);
  assert.equal(agents.get("ocv2-small")?.model.id, "small-model");
  // The role declares no permission list, so the user's own rules survive registration.
  assert.deepEqual(agents.get("ocv2-small")?.permissions, [
    { action: "*", resource: "*", effect: "allow" },
  ]);
});

test("re-registering replaces stale values and removes only what this process created", () => {
  const { editor, agents } = editorDouble();
  const created = new Set();
  registerAgentDefinitions({
    editor,
    definitions: agentDefinitions({
      roles: [role("small", "acme", "old-model")],
      advisors: [advisor(1, "acme", "advisor-model")],
    }),
    created,
  });

  const result = registerAgentDefinitions({
    editor,
    definitions: agentDefinitions({
      roles: [role("small", "acme", "new-model")],
      advisors: [],
    }),
    created,
  });

  assert.equal(agents.get("ocv2-small")?.model.id, "new-model");
  // The advisor existed because this process created it, so dropping it from the configuration
  // removes it instead of leaving a launchable orphan behind.
  assert.deepEqual(result.removed, ["ocv2-advisor-1"]);
  assert.equal(agents.has("ocv2-advisor-1"), false);
  assert.deepEqual([...created], ["ocv2-small"]);
});

test("an agent that was already there is never removed on inference", () => {
  const leftover = {
    id: "ocv2-advisor-2",
    name: "Advisor 2",
    mode: "subagent",
    hidden: false,
    permissions: [],
  };
  const { editor, agents } = editorDouble({ "ocv2-advisor-2": leftover });

  const result = registerAgentDefinitions({
    editor,
    definitions: agentDefinitions({
      roles: [role("small", "acme", "small-model")],
      advisors: [],
    }),
    created: new Set(),
  });

  // Left over from a previous run: reported as nothing, kept, because deletion cannot be proven safe.
  assert.deepEqual(result.removed, []);
  assert.ok(agents.has("ocv2-advisor-2"));
});

test("applying a definition without a permission list leaves the host rules alone", () => {
  const baseRules = [{ action: "*", resource: "*", effect: "allow" }];
  const agent = {
    name: "stale",
    description: "stale",
    system: "stale",
    mode: "primary",
    hidden: true,
    model: { providerID: "old", id: "old" },
    permissions: structuredClone(baseRules),
  };

  applyDefinition(agent, {
    id: "ocv2-small",
    name: "Small",
    description: "Role.",
    system: "Work on the delegated task.",
    mode: "subagent",
    model: { providerID: "acme", id: "model" },
  });

  assert.deepEqual(agent.permissions, baseRules);
  assert.equal(agent.mode, "subagent");
  assert.equal(agent.hidden, false);
});

test("applying an advisor definition replaces any existing rules with its own list", () => {
  const agent = {
    name: "stale",
    description: "stale",
    system: "stale",
    mode: "primary",
    hidden: true,
    model: { providerID: "old", id: "old" },
    permissions: [{ action: "*", resource: "*", effect: "allow" }],
  };

  applyDefinition(agent, {
    id: "ocv2-advisor-1",
    name: "Advisor 1",
    description: "Advice only.",
    system: "Advise.",
    mode: "subagent",
    model: { providerID: "acme", id: "model", variant: "deep" },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  });

  assert.deepEqual(agent, {
    name: "Advisor 1",
    description: "Advice only.",
    system: "Advise.",
    mode: "subagent",
    hidden: false,
    model: { providerID: "acme", id: "model", variant: "deep" },
    permissions: [{ action: "*", resource: "*", effect: "deny" }],
  });
});

const ADVISOR_PROFILE = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "read", resource: "*", effect: "allow" },
  { action: "glob", resource: "*", effect: "allow" },
  { action: "grep", resource: "*", effect: "allow" },
];

function advisorDefinition(id) {
  return {
    id,
    name: "Advisor",
    description: "Advice only.",
    system: "Advise.",
    mode: "subagent",
    model: { providerID: "acme", id: "model" },
    permissions: ADVISOR_PROFILE,
  };
}

function advisorIssues(permissions) {
  const id = "ocv2-advisor-1";
  return advisorSafetyIssues({
    definitions: [advisorDefinition(id)],
    effective: [{ id, permissions }],
  });
}

test("an advisor with the read-only profile raises no issue", () => {
  assert.deepEqual(advisorIssues(ADVISOR_PROFILE), []);
  // The host's own base rules and any global config rules can sit before the profile: the profile's
  // wildcard deny and read allows are the last rules that match, so earlier ones grant nothing.
  assert.deepEqual(
    advisorIssues([
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      ...ADVISOR_PROFILE,
    ]),
    [],
  );
});

test("an allow the host config appends after the profile is reported for that action", () => {
  // This is the documented order: config runs after the transform and the last matching rule wins.
  assert.deepEqual(
    advisorIssues([
      ...ADVISOR_PROFILE,
      { action: "shell", resource: "*", effect: "allow" },
    ]),
    [{ kind: "actions-not-denied", id: "ocv2-advisor-1", actions: ["shell"] }],
  );
});

test("an allow for every action reopens the whole boundary", () => {
  const [issue] = advisorIssues([
    ...ADVISOR_PROFILE,
    { action: "*", resource: "*", effect: "allow" },
  ]);

  assert.equal(issue.kind, "actions-not-denied");
  for (const action of ["edit", "shell", "subagent", "webfetch", "*"]) {
    assert.ok(issue.actions.includes(action), action);
  }
});

test("a narrower allow still counts as a hole, and ask is not treated as safe", () => {
  assert.deepEqual(
    advisorIssues([
      ...ADVISOR_PROFILE,
      { action: "edit", resource: "src/**", effect: "allow" },
      { action: "subagent", resource: "*", effect: "ask" },
    ]),
    [
      {
        kind: "actions-not-denied",
        id: "ocv2-advisor-1",
        actions: ["edit", "subagent"],
      },
    ],
  );
});

test("an action the profile never names is checked too", () => {
  // An MCP tool asks for `<server>_<tool>`, so the wildcard deny is what closes it; a rule that
  // names one of those actions still has to leave it closed.
  assert.deepEqual(
    advisorIssues([
      ...ADVISOR_PROFILE,
      { action: "acme_search", resource: "*", effect: "allow" },
    ]),
    [
      {
        kind: "actions-not-denied",
        id: "ocv2-advisor-1",
        actions: ["acme_search"],
      },
    ],
  );
});

test("narrowing a read action is not reported", () => {
  // The check rejects widening, not narrowing: taking reading away cannot grant anything else, and
  // a user who hides a secret from the advisor should keep it usable.
  assert.deepEqual(
    advisorIssues([
      ...ADVISOR_PROFILE,
      { action: "read", resource: "*.env", effect: "deny" },
      { action: "grep", resource: "*", effect: "ask" },
    ]),
    [],
  );
});

test("a scoped deny does not close the action for the rest of its resources", () => {
  // Replacing the plugin's rules with a narrow deny is exactly the config case this check exists
  // for: `edit` on `src/**` is denied, but every other edit is not.
  const issues = advisorIssues([
    { action: "edit", resource: "src/**", effect: "deny" },
  ]);

  assert.equal(issues.length, 1);
  const [issue] = issues;
  assert.equal(issue.kind, "actions-not-denied");
  assert.ok(issue.actions.includes("edit"));
  assert.ok(issue.actions.includes("*"));
});

test("an advisor that is missing from the effective catalog is reported", () => {
  const issues = advisorSafetyIssues({
    definitions: [advisorDefinition("ocv2-advisor-1")],
    effective: [],
  });

  assert.deepEqual(issues, [{ kind: "unregistered", id: "ocv2-advisor-1" }]);
});

test("rules are matched by action with the wildcard, last match winning", () => {
  assert.deepEqual(
    actionsNotDenied([
      { action: "*", resource: "*", effect: "deny" },
      { action: "*", resource: "*", effect: "allow" },
    ]).includes("shell"),
    true,
  );
  assert.deepEqual(
    actionsNotDenied([
      { action: "*", resource: "*", effect: "allow" },
      { action: "*", resource: "*", effect: "deny" },
    ]),
    [],
  );
});

test("an empty rule list leaves every action unclosed", () => {
  const actions = actionsNotDenied([]);

  assert.ok(actions.includes("edit"));
  assert.ok(actions.includes("*"));
});

test("a role with an inline variant but no thinking policy registers without the variant", () => {
  // The variant exists in the catalogue, but its level is unproven, so it is not launched; the same
  // rule that keeps an unproven advisor default out of a launch.
  const definitions = agentDefinitions({
    roles: [
      {
        role: "small",
        model: { providerID: "acme", id: "small-model", variant: "deep" },
        thinking: { kind: "unset" },
      },
    ],
    advisors: [],
  });

  assert.deepEqual(definitions[0]?.model, {
    providerID: "acme",
    id: "small-model",
  });
});
