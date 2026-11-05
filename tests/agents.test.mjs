import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentDefinitions,
  advisorAgentID,
  applyDefinition,
  registerAgentDefinitions,
} from "../dist/agents/register.js";

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

const ADVISOR_DENIED_ACTIONS = [
  "read",
  "edit",
  "shell",
  "execute",
  "subagent",
  "skill",
  "webfetch",
  "websearch",
  "external_directory",
];

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
  assert.deepEqual(definition.permissions, []);
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

test("each advisor is registered under its own number with every action denied", () => {
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
    // Every known action is denied explicitly and the wildcard comes last, because an action no
    // rule matches falls back to "ask" rather than "deny".
    assert.deepEqual(definition.permissions.at(-1), {
      action: "*",
      resource: "*",
      effect: "deny",
    });
    for (const action of ADVISOR_DENIED_ACTIONS) {
      assert.ok(
        definition.permissions.some(
          (rule) => rule.action === action && rule.effect === "deny",
        ),
        action,
      );
    }
  }
  assert.equal(advisorAgentID(2), "ocv2-advisor-2");
});

test("registering writes every defined field on the reserved ids", () => {
  const { editor, agents, writes } = editorDouble();
  const definitions = agentDefinitions({
    roles: [role("small", "acme", "small-model")],
    advisors: [advisor(1, "acme", "advisor-model")],
  });

  const result = registerAgentDefinitions({ editor, definitions });

  assert.deepEqual(result, {
    registered: ["ocv2-small", "ocv2-advisor-1"],
  });
  assert.deepEqual(writes, ["ocv2-small", "ocv2-advisor-1"]);
  assert.equal(agents.get("ocv2-small")?.model.id, "small-model");
  assert.equal(agents.get("ocv2-small")?.mode, "subagent");
  assert.deepEqual(agents.get("ocv2-advisor-1")?.permissions.at(-1), {
    action: "*",
    resource: "*",
    effect: "deny",
  });
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
  });

  // No owner field exists and config can rewrite the fields we set, so ownership cannot be
  // inferred. The exact ids are reserved and documented; everything else is left untouched.
  assert.deepEqual(result.registered, ["ocv2-small"]);
  assert.equal(agents.get("ocv2-small")?.model.id, "small-model");
  assert.deepEqual(agents.get("ocv2-small")?.permissions, []);
});

test("re-registering replaces stale values instead of piling them up", () => {
  const { editor, agents } = editorDouble();
  registerAgentDefinitions({
    editor,
    definitions: agentDefinitions({
      roles: [role("small", "acme", "old-model")],
      advisors: [advisor(1, "acme", "advisor-model")],
    }),
  });

  registerAgentDefinitions({
    editor,
    definitions: agentDefinitions({
      roles: [role("small", "acme", "new-model")],
      advisors: [],
    }),
  });

  assert.equal(agents.get("ocv2-small")?.model.id, "new-model");
  // Registration never deletes: an advisor dropped from the configuration stays until the
  // effective catalog is checked after activation, because deletion cannot be proven safe.
  assert.ok(agents.has("ocv2-advisor-1"));
});

test("applying a definition sets every owned field explicitly", () => {
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
