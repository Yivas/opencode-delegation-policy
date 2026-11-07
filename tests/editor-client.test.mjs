import assert from "node:assert/strict";
import { test } from "node:test";

import { createPreferenceEditor } from "../dist/editor/server.js";
import { runDelegatePanel } from "../dist/selector.js";
import { PreferenceStore } from "../dist/state/store.js";
import { runDelegateInTui } from "../dist/tui.js";

const VALUE_COLUMN = 24;
const ACTIONS = new Set(["apply", "save", "reload", "status", "log", "close"]);

function aligned(label, value) {
  return label.padEnd(VALUE_COLUMN) + value;
}

function rowTitles(dialog) {
  return dialog.options
    .filter((option) => !ACTIONS.has(option.value))
    .map((option) => option.title);
}

// The real editor server and store over a storage double: the panel's guarantees are exercised
// against the code that persists and validates, not against a second model of it.
function fixture(answers, confirms = []) {
  const records = new Map();
  let writes = 0;
  let session = "ses_A";
  const store = new PreferenceStore({
    async get(key) {
      return records.has(key) ? JSON.parse(records.get(key)) : undefined;
    },
    async set(key, value) {
      writes += 1;
      records.set(key, JSON.stringify(value));
    },
    async remove(key) {
      records.delete(key);
    },
  });
  const editor = createPreferenceEditor({
    store,
    catalog: {
      async list() {
        return {
          data: [
            {
              providerID: "acme",
              id: "plain",
              modelID: "plain",
              enabled: true,
              limit: { output: 32000 },
              variants: [],
            },
            {
              providerID: "other",
              id: "model",
              modelID: "model",
              enabled: true,
              limit: { output: 32000 },
              variants: [],
            },
          ],
        };
      },
    },
    sessionExists: async () => true,
  });
  const shown = [];
  const alerts = [];
  const calls = [];
  const dialogs = {
    async select(input) {
      shown.push(input);
      assert.ok(answers.length > 0, `unexpected dialog: ${input.title}`);
      const answer = answers.shift();
      if (typeof answer === "function") return answer(input);
      if (answer !== undefined) {
        assert.ok(
          input.options.some(
            (option) => option.value === answer && !option.disabled,
          ),
          `choice ${answer} in ${input.title}`,
        );
      }
      return answer;
    },
    async prompt(input) {
      shown.push(input);
      return undefined;
    },
    async confirm(input) {
      shown.push(input);
      const answer = confirms.shift();
      return typeof answer === "function" ? answer(input) : answer;
    },
    async alert(input) {
      alerts.push(input);
    },
  };
  const client = {
    async read(input) {
      calls.push(["read", input]);
      return editor.read(input);
    },
    async preview(input) {
      calls.push(["preview", structuredClone(input)]);
      return editor.preview(input);
    },
    async apply(input) {
      calls.push(["apply", structuredClone(input)]);
      return editor.apply(input);
    },
  };
  const ports = {
    client,
    dialogs,
    sessionID: () => session,
    run: async (line) => `answer to ${line}`,
  };
  return {
    store,
    client,
    dialogs,
    alerts,
    shown,
    calls,
    ports,
    sessionID: () => session,
    switchSession: (value) => {
      session = value;
    },
    writes: () => writes,
    panel: (scope = { scope: "defaults" }) => runDelegatePanel(scope, ports),
    assertConsumed() {
      assert.equal(answers.length, 0);
      assert.equal(confirms.length, 0);
    },
  };
}

test("Apply to this session saves only intensity, Advisor mode and preference", async () => {
  const f = fixture(["intensity", "aggressive", "apply", "close"]);
  await f.store.saveDefaults({ intensity: "normal" });
  const writesBefore = f.writes();

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  const applied = f.calls.filter(([method]) => method === "apply");
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0][1].change, { intensity: "aggressive" });
  assert.equal(
    (await f.store.readSession("ses_A")).preferences.intensity,
    "aggressive",
  );
  assert.equal((await f.store.readGlobal()).preferences.intensity, "normal");
  assert.equal(f.writes(), writesBefore + 1);
});

test("a draft that touches models cannot be applied to the session and saves as defaults", async () => {
  const f = fixture([
    "role:small",
    "acme/plain",
    // Apply stays listed, so choosing it explains instead of saving models into one session.
    "apply",
    "save",
    "close",
  ]);

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  const applied = f.calls.filter(([method]) => method === "apply");
  assert.equal(applied.length, 1);
  assert.ok(
    f.alerts.some((alert) => /shared by every session/.test(alert.message)),
  );
  assert.equal(applied[0][1].scope, "defaults");
  assert.deepEqual(applied[0][1].change, {
    roles: { small: { kind: "configured", model: "acme/plain" } },
  });
  assert.deepEqual((await f.store.readGlobal()).preferences.roles.small, {
    kind: "configured",
    model: "acme/plain",
  });
  assert.ok(f.alerts.some((alert) => /Restart OpenCode/.test(alert.message)));
});

test("a scalar saved as defaults stays ready to apply when the session overrides it", async () => {
  const f = fixture([
    "intensity",
    "off",
    "save",
    (input) => {
      // The defaults took `off`, but the session still shows its own `aggressive`.
      const apply = input.options.find((option) => option.value === "apply");
      assert.equal(apply.disabled, false);
      return "apply";
    },
    "close",
  ]);
  await f.store.applySession("ses_A", { intensity: "aggressive" });

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  assert.equal((await f.store.readGlobal()).preferences.intensity, "off");
  assert.equal(
    (await f.store.readSession("ses_A")).preferences.intensity,
    "off",
  );
});

test("Save as defaults from a session stores the changed scalars, not the session's other overrides", async () => {
  const f = fixture(["preference", "intensive", "save", "close"]);
  await f.store.saveDefaults({ intensity: "normal", preference: "efficient" });
  await f.store.applySession("ses_A", { intensity: "aggressive" });
  const writesBefore = f.writes();

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  const defaults = (await f.store.readGlobal()).preferences;
  assert.equal(defaults.preference, "intensive");
  assert.equal(defaults.intensity, "normal");
  assert.equal(
    (await f.store.readSession("ses_A")).preferences.intensity,
    "aggressive",
  );
  assert.equal(f.writes(), writesBefore + 1);
  assert.equal(
    f.alerts.some((alert) => /Restart OpenCode/.test(alert.message)),
    false,
  );
});

test("a refused preview saves nothing, keeps the draft and offers a reload", async () => {
  let f;
  f = fixture(
    [
      "intensity",
      "normal",
      async () => {
        await f.store.saveDefaults({ preference: "efficient" });
        return "save";
      },
      "close",
    ],
    [true],
  );

  await f.panel();
  f.assertConsumed();

  assert.equal(
    f.calls.some(([method]) => method === "apply"),
    false,
  );
  assert.ok(f.alerts.some((alert) => /settings changed/.test(alert.message)));
  const reopened = f.shown
    .filter((dialog) => dialog.title.startsWith("Delegation"))
    .at(-1);
  assert.equal(reopened.title, "Delegation · defaults · modified");
  assert.ok(rowTitles(reopened).includes(aligned("Intensity", "normal")));
  // A refusal may be a validation error the person can fix, so saving stays available; Reload is
  // offered for the case where the saved settings moved meanwhile.
  const save = reopened.options.find((option) => option.value === "save");
  assert.equal(save.disabled, false);
  assert.ok(reopened.options.some((option) => option.value === "reload"));
  assert.equal((await f.store.readGlobal()).preferences.intensity, "off");
});

test("Reload keeps the draft and lets the same draft save", async () => {
  let f;
  f = fixture([
    "intensity",
    "normal",
    async () => {
      await f.store.saveDefaults({ preference: "efficient" });
      return "save";
    },
    "reload",
    "save",
    "close",
  ]);

  await f.panel();
  f.assertConsumed();

  const defaults = (await f.store.readGlobal()).preferences;
  assert.equal(defaults.intensity, "normal");
  assert.equal(defaults.preference, "efficient");
  assert.ok(
    f.alerts.some(
      (alert) => alert.title === "Saved settings reloaded; draft kept",
    ),
  );
});

test("an unconfirmed save keeps the draft, locks both save actions and never exposes the RPC error", async () => {
  const f = fixture(
    [
      "intensity",
      "normal",
      "apply",
      (input) => {
        assert.equal(
          input.options.find((option) => option.value === "apply").disabled,
          true,
        );
        assert.equal(
          input.options.find((option) => option.value === "save").disabled,
          true,
        );
        assert.ok(input.options.some((option) => option.value === "reload"));
        return "close";
      },
    ],
    [true],
  );
  const apply = f.client.apply;
  f.client.apply = async (input) => {
    await apply(input);
    throw new Error("private RPC error");
  };

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  assert.equal(f.writes(), 1);
  assert.match(f.alerts.at(-1).message, /could not be confirmed/);
  assert.doesNotMatch(JSON.stringify(f.alerts), /private RPC error/);
  assert.doesNotMatch(f.alerts.at(-1).message, /not saved/);
});

test("a failed reload keeps the draft and the save lock", async () => {
  const f = fixture(
    [
      "intensity",
      "normal",
      "apply",
      (input) => {
        assert.equal(
          input.options.find((option) => option.value === "apply").disabled,
          true,
        );
        assert.ok(input.options.some((option) => option.value === "reload"));
        return "reload";
      },
      (input) => {
        assert.equal(
          input.options.find((option) => option.value === "apply").disabled,
          true,
        );
        assert.ok(rowTitles(input).includes(aligned("Intensity", "normal")));
        return "close";
      },
    ],
    [true],
  );
  const apply = f.client.apply;
  f.client.apply = async (input) => {
    await apply(input);
    throw new Error("private apply failure");
  };
  const read = f.client.read;
  let reads = 0;
  f.client.read = async (input) => {
    reads += 1;
    if (reads <= 2) return read(input);
    throw new Error("private reload failure");
  };

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  assert.equal(f.writes(), 1);
  assert.ok(
    f.alerts.some((alert) =>
      /could not be reloaded.*draft.*kept/.test(alert.message),
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(f.alerts),
    /private (apply|reload) failure/,
  );
});

test("switching sessions during a panel dialog cancels without saving", async () => {
  let f;
  f = fixture([
    "intensity",
    () => {
      f.switchSession("ses_B");
      return "normal";
    },
  ]);

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  assert.equal(f.writes(), 0);
  assert.equal(
    f.calls.some(([method]) => method === "apply"),
    false,
  );
  assert.match(f.alerts.at(-1).message, /session changed.*not saved/);
});

test("a reply for another scope is rejected before the panel opens", async () => {
  const f = fixture([]);
  const read = f.client.read;
  f.client.read = async (input) => ({
    ...(await read(input)),
    scope: "session",
    sessionID: "ses_B",
  });

  await f.panel();
  f.assertConsumed();

  assert.equal(f.writes(), 0);
  assert.equal(f.shown.length, 0);
  assert.match(
    f.alerts.at(-1).message,
    /could not be read.*Nothing was changed/,
  );
});

test("closing with a draft asks before discarding it", async () => {
  const f = fixture(["intensity", "normal", "close", "close"], [false, true]);

  await f.panel();
  f.assertConsumed();

  assert.equal(f.writes(), 0);
  const asked = f.shown.filter(
    (dialog) => dialog.title === "Discard delegation changes?",
  );
  assert.equal(asked.length, 2);
  assert.deepEqual(asked[0].label, {
    confirm: "Discard",
    cancel: "Keep editing",
  });
  assert.equal(
    f.calls.some(([method]) => method === "apply"),
    false,
  );
});

test("the edit aliases open the panel for the requested scope", async () => {
  for (const [line, scope] of [
    ["/delegate edit defaults", "defaults"],
    ["EDIT session", "session"],
    ["edit", "session"],
    ["edit  defaults", "defaults"],
    ["/delegate EDIT   defaults", "defaults"],
  ]) {
    const f = fixture(["close"]);
    let typed = 0;
    await runDelegateInTui(line, {
      rpc: () => ({
        run: async () => {
          typed += 1;
          return { text: "unused" };
        },
      }),
      editor: f.client,
      dialogs: f.dialogs,
      alert: f.dialogs.alert,
      sessionID: f.sessionID,
    });
    f.assertConsumed();
    assert.equal(typed, 0, line);
    assert.ok(
      f.calls.some(
        ([method, input]) => method === "read" && input.scope === scope,
      ),
      line,
    );
    assert.equal(f.writes(), 0);
  }
});

test("without an open session the panel works on the defaults", async () => {
  const f = fixture(["close"]);
  await runDelegateInTui("edit session", {
    rpc: () => ({ run: async () => ({ text: "unused" }) }),
    editor: f.client,
    dialogs: f.dialogs,
    alert: f.dialogs.alert,
    sessionID: () => undefined,
  });
  f.assertConsumed();

  // The start panel reads the defaults and, in the same pass, what the next session would use.
  assert.deepEqual(
    f.calls.map(([method, input]) => [method, input.scope]),
    [
      ["read", "defaults"],
      ["read", "next"],
    ],
  );
});
