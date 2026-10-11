import assert from "node:assert/strict";
import { test } from "node:test";

import { PreferenceStateError, PreferenceStore } from "../dist/state/store.js";

// Storage double with the same surface as ctx.storage: values are stored as JSON text, so
// every read returns a fresh copy and non-JSON writes fail as they would on the host.
function createStorageDouble() {
  const records = new Map();
  const reads = [];
  const writes = [];
  const removals = [];
  const pendingFailures = new Map();

  // A failure either rejects before the host stores anything, or stores the change and then
  // rejects, which is how a lost response looks to the caller.
  function takeFailure(operation) {
    const failure = pendingFailures.get(operation);
    pendingFailures.delete(operation);
    return failure;
  }

  // Yields to the event loop so concurrent callers interleave at every storage call.
  async function pause() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return {
    records,
    reads,
    writes,
    removals,
    failNext(operation) {
      pendingFailures.set(operation, {
        error: new Error(`${operation} unavailable`),
        persistFirst: false,
      });
    },
    failAfterPersistNext(operation) {
      pendingFailures.set(operation, {
        error: new Error(`${operation} response lost`),
        persistFirst: true,
      });
    },
    storage: {
      async get(key) {
        reads.push(key);
        await pause();
        const failure = takeFailure("get");
        if (failure !== undefined) {
          throw failure.error;
        }
        const text = records.get(key);
        return text === undefined ? undefined : JSON.parse(text);
      },
      async set(key, value) {
        await pause();
        const failure = takeFailure("set");
        if (failure === undefined || failure.persistFirst) {
          writes.push(key);
          records.set(key, JSON.stringify(value));
        }
        if (failure !== undefined) {
          throw failure.error;
        }
      },
      async remove(key) {
        await pause();
        const failure = takeFailure("remove");
        if (failure === undefined || failure.persistFirst) {
          removals.push(key);
          records.delete(key);
        }
        if (failure !== undefined) {
          throw failure.error;
        }
      },
    },
  };
}

function perRole(value) {
  return {
    small: value,
    medium: value,
    large: value,
    visualDesign: value,
    advisor: value,
  };
}

const UNSET = { kind: "unset" };
const UNSET_ROLES = perRole(UNSET);

const BUILT_IN_PREFERENCES = {
  intensity: "off",
  preference: "standard",
  advisorMode: "with-delegation",
  roles: UNSET_ROLES,
  thinking: UNSET_ROLES,
};

const DEFAULT_PROVENANCE = {
  intensity: "default",
  preference: "default",
  advisorMode: "default",
  roles: perRole("default"),
  thinking: perRole("default"),
};

const STORED_GLOBAL = {
  schemaVersion: 1,
  intensity: "off",
  preference: "standard",
  advisorMode: "with-delegation",
  roles: UNSET_ROLES,
  thinking: UNSET_ROLES,
};

function recordText(double, key) {
  return double.records.get(key);
}

function assertStoreError(code) {
  return (error) => {
    assert.ok(error instanceof PreferenceStateError);
    assert.equal(error.code, code);
    return true;
  };
}

test("empty storage reads built-in defaults with default provenance", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  const view = await store.readGlobal();

  assert.deepEqual(view.preferences, BUILT_IN_PREFERENCES);
  assert.deepEqual(view.provenance, DEFAULT_PROVENANCE);
  assert.deepEqual(double.writes, []);
});

test("mutating a returned view does not change the defaults or later reads", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  const builtIn = await store.readGlobal();
  builtIn.preferences.intensity = "orchestrator";
  builtIn.preferences.roles.small.kind = "configured";
  builtIn.preferences.roles.small.model = "leaked/model";
  builtIn.preferences.thinking.large.kind = "fixed";

  assert.deepEqual(
    (await store.readGlobal()).preferences,
    BUILT_IN_PREFERENCES,
  );
  assert.deepEqual(
    (await store.readSession("parent")).preferences,
    BUILT_IN_PREFERENCES,
  );
});

test("saved defaults are inherited by sessions without an override", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.saveDefaults({ intensity: "normal", preference: "intensive" });
  const view = await store.readSession("parent");

  assert.equal(view.preferences.intensity, "normal");
  assert.equal(view.preferences.preference, "intensive");
  assert.equal(view.preferences.advisorMode, "with-delegation");
  assert.equal(view.provenance.intensity, "global");
  assert.equal(view.provenance.preference, "global");
  assert.equal(view.provenance.advisorMode, "global");
});

test("applying a session change never saves the global defaults", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  const sessionView = await store.applySession("parent", {
    intensity: "aggressive",
  });
  const globalView = await store.readGlobal();

  assert.equal(sessionView.preferences.intensity, "aggressive");
  assert.equal(sessionView.provenance.intensity, "session");
  assert.equal(sessionView.provenance.advisorMode, "default");
  assert.equal(double.writes.length, 1);
  assert.equal(globalView.preferences.intensity, "off");
  assert.deepEqual(globalView.provenance, DEFAULT_PROVENANCE);
});

test("two sessions keep independent overrides over the same defaults", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.applySession("first", { intensity: "aggressive" });
  await store.applySession("second", { advisorMode: "off" });
  const first = await store.readSession("first");
  const second = await store.readSession("second");

  assert.equal(first.preferences.intensity, "aggressive");
  assert.equal(first.preferences.advisorMode, "with-delegation");
  assert.equal(second.preferences.intensity, "off");
  assert.equal(second.preferences.advisorMode, "off");
  assert.equal(second.provenance.intensity, "default");
});

test("a new child session uses the global defaults, not its parent override", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.applySession("parent", {
    intensity: "orchestrator",
    preference: "efficient",
  });
  const child = await store.readSession("child");

  assert.deepEqual(child.preferences, BUILT_IN_PREFERENCES);
  assert.deepEqual(child.provenance, DEFAULT_PROVENANCE);
});

test("roles keep inherited, disabled and configured states per session", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.saveDefaults({
    roles: {
      small: { kind: "configured", model: "provider/small" },
      medium: { kind: "disabled" },
    },
    thinking: {
      medium: { kind: "fixed", level: "high" },
      large: { kind: "range", from: "low", to: "high" },
    },
  });
  await store.applySession("parent", {
    roles: {
      small: { kind: "inherit" },
      medium: { kind: "configured", model: "provider/medium" },
      large: { kind: "disabled" },
    },
    thinking: {
      medium: { kind: "unset" },
      large: { kind: "inherit" },
    },
  });
  const view = await store.readSession("parent");

  assert.deepEqual(view.preferences.roles, {
    small: { kind: "configured", model: "provider/small" },
    medium: { kind: "configured", model: "provider/medium" },
    large: { kind: "disabled" },
    visualDesign: UNSET,
    advisor: UNSET,
  });
  assert.deepEqual(view.provenance.roles, {
    small: "global",
    medium: "session",
    large: "session",
    visualDesign: "global",
    advisor: "global",
  });
  assert.deepEqual(view.preferences.thinking, {
    small: UNSET,
    medium: UNSET,
    large: { kind: "range", from: "low", to: "high" },
    visualDesign: UNSET,
    advisor: UNSET,
  });
  assert.equal(view.provenance.thinking.medium, "session");
  assert.equal(view.provenance.thinking.large, "global");
});

test("toggling only the Advisor mode keeps its configured model and thinking", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.saveDefaults({
    roles: { advisor: { kind: "configured", model: "provider/advisor" } },
    thinking: { advisor: { kind: "fixed", level: "high" } },
  });

  for (const advisorMode of ["on", "off", "with-delegation"]) {
    const view = await store.applySession("parent", { advisorMode });

    assert.equal(view.preferences.advisorMode, advisorMode);
    assert.equal(view.provenance.advisorMode, "session");
    assert.deepEqual(view.preferences.roles.advisor, {
      kind: "configured",
      model: "provider/advisor",
    });
    assert.deepEqual(view.preferences.thinking.advisor, {
      kind: "fixed",
      level: "high",
    });
    assert.equal(view.provenance.roles.advisor, "global");
  }
});

test("clear removes the session override and returns to the built-in defaults", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.applySession("parent", {
    intensity: "normal",
    roles: { small: { kind: "disabled" } },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const cleared = await store.clearSession("parent");
  const reread = await store.readSession("parent");

  assert.deepEqual(cleared.preferences, BUILT_IN_PREFERENCES);
  assert.deepEqual(cleared.provenance, DEFAULT_PROVENANCE);
  assert.deepEqual(reread.preferences, BUILT_IN_PREFERENCES);
  assert.equal(double.removals.length, 1);
});

test("clear returns to saved global defaults and reports them as global", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.saveDefaults({ intensity: "normal", preference: "efficient" });
  await store.applySession("parent", {
    intensity: "aggressive",
    preference: "intensive",
    advisorMode: "off",
  });
  const cleared = await store.clearSession("parent");

  assert.equal(cleared.preferences.intensity, "normal");
  assert.equal(cleared.preferences.preference, "efficient");
  assert.equal(cleared.preferences.advisorMode, "with-delegation");
  assert.equal(cleared.provenance.intensity, "global");
  assert.equal(cleared.provenance.preference, "global");
  assert.equal(cleared.provenance.advisorMode, "global");
});

test("reset turns off only intensity and Advisor mode while the Advisor stays configured", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: { kind: "configured", model: "provider/small" },
      advisor: { kind: "configured", model: "provider/advisor" },
    },
    thinking: { advisor: { kind: "fixed", level: "medium" } },
  });
  await store.applySession("parent", {
    intensity: "aggressive",
    advisorMode: "with-delegation",
    roles: { small: { kind: "disabled" } },
    thinking: { advisor: { kind: "unset" } },
  });
  const beforeReset = await store.readSession("parent");
  assert.equal(beforeReset.preferences.advisorMode, "with-delegation");

  const view = await store.resetSession("parent");

  assert.equal(view.preferences.intensity, "off");
  assert.equal(view.provenance.intensity, "session");
  assert.equal(view.preferences.advisorMode, "off");
  assert.equal(view.provenance.advisorMode, "session");
  assert.deepEqual(view.preferences.roles.small, {
    kind: "configured",
    model: "provider/small",
  });
  assert.deepEqual(view.preferences.roles.advisor, {
    kind: "configured",
    model: "provider/advisor",
  });
  assert.deepEqual(view.preferences.thinking.advisor, {
    kind: "fixed",
    level: "medium",
  });
  assert.equal(view.provenance.roles.small, "global");
  assert.equal(view.provenance.thinking.advisor, "global");
  assert.equal(view.preferences.preference, "standard");
});

test("reset drops a session preference override and keeps the saved global preference", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.saveDefaults({ intensity: "normal", preference: "efficient" });
  await store.applySession("parent", {
    intensity: "aggressive",
    preference: "intensive",
  });
  const view = await store.resetSession("parent");

  assert.equal(view.preferences.preference, "efficient");
  assert.equal(view.provenance.preference, "global");
  assert.equal(view.preferences.intensity, "off");
  assert.equal(view.provenance.intensity, "session");
});

test("explicit defaults leave an existing session override in place", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.applySession("parent", { intensity: "aggressive" });
  const globalView = await store.saveDefaults({ intensity: "normal" });
  const sessionView = await store.readSession("parent");

  assert.equal(globalView.preferences.intensity, "normal");
  assert.equal(globalView.provenance.intensity, "global");
  assert.equal(sessionView.preferences.intensity, "aggressive");
  assert.equal(sessionView.provenance.intensity, "session");
});

test("a new store over the same storage resumes the saved preferences", async () => {
  const double = createStorageDouble();
  const before = new PreferenceStore(double.storage);
  await before.saveDefaults({ intensity: "normal", preference: "efficient" });
  await before.applySession("parent", { advisorMode: "on" });

  const restarted = new PreferenceStore(double.storage);
  const resumed = await restarted.readSession("parent");

  assert.equal(resumed.preferences.intensity, "normal");
  assert.equal(resumed.provenance.intensity, "global");
  assert.equal(resumed.preferences.advisorMode, "on");
  assert.equal(resumed.provenance.advisorMode, "session");

  await restarted.applySession("parent", { intensity: "aggressive" });
  const after = await before.readSession("parent");

  assert.equal(after.preferences.intensity, "aggressive");
  assert.equal(after.preferences.advisorMode, "on");
});

test("concurrent mutations on one store instance keep every confirmed change", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  const [first, second] = await Promise.all([
    store.applySession("parent", { intensity: "normal" }),
    store.applySession("parent", { advisorMode: "on" }),
    store.saveDefaults({ preference: "efficient" }),
  ]);
  const view = await store.readSession("parent");

  assert.equal(first.preferences.intensity, "normal");
  assert.equal(second.preferences.intensity, "normal");
  assert.equal(second.preferences.advisorMode, "on");
  assert.equal(view.preferences.intensity, "normal");
  assert.equal(view.preferences.advisorMode, "on");
  assert.equal(view.preferences.preference, "efficient");
});

test("corrupt global documents fail closed and are not overwritten", async () => {
  const corruptDocuments = [
    null,
    [],
    { schemaVersion: 1 },
    { ...STORED_GLOBAL, schemaVersion: "1" },
    { ...STORED_GLOBAL, intensity: "turbo" },
    {
      ...STORED_GLOBAL,
      roles: { ...UNSET_ROLES, small: { kind: "configured" } },
    },
    {
      ...STORED_GLOBAL,
      roles: { ...UNSET_ROLES, small: { kind: "configured", model: "" } },
    },
    {
      ...STORED_GLOBAL,
      thinking: { ...UNSET_ROLES, small: { kind: "fixed" } },
    },
    {
      ...STORED_GLOBAL,
      thinking: { ...UNSET_ROLES, small: { kind: "range", from: "low" } },
    },
    { ...STORED_GLOBAL, roles: { ...UNSET_ROLES, small: { kind: "inherit" } } },
  ];

  for (const document of corruptDocuments) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({ intensity: "normal" });
    const key = double.writes[0];
    const original = JSON.stringify(document);
    double.records.set(key, original);
    const writesBefore = double.writes.length;

    await assert.rejects(
      store.readGlobal(),
      assertStoreError("corrupt-document"),
    );
    await assert.rejects(
      store.saveDefaults({ preference: "intensive" }),
      assertStoreError("corrupt-document"),
    );
    await assert.rejects(
      store.applySession("parent", { intensity: "normal" }),
      assertStoreError("corrupt-document"),
    );

    assert.equal(double.writes.length, writesBefore);
    assert.equal(recordText(double, key), original);
  }
});

test("unknown fields are rejected without echoing their names or values", async () => {
  const secret = "sk-test-secret-value";
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({ intensity: "normal" });
  const key = double.writes[0];
  const nestedSecret = {
    ...STORED_GLOBAL,
    roles: { ...UNSET_ROLES, small: { kind: "disabled", [secret]: true } },
  };

  double.records.set(key, JSON.stringify({ ...STORED_GLOBAL, apiKey: secret }));
  await assert.rejects(store.readGlobal(), (error) => {
    assertStoreError("corrupt-document")(error);
    assert.ok(!error.message.includes(secret));
    assert.ok(!error.message.includes("apiKey"));
    return true;
  });

  double.records.set(key, JSON.stringify(nestedSecret));
  await assert.rejects(store.readSession("parent"), (error) => {
    assertStoreError("corrupt-document")(error);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test("corrupt session documents block reads and writes for that session only", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.applySession("damaged", { intensity: "normal" });
  await store.applySession("healthy", { intensity: "aggressive" });
  const key = double.writes[0];
  const original = JSON.stringify({
    ...STORED_GLOBAL,
    intensity: "turbo",
    schemaVersion: 1,
  });
  double.records.set(key, original);
  const writesBefore = double.writes.length;

  await assert.rejects(
    store.readSession("damaged"),
    assertStoreError("corrupt-document"),
  );
  await assert.rejects(
    store.applySession("damaged", { advisorMode: "on" }),
    assertStoreError("corrupt-document"),
  );
  await assert.rejects(
    store.resetSession("damaged"),
    assertStoreError("corrupt-document"),
  );
  await assert.rejects(
    store.clearSession("damaged"),
    assertStoreError("corrupt-document"),
  );

  assert.equal(double.writes.length, writesBefore);
  assert.equal(double.removals.length, 0);
  assert.equal(recordText(double, key), original);
  const healthy = await store.readSession("healthy");
  assert.equal(healthy.preferences.intensity, "aggressive");
});

test("future schema versions are rejected and never overwritten", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({ intensity: "normal" });
  const key = double.writes[0];
  const future = JSON.stringify({
    schemaVersion: 2,
    intensity: "orchestrator",
    tier: "new",
  });
  double.records.set(key, future);

  await assert.rejects(store.readGlobal(), assertStoreError("future-document"));
  await assert.rejects(
    store.saveDefaults({ intensity: "off" }),
    assertStoreError("future-document"),
  );

  assert.equal(double.writes.length, 1);
  assert.equal(recordText(double, key), future);
});

test("invalid changes are rejected before anything is written", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await assert.rejects(
    store.saveDefaults({ intensity: "turbo" }),
    assertStoreError("invalid-change"),
  );
  await assert.rejects(
    store.saveDefaults({ roles: { small: { kind: "inherit" } } }),
    assertStoreError("invalid-change"),
  );
  await assert.rejects(
    store.applySession("parent", {
      roles: { small: { kind: "configured", model: "" } },
    }),
    assertStoreError("invalid-change"),
  );
  await assert.rejects(
    store.applySession("parent", { unknownField: true }),
    assertStoreError("invalid-change"),
  );

  assert.deepEqual(double.writes, []);
});

test("a change that is not a plain object is rejected as invalid-change", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  const invalidChanges = [
    undefined,
    null,
    "normal",
    1,
    true,
    [],
    [{ intensity: "normal" }],
    new Date(0),
    new Map(),
  ];

  for (const change of invalidChanges) {
    await assert.rejects(
      store.saveDefaults(change),
      assertStoreError("invalid-change"),
    );
    await assert.rejects(
      store.applySession("parent", change),
      assertStoreError("invalid-change"),
    );
  }

  assert.deepEqual(double.writes, []);
});

test("roles and thinking must be plain objects, and undefined is not an empty change", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  const invalidChanges = [
    { roles: null },
    { roles: [] },
    { roles: undefined },
    { roles: "small" },
    { thinking: null },
    { thinking: [] },
    { thinking: undefined },
    { roles: { small: undefined } },
    { roles: { unknownRole: { kind: "unset" } } },
    { intensity: undefined },
  ];

  for (const change of invalidChanges) {
    await assert.rejects(
      store.saveDefaults(change),
      assertStoreError("invalid-change"),
    );
    await assert.rejects(
      store.applySession("parent", change),
      assertStoreError("invalid-change"),
    );
  }

  assert.deepEqual(double.writes, []);
});

test("change fields outside the preference contract are rejected, including schemaVersion", async () => {
  const secret = "sk-test-secret-value";
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await assert.rejects(
    store.saveDefaults({ schemaVersion: 1, intensity: "normal" }),
    assertStoreError("invalid-change"),
  );
  await assert.rejects(
    store.applySession("parent", { schemaVersion: 1 }),
    assertStoreError("invalid-change"),
  );
  await assert.rejects(
    store.applySession("parent", { apiKey: secret }),
    (error) => {
      assertStoreError("invalid-change")(error);
      assert.ok(!error.message.includes(secret));
      assert.ok(!error.message.includes("apiKey"));
      return true;
    },
  );

  assert.deepEqual(double.writes, []);
});

test("session identifiers are validated and mapped to safe, distinct keys", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await assert.rejects(
    store.applySession("", { intensity: "normal" }),
    assertStoreError("invalid-session-id"),
  );
  await assert.rejects(
    store.applySession("s".repeat(129), { intensity: "normal" }),
    assertStoreError("invalid-session-id"),
  );

  await store.applySession("ses/../a", { intensity: "normal" });
  await store.applySession("ses", { intensity: "aggressive" });

  for (const key of double.writes) {
    assert.match(key, /^[a-z0-9.]+$/);
  }
  assert.notEqual(double.writes[0], double.writes[1]);
  assert.equal(
    (await store.readSession("ses/../a")).preferences.intensity,
    "normal",
  );
  assert.equal(
    (await store.readSession("ses")).preferences.intensity,
    "aggressive",
  );
});

test("session identifiers must be strings of well-formed Unicode and reach no storage", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  const invalidIdentifiers = [
    123,
    null,
    undefined,
    {},
    ["parent"],
    "\uD800",
    "parent\uDC00",
  ];

  for (const sessionID of invalidIdentifiers) {
    await assert.rejects(
      store.readSession(sessionID),
      assertStoreError("invalid-session-id"),
    );
    await assert.rejects(
      store.applySession(sessionID, { intensity: "normal" }),
      assertStoreError("invalid-session-id"),
    );
    await assert.rejects(
      store.clearSession(sessionID),
      assertStoreError("invalid-session-id"),
    );
    await assert.rejects(
      store.resetSession(sessionID),
      assertStoreError("invalid-session-id"),
    );
  }

  assert.deepEqual(double.reads, []);
  assert.deepEqual(double.writes, []);
  assert.deepEqual(double.removals, []);
});

test("the session identifier limit counts UTF-8 bytes", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await store.applySession("é".repeat(64), { intensity: "normal" });
  await assert.rejects(
    store.applySession("é".repeat(65), { intensity: "normal" }),
    assertStoreError("invalid-session-id"),
  );
});

test("a failed read surfaces an error instead of built-in defaults", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  double.failNext("get");

  await assert.rejects(
    store.readGlobal(),
    assertStoreError("storage-read-failed"),
  );
});

test("a write rejected before persisting leaves the last persisted state readable", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.applySession("parent", { intensity: "normal" });
  double.failNext("set");

  await assert.rejects(
    store.applySession("parent", { advisorMode: "on" }),
    assertStoreError("storage-write-failed"),
  );
  const view = await store.readSession("parent");

  assert.equal(view.preferences.intensity, "normal");
  assert.equal(view.preferences.advisorMode, "with-delegation");
  assert.equal(view.provenance.advisorMode, "default");
});

test("a write that stores and then rejects is reported as uncertain, and a re-read shows what was stored", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.applySession("parent", { intensity: "normal" });
  double.failAfterPersistNext("set");

  await assert.rejects(
    store.applySession("parent", { intensity: "aggressive" }),
    (error) => {
      assertStoreError("storage-write-failed")(error);
      assert.equal(error.persistence, "unknown");
      assert.match(error.message, /may have stored the change/);
      return true;
    },
  );
  const view = await store.readSession("parent");

  assert.equal(view.preferences.intensity, "aggressive");
  assert.equal(view.provenance.intensity, "session");
});

test("a write rejected before persisting keeps the previous defaults", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({ preference: "intensive" });
  double.failNext("set");

  await assert.rejects(
    store.saveDefaults({ preference: "efficient" }),
    assertStoreError("storage-write-failed"),
  );

  assert.equal((await store.readGlobal()).preferences.preference, "intensive");
});

test("a removal that fails before persisting leaves the override in place", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.applySession("parent", { intensity: "normal" });
  double.failNext("remove");

  await assert.rejects(store.clearSession("parent"), (error) => {
    assertStoreError("storage-write-failed")(error);
    assert.equal(error.persistence, "unknown");
    return true;
  });

  assert.equal(
    (await store.readSession("parent")).preferences.intensity,
    "normal",
  );
});
