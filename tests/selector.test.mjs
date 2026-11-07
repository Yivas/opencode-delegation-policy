import assert from "node:assert/strict";
import { test } from "node:test";

import { createPreferenceEditor } from "../dist/editor/server.js";
import { runDelegatePanel } from "../dist/selector.js";
import { PreferenceStore } from "../dist/state/store.js";
import { runDelegateInTui } from "../dist/tui.js";

// One value column: the longest label ("Visual Design thinking", 22 characters) plus two spaces.
const VALUE_COLUMN = 24;
const ACTIONS = new Set([
  "apply",
  "save",
  "next",
  "clear-next",
  "reload",
  "status",
  "log",
  "close",
]);

function aligned(label, value) {
  return label.padEnd(VALUE_COLUMN) + value;
}

function settingRows(dialog) {
  return dialog.options
    .filter((option) => !ACTIONS.has(option.value))
    .map((option) => option.title);
}

// The real editor server over a storage double, as the terminal entry wires it: the panel is
// exercised without a second implementation of the preferences.
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
            {
              providerID: "openai",
              id: "gpt-5",
              modelID: "gpt-5",
              enabled: true,
              package: "@opencode/ai/providers/openai",
              limit: { output: 32000 },
              variants: [{ id: "deep", settings: { reasoningEffort: "high" } }],
            },
          ],
        };
      },
    },
    sessionExists: async () => true,
  });
  const shown = [];
  const alerts = [];
  const runs = [];
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
    run: async (line, target) => {
      runs.push([line, target.scope]);
      return `answer to ${line}`;
    },
  };
  return {
    store,
    client,
    dialogs,
    alerts,
    shown,
    calls,
    runs,
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

test("the panel lists every setting with its value in one column", async () => {
  const f = fixture(["close"]);
  await f.store.saveDefaults({
    intensity: "normal",
    roles: { small: { kind: "configured", model: "acme/plain" } },
    thinking: { small: { kind: "fixed", level: "high" } },
    advisors: { kind: "configured", models: ["other/model"] },
  });

  await f.panel();
  f.assertConsumed();

  const main = f.shown[0];
  assert.equal(main.title, "Delegation · defaults");
  assert.deepEqual(settingRows(main), [
    aligned("Intensity", "normal"),
    aligned("Advisor mode", "with-delegation"),
    aligned("Preference", "standard"),
    aligned("Small", "acme/plain"),
    aligned("Small thinking", "high"),
    aligned("Medium", "not set"),
    aligned("Large", "not set"),
    aligned("Visual Design", "not set"),
    aligned("Advisor 1", "other/model"),
    aligned("Advisor 2", "add"),
  ]);
  // Where each value comes from belongs to the row, not to the panel title.
  assert.deepEqual(
    main.options
      .filter((option) => !ACTIONS.has(option.value))
      .map((option) => option.footer),
    Array.from({ length: 10 }, () => "defaults"),
  );
});

test("a bare /delegate opens the panel for the open session instead of sending a command", async () => {
  const f = fixture(["close"]);
  let sent = 0;

  await runDelegateInTui("", {
    rpc: () => ({
      run: async () => {
        sent += 1;
        return { text: "unused" };
      },
    }),
    editor: f.client,
    dialogs: f.dialogs,
    alert: f.dialogs.alert,
    sessionID: f.sessionID,
  });
  f.assertConsumed();

  assert.equal(sent, 0);
  assert.equal(f.shown[0].title, "Delegation · this session");
  // A session panel reads the defaults and the session separately: each save needs its own revision.
  assert.deepEqual(
    f.calls.map(([method, input]) => [method, input.scope]),
    [
      ["read", "defaults"],
      ["read", "session"],
    ],
  );
});

test("the model list offers off, not set and the catalogue, without a filter row", async () => {
  const f = fixture(["role:small", "acme/plain", "close"], [true]);

  await f.panel();
  f.assertConsumed();

  const models = f.shown.find((dialog) => dialog.title === "Model for Small");
  assert.deepEqual(
    models.options.map((option) => option.value),
    ["off", "unset", "acme/plain", "other/model", "openai/gpt-5"],
  );
  assert.equal(models.current, "unset");
  const reopened = f.shown.filter((dialog) =>
    dialog.title.startsWith("Delegation"),
  );
  assert.ok(settingRows(reopened[1]).includes(aligned("Small", "acme/plain")));
});

test("a model with variants keeps its second step", async () => {
  const f = fixture(
    ["role:small", "openai/gpt-5", "openai/gpt-5#deep", "close"],
    [true],
  );

  await f.panel();
  f.assertConsumed();

  const variant = f.shown.find(
    (dialog) => dialog.title === "Default variant for openai/gpt-5",
  );
  assert.deepEqual(
    variant.options.map((option) => option.value),
    ["openai/gpt-5", "openai/gpt-5#deep"],
  );
  const reopened = f.shown
    .filter((dialog) => dialog.title.startsWith("Delegation"))
    .at(-1);
  assert.ok(
    settingRows(reopened).includes(aligned("Small", "openai/gpt-5#deep")),
  );
});

test("thinking is one list of per launch, every level and a range", async () => {
  const f = fixture(
    ["thinking:small", "range", "low", "high", "close"],
    [true],
  );
  await f.store.saveDefaults({
    roles: { small: { kind: "configured", model: "acme/plain" } },
  });

  await f.panel();
  f.assertConsumed();

  const thinking = f.shown.find(
    (dialog) => dialog.title === "Thinking for Small",
  );
  assert.deepEqual(
    thinking.options.map((option) => option.title),
    [
      "per launch",
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "range…",
    ],
  );
  assert.equal(thinking.current, "unset");
  assert.deepEqual(
    f.shown
      .filter((dialog) => dialog.title.includes("thinking level"))
      .map((dialog) => dialog.title),
    ["Lowest thinking level", "Highest thinking level (inclusive)"],
  );
  const reopened = f.shown.filter((dialog) =>
    dialog.title.startsWith("Delegation"),
  );
  assert.ok(
    settingRows(reopened[1]).includes(aligned("Small thinking", "low..high")),
  );
});

test("an Advisor row adds an entry and off removes it, later rows moving up", async () => {
  const f = fixture(
    [
      "advisor:add",
      "acme/plain",
      "advisor:add",
      "other/model",
      "advisor:0",
      "off",
      "close",
    ],
    [true],
  );

  await f.panel();
  f.assertConsumed();

  const panels = f.shown.filter((dialog) =>
    dialog.title.startsWith("Delegation"),
  );
  const advisorRows = (dialog) =>
    settingRows(dialog).filter((title) => /^Advisor \d/u.test(title));
  assert.deepEqual(advisorRows(panels[1]), [
    aligned("Advisor 1", "acme/plain"),
    aligned("Advisor 2", "add"),
  ]);
  assert.deepEqual(advisorRows(panels[2]), [
    aligned("Advisor 1", "acme/plain"),
    aligned("Advisor 2", "other/model"),
    aligned("Advisor 3", "add"),
  ]);
  assert.deepEqual(advisorRows(panels[3]), [
    aligned("Advisor 1", "other/model"),
    aligned("Advisor 2", "add"),
  ]);
});

test("a session panel shows the effective values and offers following the defaults", async () => {
  const f = fixture(["intensity", undefined, "close"]);
  await f.store.saveDefaults({ intensity: "normal" });

  await f.panel({ scope: "session", sessionID: "ses_A" });
  f.assertConsumed();

  const main = f.shown[0];
  const intensity = main.options.find((option) => option.value === "intensity");
  assert.equal(intensity.title, aligned("Intensity", "normal"));
  assert.equal(intensity.footer, "defaults");
  const values = f.shown.find((dialog) => dialog.title === "Intensity");
  assert.deepEqual(values.options[0], {
    title: "follow defaults (normal)",
    value: "inherit",
    description: "Drop this session's value and follow the defaults.",
  });
  assert.equal(values.current, "normal");
});

test("the start panel shows the values the next session would use, named as such", async () => {
  const f = fixture(["close"]);
  await f.store.saveDefaults({ intensity: "normal" });
  await f.store.saveNext({ preference: "efficient" });

  await f.panel();
  f.assertConsumed();

  const main = f.shown[0];
  const row = (value) => main.options.find((option) => option.value === value);
  assert.equal(row("preference").title, aligned("Preference", "efficient"));
  assert.equal(row("preference").footer, "next session");
  assert.equal(row("intensity").title, aligned("Intensity", "normal"));
  assert.equal(row("intensity").footer, "defaults");
  assert.equal(row("next").title, "Apply to next session");
  assert.equal(row("clear-next").title, "Clear next session");
});

test("Apply to next session stores the draft for the next session, and Clear drops it", async () => {
  const f = fixture(["intensity", "aggressive", "next", "close"]);

  await f.panel();
  f.assertConsumed();

  const saved = await f.store.readNext();
  assert.equal(saved.status, "pending");
  assert.equal(saved.view.preferences.intensity, "aggressive");
  // The panel reopened after the save and now shows it as the next session's own value.
  const reopened = f.shown
    .filter((dialog) => dialog.title.startsWith("Delegation"))
    .at(-1);
  const intensity = reopened.options.find(
    (option) => option.value === "intensity",
  );
  assert.equal(intensity.title, aligned("Intensity", "aggressive"));
  assert.equal(intensity.footer, "next session");

  const g = fixture(["clear-next", "close"]);
  await g.store.saveNext({ intensity: "aggressive" });
  await g.panel();
  g.assertConsumed();
  assert.equal((await g.store.readNext()).status, "none");
});

test("Status and the local log run the typed line and return to the panel", async () => {
  const f = fixture(["status", "log", "close"]);

  await f.panel();
  f.assertConsumed();

  assert.deepEqual(f.runs, [
    ["status", "defaults"],
    ["log", "defaults"],
  ]);
  assert.deepEqual(
    f.alerts.map((alert) => alert.message),
    ["answer to status", "answer to log"],
  );
  assert.equal(
    f.shown.filter((dialog) => dialog.title.startsWith("Delegation")).length,
    3,
  );
});
