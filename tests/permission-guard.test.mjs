import assert from "node:assert/strict";
import { test } from "node:test";

import { createPermissionGuard } from "../dist/policy/permission-guard.js";
import { PreferenceStore } from "../dist/state/store.js";

// The boundary is the guard's own factory: the host's permission event goes in, and what comes out is
// the effect the host acts on plus the denials the local log records. The store is the real one over a
// storage double, because the decision has to follow the same effective state the policy text does.

function storageDouble() {
  const records = new Map();
  return {
    records,
    async get(key) {
      const text = records.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    async set(key, value) {
      records.set(key, JSON.stringify(value));
    },
    async remove(key) {
      records.delete(key);
    },
  };
}

function model(providerID, id) {
  return {
    id,
    modelID: id,
    providerID,
    name: id,
    package: "@opencode/ai/providers/groq",
    enabled: true,
    limit: { context: 200000, output: 32000 },
    variants: [],
  };
}

const CATALOG = {
  async list() {
    return {
      location: { directory: "/synthetic" },
      data: [model("acme", "small-model")],
    };
  },
};

// What registration would have produced from the defaults used below.
const REGISTERED = [
  { id: "ocv2-small", model: { providerID: "acme", id: "small-model" } },
  { id: "ocv2-advisor-1", model: { providerID: "acme", id: "small-model" } },
];

async function delegationOn() {
  const store = new PreferenceStore(storageDouble());
  await store.saveDefaults({
    intensity: "normal",
    roles: {
      small: { kind: "configured", model: "acme/small-model" },
      medium: { kind: "disabled" },
      large: { kind: "disabled" },
    },
  });
  return store;
}

async function advisorsOn() {
  const store = await delegationOn();
  await store.saveDefaults({
    advisorMode: "on",
    advisors: { kind: "configured", models: ["acme/small-model"] },
  });
  return store;
}

async function delegationOff() {
  return new PreferenceStore(storageDouble());
}

function build({
  store,
  parents = {},
  sessionAgents = {},
  registered = REGISTERED,
  hook,
} = {}) {
  const denied = [];
  const guard = createPermissionGuard({
    store,
    catalog: CATALOG,
    agents: async () => registered,
    session: async (sessionID) => {
      if (parents[sessionID] === "fail") throw new Error("host detail");
      return { parentID: parents[sessionID], agent: sessionAgents[sessionID] };
    },
    denied: (denial) => denied.push(denial),
    hook,
  });
  return { guard, denied };
}

function launch(
  target,
  { sessionID = "root", launcher = "build", effect = "ask" } = {},
) {
  return {
    sessionID,
    agent: launcher,
    action: "subagent",
    resources: [target],
    effect,
  };
}

function toolCall(
  action,
  resources,
  { sessionID = "root", agent = "build", effect = "allow" } = {},
) {
  return { sessionID, agent, action, resources, effect };
}

// Every case below asserts the whole outcome: the effect the host acts on, the message it carries and
// the denials that were recorded. A guard that denied the right thing for the wrong reason, or that
// touched an event it should have left alone, would fail here.

test("a launch of a reserved role is refused while the session's policy does not offer it", async () => {
  const { guard, denied } = build({ store: await delegationOff() });
  const event = launch("ocv2-small");

  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
  assert.match(event.message, /does not offer ocv2-small/);
  assert.deepEqual(denied, [{ action: "subagent", agent: "ocv2-small" }]);
});

test("a launch the policy offers is left exactly as the host decided", async () => {
  const { guard, denied } = build({ store: await delegationOn() });

  const asking = launch("ocv2-small");
  await guard.evaluate(asking);
  assert.equal(asking.effect, "ask");
  assert.equal(asking.message, undefined);

  const allowed = launch("ocv2-small", { effect: "allow" });
  await guard.evaluate(allowed);
  assert.equal(allowed.effect, "allow");
  assert.deepEqual(denied, []);
});

test("a role the policy leaves out is refused even when another one is offered", async () => {
  const { guard, denied } = build({ store: await delegationOn() });
  const event = launch("ocv2-medium");

  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
  assert.deepEqual(denied, [{ action: "subagent", agent: "ocv2-medium" }]);
});

test("a role the host does not have on its configured model is refused", async () => {
  // The wiring's post-activation check drops an agent the host does not list on the model it was
  // created with, so `agents()` is what decides here, exactly as it decides what the block names.
  const { guard, denied } = build({
    store: await delegationOn(),
    registered: [],
  });
  const event = launch("ocv2-small");

  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
  assert.deepEqual(denied, [{ action: "subagent", agent: "ocv2-small" }]);
});

test("an Advisor is refused while Advisor mode is off, and offered when it is on", async () => {
  const off = build({ store: await delegationOn() });
  const refused = launch("ocv2-advisor-1");
  await off.guard.evaluate(refused);
  assert.equal(refused.effect, "deny");
  assert.deepEqual(off.denied, [
    { action: "subagent", agent: "ocv2-advisor-1" },
  ]);

  // "with-delegation" consults only while delegation is active, so turning delegation off takes the
  // Advisors with it.
  const withDelegation = await delegationOff();
  await withDelegation.saveDefaults({
    advisorMode: "with-delegation",
    advisors: { kind: "configured", models: ["acme/small-model"] },
  });
  const idle = build({ store: withDelegation });
  const notOffered = launch("ocv2-advisor-1");
  await idle.guard.evaluate(notOffered);
  assert.equal(notOffered.effect, "deny");

  const on = build({ store: await advisorsOn() });
  const offered = launch("ocv2-advisor-1");
  await on.guard.evaluate(offered);
  assert.equal(offered.effect, "ask");
  assert.deepEqual(on.denied, []);
});

test("an Advisor the read-only check removed is refused", async () => {
  // The wiring leaves an Advisor out when the host's own configuration reopened an action on it, so
  // the policy stops naming it and the guard refuses the launch for the same reason.
  const { guard, denied } = build({
    store: await advisorsOn(),
    registered: [
      { id: "ocv2-small", model: { providerID: "acme", id: "small-model" } },
    ],
  });
  const event = launch("ocv2-advisor-1");

  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
  assert.deepEqual(denied, [{ action: "subagent", agent: "ocv2-advisor-1" }]);
});

test("a delegated agent cannot launch a reserved agent, whatever the policy offers", async () => {
  const { guard, denied } = build({ store: await advisorsOn() });

  const fromRole = launch("ocv2-advisor-1", { launcher: "ocv2-small" });
  await guard.evaluate(fromRole);
  assert.equal(fromRole.effect, "deny");
  assert.match(fromRole.message, /only the main agent delegates/);

  // An Advisor is refused earlier and for the wider reason: launching is not reading.
  const fromAdvisor = launch("ocv2-small", { launcher: "ocv2-advisor-1" });
  await guard.evaluate(fromAdvisor);
  assert.equal(fromAdvisor.effect, "deny");
  assert.match(fromAdvisor.message, /may only read files/);

  // The log names the reserved agent the refusal is about: the target for a launch, the Advisor itself
  // when it is the Advisor's own permissions that refuse.
  assert.deepEqual(denied, [
    { action: "subagent", agent: "ocv2-advisor-1" },
    { action: "subagent", agent: "ocv2-advisor-1" },
  ]);
});

test("a child session follows the policy of the session it was launched from", async () => {
  const offered = build({
    store: await delegationOn(),
    parents: { child: "root" },
  });
  const allowed = launch("ocv2-small", { sessionID: "child" });
  await offered.guard.evaluate(allowed);
  assert.equal(allowed.effect, "ask");
  assert.deepEqual(offered.denied, []);

  // The store keeps no document for the child, so the root's settings are the ones that decide.
  const store = await delegationOff();
  await store.applySession("root", { intensity: "off" });
  const refused = build({ store, parents: { child: "root" } });
  const event = launch("ocv2-small", { sessionID: "child" });
  await refused.guard.evaluate(event);
  assert.equal(event.effect, "deny");
});

test("a launch of an agent the plugin does not own, or any other action, is left alone", async () => {
  const { guard, denied } = build({ store: await delegationOff() });

  const foreign = launch("explore");
  await guard.evaluate(foreign);
  assert.equal(foreign.effect, "ask");

  const other = toolCall("edit", ["src/index.ts"]);
  await guard.evaluate(other);
  assert.equal(other.effect, "allow");
  assert.equal(other.message, undefined);
  assert.deepEqual(denied, []);
});

test("an Advisor may only read", async () => {
  const { guard, denied } = build({ store: await delegationOff() });

  for (const action of [
    "edit",
    "shell",
    "execute",
    "subagent",
    "skill",
    "webfetch",
    "websearch",
    "question",
    "acme_search",
  ]) {
    const event = toolCall(action, ["src/index.ts"], {
      agent: "ocv2-advisor-1",
    });
    await guard.evaluate(event);
    assert.equal(event.effect, "deny", action);
    assert.match(event.message, /may only read files/);
  }

  for (const action of ["read", "glob", "grep"]) {
    const event = toolCall(action, ["src/index.ts"], {
      agent: "ocv2-advisor-2",
    });
    await guard.evaluate(event);
    assert.equal(event.effect, "allow", action);
  }
  assert.equal(denied.length, 9);
});

test("an Advisor may not read environment files, but the example file stays readable", async () => {
  const { guard } = build({ store: await delegationOff() });

  for (const resource of [
    ".env",
    "config/.env",
    "config/.env.local",
    "C:\\repo\\.env",
    "config/.env.example.local",
  ]) {
    const event = toolCall("read", [resource], { agent: "ocv2-advisor-1" });
    await guard.evaluate(event);
    assert.equal(event.effect, "deny", resource);
    assert.match(event.message, /may not read environment files/);
  }

  // `*.env.example` also matches the `*.env.*` deny; the last matching rule wins, as in the host.
  for (const resource of [".env.example", "config/.env.example"]) {
    const event = toolCall("read", [resource], { agent: "ocv2-advisor-1" });
    await guard.evaluate(event);
    assert.equal(event.effect, "allow", resource);
  }

  // `grep` asks with its pattern, not a path, so only `read` is narrowed.
  const searching = toolCall("grep", ["*.env"], { agent: "ocv2-advisor-1" });
  await guard.evaluate(searching);
  assert.equal(searching.effect, "allow");
});

test("the session's agent decides when the request does not name one", async () => {
  const { guard, denied } = build({
    store: await delegationOff(),
    sessionAgents: { session: "ocv2-advisor-1" },
  });

  // The host does not always name the asking agent on the event, so the session is asked instead.
  const event = {
    sessionID: "session",
    action: "edit",
    resources: ["src/index.ts"],
    effect: "allow",
  };
  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
  assert.deepEqual(denied, [{ action: "edit", agent: "ocv2-advisor-1" }]);
});

test("an Advisor's request is decided without the session's policy", async () => {
  // Fail-closed: once the agent is known to be an Advisor, nothing the plugin reads can fail between
  // that and the denial, so a broken store cannot open the Advisor's permissions.
  const { guard } = build({
    store: {
      async readSession() {
        throw new Error("host detail");
      },
    },
  });
  const event = toolCall("shell", ["npm test"], { agent: "ocv2-advisor-1" });

  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
});

test("a session whose agent cannot be resolved is left alone", async () => {
  const { guard, denied } = build({
    store: await delegationOff(),
    parents: { unknown: "fail" },
  });
  const event = {
    sessionID: "unknown",
    action: "edit",
    resources: ["src/index.ts"],
    effect: "allow",
  };

  await guard.evaluate(event);

  assert.equal(event.effect, "allow");
  assert.equal(event.message, undefined);
  assert.deepEqual(denied, []);
});

test("a policy that cannot be read refuses the launch instead of allowing it", async () => {
  const { guard, denied } = build({
    store: {
      async readSession() {
        throw new Error("host detail");
      },
    },
  });
  const event = launch("ocv2-small");

  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
  assert.match(event.message, /cannot be read/);
  assert.doesNotMatch(event.message, /host detail/);
  assert.deepEqual(denied, [{ action: "subagent", agent: "ocv2-small" }]);
});

test("an agent list that cannot be read refuses the launch instead of allowing it", async () => {
  const guard = createPermissionGuard({
    store: await delegationOn(),
    catalog: CATALOG,
    agents: async () => {
      throw new Error("host detail");
    },
    session: async () => ({ parentID: undefined }),
    denied: () => {},
  });
  const event = launch("ocv2-small");

  await guard.evaluate(event);

  assert.equal(event.effect, "deny");
  assert.match(event.message, /cannot be read/);
});

test("a deny another plugin produced is left exactly as it is", async () => {
  const { guard, denied } = build({ store: await delegationOff() });
  const event = {
    ...launch("ocv2-small"),
    effect: "deny",
    message: "another plugin said no",
  };

  await guard.evaluate(event);

  assert.equal(event.message, "another plugin said no");
  assert.deepEqual(denied, []);
});

test("a log that refuses does not change the decision, and the guard never rejects", async () => {
  const guard = createPermissionGuard({
    store: await delegationOff(),
    catalog: CATALOG,
    agents: async () => REGISTERED,
    session: async () => ({ parentID: undefined }),
    denied: () => {
      throw new Error("log unavailable");
    },
  });
  const event = launch("ocv2-small");

  await assert.doesNotReject(guard.evaluate(event));
  assert.equal(event.effect, "deny");
});

test("a host without the permission hook leaves the guard unavailable", async () => {
  const { guard } = build({ store: await delegationOff() });

  await guard.register();

  assert.equal(guard.state(), "unavailable");
});

test("the guard registers the host hook, reports itself active and retires it", async () => {
  const registered = [];
  const { guard } = build({
    store: await delegationOff(),
    hook: async (callback) => {
      registered.push(callback);
      return {
        dispose: async () => {
          registered.length = 0;
        },
      };
    },
  });

  await guard.register();
  assert.equal(guard.state(), "active");
  assert.equal(registered.length, 1);

  const event = launch("ocv2-small");
  await registered[0](event);
  assert.equal(event.effect, "deny");

  await guard.dispose();
  assert.equal(guard.state(), "unavailable");
  assert.equal(registered.length, 0);
  // A second disposal has nothing left to retire.
  await guard.dispose();
});
