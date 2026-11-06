import assert from "node:assert/strict";
import { test } from "node:test";

import { runPreferenceEditor } from "../dist/editor/client.js";
import { createPreferenceEditor } from "../dist/editor/server.js";
import { PreferenceStore } from "../dist/state/store.js";
import { runDelegateInTui } from "../dist/tui.js";

function fixture(answers, confirms = [], prompts = []) {
  const records = new Map();
  let writes = 0;
  let session = "ses_A";
  const store = new PreferenceStore({
    async get(key) {
      return records.has(key) ? JSON.parse(records.get(key)) : undefined;
    },
    async set(key, value) {
      records.set(key, JSON.stringify(value));
      writes += 1;
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
      assert.ok(prompts.length > 0);
      return prompts.shift();
    },
    async confirm(input) {
      shown.push(input);
      assert.ok(confirms.length > 0);
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
  return {
    store,
    client,
    dialogs,
    alerts,
    shown,
    calls,
    sessionID: () => session,
    switchSession: (value) => {
      session = value;
    },
    writes: () => writes,
    assertConsumed() {
      assert.equal(answers.length, 0);
      assert.equal(confirms.length, 0);
      assert.equal(prompts.length, 0);
    },
  };
}
const DEFAULTS = { scope: "defaults" };

test("the defaults editor filters catalogue models, drafts thinking and ordered Advisors, then applies once", async () => {
  const f = fixture(
    [
      "role:small",
      "filter",
      "acme/plain",
      "thinking:small",
      "range",
      "low",
      "high",
      "advisor:add",
      "acme/plain",
      "advisor:add",
      "other/model",
      "preview",
      "apply",
    ],
    [true],
    ["acme"],
  );
  const originalApply = f.client.apply;
  f.client.apply = (input) => {
    assert.equal(f.writes(), 0);
    return originalApply(input);
  };
  await runPreferenceEditor(DEFAULTS, f);
  f.assertConsumed();
  assert.equal(f.writes(), 1);
  const saved = (await f.store.readGlobal()).preferences;
  assert.deepEqual(saved.roles.small, {
    kind: "configured",
    model: "acme/plain",
  });
  assert.deepEqual(saved.thinking.small, {
    kind: "range",
    from: "low",
    to: "high",
  });
  assert.deepEqual(saved.advisors.models, ["acme/plain", "other/model"]);
  const filtered = f.shown.find((dialog) =>
    dialog.options?.some(
      (option) => option.value === "filter" && option.title.includes("acme"),
    ),
  );
  assert.deepEqual(
    filtered.options.slice(0, 2).map((option) => option.value),
    ["off", "unset"],
  );
  assert.equal(
    filtered.options.some((option) => option.value === "other/model"),
    false,
  );
  assert.equal(f.calls.filter(([method]) => method === "apply").length, 1);
  assert.ok(
    f.alerts.some((alert) =>
      alert.message.includes("Draft preview; nothing has been saved"),
    ),
  );
  assert.match(f.alerts.at(-1).message, /Defaults saved/);
});

test("session drafts offer inheritance first and cannot edit model rows or global defaults", async () => {
  const f = fixture(["intensity", "inherit", "apply"], [true]);
  await f.store.saveDefaults({ intensity: "normal" });
  await f.store.applySession("ses_A", { intensity: "aggressive" });
  const writesBefore = f.writes();
  await runPreferenceEditor({ scope: "session", sessionID: "ses_A" }, f);
  f.assertConsumed();
  const scalar = f.shown.find((dialog) => dialog.title === "Intensity");
  assert.equal(scalar.options[0].value, "inherit");
  const main = f.shown[0];
  assert.ok(
    main.options
      .filter((option) => option.value.startsWith("role:"))
      .every((option) => option.disabled),
  );
  assert.equal(
    (await f.store.readSession("ses_A")).provenance.intensity,
    "global",
  );
  assert.equal((await f.store.readGlobal()).preferences.intensity, "normal");
  assert.equal(f.writes(), writesBefore + 1);
});

test("discarding requires confirmation and a cancelled discard keeps the unsaved draft", async () => {
  const f = fixture(
    ["intensity", "normal", "close", "preview", "close"],
    [false, true],
  );
  await runPreferenceEditor(DEFAULTS, f);
  f.assertConsumed();
  assert.equal(f.writes(), 0);
  assert.equal(
    f.calls.some(([method]) => method === "apply"),
    false,
  );
  assert.ok(f.alerts.some((alert) => /Intensity: normal/.test(alert.message)));
});

test("switching sessions during an editor dialog cancels without applying the draft", async () => {
  let f;
  f = fixture([
    "intensity",
    () => {
      f.switchSession("ses_B");
      return "normal";
    },
  ]);
  await runPreferenceEditor({ scope: "session", sessionID: "ses_A" }, f);
  f.assertConsumed();
  assert.equal(f.writes(), 0);
  assert.equal(
    f.calls.some(([method]) => method === "apply"),
    false,
  );
  assert.match(f.alerts.at(-1).message, /session changed.*not saved/);
});

test("a concurrent defaults change refuses preview rather than overwriting the other client", async () => {
  let f;
  f = fixture(
    [
      "intensity",
      async () => {
        await f.store.saveDefaults({ preference: "efficient" });
        return "normal";
      },
      "apply",
      "close",
    ],
    [true],
  );
  await runPreferenceEditor(DEFAULTS, f);
  f.assertConsumed();
  assert.equal(f.writes(), 1);
  assert.equal(
    f.calls.some(([method]) => method === "apply"),
    false,
  );
  assert.equal((await f.store.readGlobal()).preferences.intensity, "off");
  assert.equal(
    (await f.store.readGlobal()).preferences.preference,
    "efficient",
  );
  assert.ok(f.alerts.some((alert) => /settings changed/.test(alert.message)));
});

test("an unconfirmed apply is not reported as unsaved and never exposes the RPC error", async () => {
  const f = fixture(
    [
      "intensity",
      "normal",
      "apply",
      (dialog) => {
        assert.equal(
          dialog.options.find((option) => option.value === "apply").disabled,
          true,
        );
        return "close";
      },
    ],
    [true, true],
  );
  const apply = f.client.apply;
  f.client.apply = async (input) => {
    await apply(input);
    throw new Error("private RPC error");
  };
  await runPreferenceEditor(DEFAULTS, f);
  f.assertConsumed();
  assert.equal(f.writes(), 1);
  assert.match(f.alerts.at(-1).message, /save result could not be confirmed/);
  assert.doesNotMatch(f.alerts.at(-1).message, /private RPC error|not saved/);
});

test("an apply conflict retains the draft until its discard is confirmed", async () => {
  let f;
  f = fixture(
    [
      "intensity",
      "normal",
      "apply",
      (dialog) => {
        assert.ok(
          dialog.options.some((option) =>
            /Intensity: normal.*draft/.test(option.title),
          ),
        );
        return "close";
      },
    ],
    [
      async () => {
        await f.store.saveDefaults({ preference: "efficient" });
        return true;
      },
      true,
    ],
  );
  await runPreferenceEditor(DEFAULTS, f);
  f.assertConsumed();
  assert.equal(f.writes(), 1);
  assert.equal(f.calls.filter(([method]) => method === "apply").length, 1);
  assert.equal((await f.store.readGlobal()).preferences.intensity, "off");
  assert.ok(
    f.alerts.some((alert) =>
      /Not applied:.*settings changed/.test(alert.message),
    ),
  );
});

test("reloading sources keeps the draft and preserves a concurrent client's unrelated change", async () => {
  let f;
  f = fixture(
    ["intensity", "normal", "apply", "reload", "apply"],
    [
      async () => {
        await f.store.saveDefaults({ preference: "efficient" });
        return true;
      },
      true,
    ],
  );
  await runPreferenceEditor(DEFAULTS, f);
  f.assertConsumed();
  assert.equal(f.writes(), 2);
  const saved = (await f.store.readGlobal()).preferences;
  assert.equal(saved.intensity, "normal");
  assert.equal(saved.preference, "efficient");
  assert.ok(
    f.alerts.some(
      (alert) => alert.title === "Source settings reloaded; draft kept",
    ),
  );
  assert.match(f.alerts.at(-1).message, /Defaults saved/);
});

test("failed or malformed reload keeps the draft and an unconfirmed save locked", async () => {
  for (const fault of ["reject", "malformed"]) {
    const f = fixture(
      [
        "intensity",
        "normal",
        "apply",
        "reload",
        (dialog) => {
          assert.equal(
            dialog.options.find((option) => option.value === "apply").disabled,
            true,
          );
          assert.ok(
            dialog.options.some((option) =>
              /Intensity: normal.*draft/.test(option.title),
            ),
          );
          return "close";
        },
      ],
      [true, true],
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
      if (reads === 1) return read(input);
      if (fault === "reject") throw new Error("private reload failure");
      return { ok: true };
    };
    await runPreferenceEditor(DEFAULTS, f);
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
    assert.ok(
      f.shown.some((dialog) =>
        /last save is unconfirmed/i.test(dialog.message ?? ""),
      ),
    );
  }
});

test("a reply for another scope is rejected before opening a draft", async () => {
  const f = fixture([]);
  const read = f.client.read;
  f.client.read = async (input) => ({
    ...(await read(input)),
    scope: "session",
    sessionID: "ses_B",
  });
  await runPreferenceEditor(DEFAULTS, f);
  f.assertConsumed();
  assert.equal(f.writes(), 0);
  assert.equal(f.shown.length, 0);
  assert.match(f.alerts.at(-1).message, /draft was not saved/);
});

test("typed editor aliases accept full lines, command case and repeated whitespace", async () => {
  for (const [line, scope] of [
    ["/delegate edit defaults", "defaults"],
    ["EDIT session", "session"],
    ["edit  defaults", "defaults"],
    ["/delegate EDIT   defaults", "defaults"],
  ]) {
    const f = fixture(["close"]);
    let typedCalls = 0;
    await runDelegateInTui(line, {
      rpc: () => ({
        run: async () => {
          typedCalls += 1;
          return { text: "unused" };
        },
      }),
      editor: f.client,
      dialogs: f.dialogs,
      alert: f.dialogs.alert,
      sessionID: f.sessionID,
    });
    f.assertConsumed();
    assert.equal(typedCalls, 0);
    assert.equal(f.calls[0][1].scope, scope);
    assert.equal(f.writes(), 0);
  }
});

test("the TUI menu enters the editor through structured RPC, not a mutating typed command", async () => {
  const f = fixture(["editor-defaults", "close"]);
  let typedCalls = 0;
  await runDelegateInTui("/delegate", {
    rpc: () => ({
      run: async () => {
        typedCalls += 1;
        return { text: "unused" };
      },
    }),
    editor: f.client,
    dialogs: f.dialogs,
    alert: f.dialogs.alert,
    sessionID: f.sessionID,
  });
  f.assertConsumed();
  assert.equal(typedCalls, 0);
  assert.deepEqual(
    f.calls.map(([method]) => method),
    ["read"],
  );
  assert.equal(f.writes(), 0);
});
