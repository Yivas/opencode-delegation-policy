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
        model: "private prompt\n\u001b[31mD:/private/path",
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
      v: 2,
      at: undefined,
      kind: "launch",
      host: "2.0.21",
      agent: "ocv2-advisor-1",
      background: true,
      outcome: "running",
      ms: 1_500,
    },
  );
  assert.doesNotMatch(
    JSON.stringify(entries(storage)),
    /private prompt|ses_secret|private\/path|\\u001b/,
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
    await log.flush();
  }

  const keys = [...storage.records.keys()].sort();
  assert.equal(keys.length, 500);
  // The 25 oldest went; the newest is still there.
  assert.ok(
    keys[0].startsWith(`${LOG_PREFIX}${String(26).padStart(15, "0")}-`),
  );
});

test("a stalled write bounds the backlog and read time, and raw stored content is never shown", async () => {
  const storage = storageDouble();
  const set = storage.set.bind(storage);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let writes = 0;
  storage.set = async (key, value) => {
    await held;
    writes += 1;
    await set(key, value);
  };
  const log = createLocalLog({ storage, hostVersion: "2.0.21" });
  for (let index = 0; index < 600; index += 1)
    log.policy(`block ${index}`, PREFERENCES);
  await assert.rejects(log.recent(20), /timed out/);
  release();
  await log.flush();
  assert.ok(writes <= 64);
  storage.records.set("log/999999999999999-legacy", {
    v: 1,
    kind: "launch",
    model: SECRET,
  });
  storage.records.set("log/999999999999999-bad", {
    v: 2,
    kind: "launch",
    at: "not a date",
    host: SECRET,
    agent: SECRET,
  });
  const shown = await log.recent(500);
  assert.doesNotMatch(JSON.stringify(shown), /private prompt/);
  assert.ok(shown.every((entry) => entry.v === 2));
});

test("bounded pruning recovers an oversized namespace and rebuilds allowed fields", async () => {
  const storage = storageDouble();
  storage.records.set("settings/defaults", { keep: true });
  for (let index = 0; index < 4_001; index += 1) {
    storage.records.set(
      `${LOG_PREFIX}${String(index).padStart(15, "0")}-legacy`,
      {
        v: 1,
        kind: "launch",
        model: SECRET,
      },
    );
  }
  storage.records.set(`${LOG_PREFIX}000000000005000-extra`, {
    v: 2,
    at: "2026-11-05T00:00:00.000Z",
    host: "2.0.21",
    kind: "launch",
    agent: "ocv2-small",
    background: false,
    outcome: "completed",
    ms: 1,
    model: SECRET,
    prompt: SECRET,
  });
  const log = createLocalLog({ storage, hostVersion: "2.0.21" });
  log.policy("first", PREFERENCES);
  await log.flush();
  assert.ok(storage.records.size < 4_003);
  for (let index = 1; index < 25; index += 1) {
    log.policy(`next ${index}`, PREFERENCES);
    await log.flush();
  }
  const shown = await log.recent(500);
  assert.equal(
    entries(storage).some((entry) => entry.v === 1),
    false,
  );
  assert.deepEqual(storage.records.get("settings/defaults"), { keep: true });
  assert.equal(shown.length, 26);
  assert.doesNotMatch(JSON.stringify(shown), /private prompt/);
  assert.equal("model" in shown[0], false);
  assert.equal("prompt" in shown[0], false);
});

test("a log that cannot be written never throws", async () => {
  const storage = storageDouble({ failWrites: true });
  const log = createLocalLog({ storage, hostVersion: "2.0.21" });

  log.policy("block", PREFERENCES);
  await log.flush();

  assert.equal(storage.records.size, 0);
});
