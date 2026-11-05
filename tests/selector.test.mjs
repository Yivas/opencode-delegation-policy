import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseDelegateLine } from "../dist/selector.js";
import { runDelegateInTui } from "../dist/tui.js";

// Dialogs that answer from a script: a select answer is the title of the option to pick (or
// undefined to cancel), a prompt answer is the text typed. Every dialog shown is recorded.
function scriptedDialogs(answers) {
  const shown = [];
  const next = () => answers.shift();
  return {
    shown,
    dialogs: {
      async select({ title, options }) {
        shown.push({ title, options: options.map((option) => option.title) });
        const pick = next();
        return pick === undefined
          ? undefined
          : options.find((option) => option.title === pick)?.value;
      },
      async prompt({ title }) {
        shown.push({ title });
        return next();
      },
    },
  };
}

test("each choice builds the line the grammar already accepts", async () => {
  const cases = [
    [["Show status"], true, "status"],
    [["This session: intensity", "aggressive"], true, "aggressive"],
    [["This session: Advisor mode", "on"], true, "advisor on"],
    [
      ["This session: model preference", "efficient"],
      true,
      "preference efficient",
    ],
    [["This session: reset"], true, "reset"],
    [["This session: clear"], true, "clear"],
    [["Defaults: intensity", "normal"], false, "defaults intensity normal"],
    [
      ["Defaults: Advisor mode", "with-delegation"],
      false,
      "defaults advisor-mode with-delegation",
    ],
    [
      ["Defaults: role model", "small", " acme/model#high "],
      false,
      "defaults role small acme/model#high",
    ],
    [
      ["Defaults: role thinking", "large", "low..high"],
      false,
      "defaults thinking large low..high",
    ],
    [
      ["Defaults: Advisors", "acme/a acme/b"],
      false,
      "defaults advisors acme/a acme/b",
    ],
    [["Show the local log"], false, "log"],
  ];
  for (const [answers, sessionOpen, expected] of cases) {
    const { dialogs } = scriptedDialogs([...answers]);
    assert.equal(
      await chooseDelegateLine(dialogs, sessionOpen),
      expected,
      answers.join(" > "),
    );
  }
});

test("session choices are only offered with a session open", async () => {
  const { dialogs, shown } = scriptedDialogs([undefined]);

  await chooseDelegateLine(dialogs, false);

  assert.equal(
    shown[0].options.some((title) => title.startsWith("This session")),
    false,
  );
});

test("cancelling at any step, or typing nothing usable, builds nothing", async () => {
  for (const answers of [
    [undefined],
    ["This session: intensity", undefined],
    ["Defaults: role model", undefined],
    ["Defaults: role model", "small", undefined],
    ["Defaults: role model", "small", "   "],
    // A model with a space would split into two words and change meaning.
    ["Defaults: role model", "small", "acme/a acme/b"],
    ["Defaults: Advisors", ""],
  ]) {
    const { dialogs } = scriptedDialogs([...answers]);
    assert.equal(
      await chooseDelegateLine(dialogs, true),
      undefined,
      String(answers),
    );
  }
});

test("a bare /delegate opens the selector and sends what it built; cancelling sends nothing", async () => {
  const sent = [];
  const alerts = [];
  const ports = (answers) => ({
    rpc: () => ({
      run: async (input) => {
        sent.push(input);
        return { text: "ok" };
      },
    }),
    alert: async (options) => {
      alerts.push(options);
    },
    sessionID: () => "ses_1",
    dialogs: scriptedDialogs(answers).dialogs,
  });

  await runDelegateInTui("/delegate", ports(["This session: reset"]));
  await runDelegateInTui("", ports([undefined]));
  // A typed command never opens the selector.
  await runDelegateInTui("normal", ports([]));

  assert.deepEqual(sent, [
    { line: "reset", sessionID: "ses_1" },
    { line: "normal", sessionID: "ses_1" },
  ]);
  assert.equal(alerts.length, 2);
});
