import assert from "node:assert/strict";
import { test } from "node:test";

import { createLocalLog, LOG_PREFIX } from "../dist/log/local-log.js";

function storageDouble({ failWrites = false } = {}) {
  const records = new Map();
  return {
    records,
    async get(key) {
      return records.get(key);
    },
    async set(key, value) {
      if (failWrites) throw new Error("disk full");
      records.set(key, structuredClone(value));
    },
    async remove(key) {
      records.delete(key);
    },
    async scan({ prefix, after, limit = 1000 }) {
      const keys = [...records.keys()]
        .filter(
          (key) =>
            key.startsWith(prefix) && (after === undefined || key > after),
        )
        .sort();
      const page = keys.slice(0, limit);
      return {
        entries: page.map((key) => ({ key, value: records.get(key) })),
        ...(keys.length > limit ? { next: page.at(-1) } : {}),
      };
    },
  };
}

const PREFERENCES = {
  intensity: "normal",
  preference: "standard",
  advisorMode: "on",
};

const SECRET = "private prompt text that must never be logged";

function entries(storage) {
  return [...storage.records.entries()]
    .filter(([key]) => key.startsWith(LOG_PREFIX))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
}

test("a policy is logged once per distinct block, as a hash and its modes", async () => {
  const storage = storageDouble();
  let clock = 1_000;
  const log = createLocalLog({
    storage,
    hostVersion: "2.0.21",
    now: () => clock,
  });

  log.policy(`<delegation_policy>${SECRET}</delegation_policy>`, PREFERENCES);
  clock += 1;
  log.policy(`<delegation_policy>${SECRET}</delegation_policy>`, PREFERENCES);
  clock += 1;
  log.policy("<delegation_policy>changed</delegation_policy>", PREFERENCES);
  await log.flush();

  const logged = entries(storage);
  assert.equal(logged.length, 2);
  assert.equal(logged[0].kind, "policy");
  assert.equal(logged[0].intensity, "normal");
  assert.match(logged[0].hash, /^[0-9a-f]{16}$/);
  assert.notEqual(logged[0].hash, logged[1].hash);
  assert.doesNotMatch(JSON.stringify(logged), /private prompt/);
});

test("a launch of a plugin agent is logged with its outcome and no content", async () => {
  const storage = storageDouble();
  let clock = 0;
  const log = createLocalLog({
    storage,
    hostVersion: "2.0.21",
    now: () => clock,
  });

  log.observe({
    type: "session.tool.input.started",
    data: { sessionID: "ses_secret", id: "call_1", name: "subagent" },
  });
  log.observe({
    type: "session.tool.called",
    data: {
      sessionID: "ses_secret",
      id: "call_1",
      input: {
        agent: "ocv2-advisor-1",
        model: "acme/wise#high",
        prompt: SECRET,
        description: SECRET,
        background: true,
      },
    },
  });
  clock = 1_500;
  log.observe({
    type: "session.tool.success",
    data: {
      sessionID: "ses_secret",
      id: "call_1",
      content: [{ type: "text", text: SECRET }],
      metadata: { status: "running" },
    },
  });
  await log.flush();

  const [entry] = entries(storage);
  assert.deepEqual(
    { ...entry, at: undefined },
    {
      v: 1,
      at: undefined,
      kind: "launch",
      host: "2.0.21",
      agent: "ocv2-advisor-1",
      model: "acme/wise#high",
      background: true,
      outcome: "running",
      ms: 1_500,
    },
  );
  assert.doesNotMatch(
    JSON.stringify(entries(storage)),
    /private prompt|ses_secret/,
  );
});

test("launches of agents that are not the plugin's, and other tools, are not logged", async () => {
  const storage = storageDouble();
  const log = createLocalLog({ storage, hostVersion: "2.0.21" });
  const call = (id, name, agent) => {
    log.observe({ type: "session.tool.input.started", data: { id, name } });
    log.observe({
      type: "session.tool.called",
      data: { id, input: { agent } },
    });
    log.observe({ type: "session.tool.failed", data: { id } });
  };

  call("a", "subagent", "general");
  call("b", "read", "ocv2-small");
  await log.flush();

  assert.deepEqual(entries(storage), []);
});

test("a failed launch is logged as failed", async () => {
  const storage = storageDouble();
  const log = createLocalLog({ storage, hostVersion: "2.0.21" });

  log.observe({
    type: "session.tool.input.started",
    data: { id: "c", name: "subagent" },
  });
  log.observe({
    type: "session.tool.called",
    data: { id: "c", input: { agent: "ocv2-small" } },
  });
  log.observe({
    type: "session.tool.failed",
    data: { id: "c", error: { message: SECRET } },
  });
  await log.flush();

  const [entry] = entries(storage);
  assert.equal(entry.outcome, "failed");
  assert.equal("model" in entry, false);
  assert.doesNotMatch(JSON.stringify(entry), /private prompt/);
});

test("old entries are removed past the limit, newest kept", async () => {
  const storage = storageDouble();
  let clock = 0;
  const log = createLocalLog({
    storage,
    hostVersion: "2.0.21",
    now: () => clock,
  });

  for (let index = 0; index < 525; index += 1) {
    clock += 1;
    log.policy(`block ${index}`, PREFERENCES);
  }
  await log.flush();

  const keys = [...storage.records.keys()].sort();
  assert.equal(keys.length, 500);
  // The 25 oldest went; the newest is still there.
  assert.equal(
    keys[0],
    `${LOG_PREFIX}${String(26).padStart(15, "0")}-${String(26).padStart(6, "0")}`,
  );
});

test("a log that cannot be written never throws", async () => {
  const storage = storageDouble({ failWrites: true });
  const log = createLocalLog({ storage, hostVersion: "2.0.21" });

  log.policy("block", PREFERENCES);
  await log.flush();

  assert.equal(storage.records.size, 0);
});
