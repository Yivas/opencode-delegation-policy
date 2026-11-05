import assert from "node:assert/strict";
import { test } from "node:test";

import { watchTurns } from "../dist/policy/turns.js";

// A subscription made from a list of scripted streams. Each item is either an array of events, a
// stream that then ends, or an Error, a stream that fails (thrown on subscribe or while reading).
function scripted(streams) {
  let index = 0;
  return (options) => {
    const next = streams[index];
    index += 1;
    if (next instanceof Error && next.message === "sync") throw next;
    return {
      async *[Symbol.asyncIterator]() {
        if (next === undefined) {
          // Nothing more scripted: wait until the watcher stops.
          await new Promise((resolve) =>
            options.signal.addEventListener("abort", resolve),
          );
          return;
        }
        if (next instanceof Error) throw next;
        for (const event of next) yield event;
      },
    };
  };
}

test("every kind of turn ending is reported with whether it succeeded", async () => {
  const controller = new AbortController();
  const endings = [];
  const watcher = watchTurns({
    subscribe: scripted([
      [
        { type: "session.execution.succeeded", data: { sessionID: "a" } },
        { type: "session.text.delta", data: { sessionID: "a" } },
        { type: "session.execution.failed", data: { sessionID: "b" } },
        { type: "session.execution.interrupted", data: { sessionID: "c" } },
      ],
    ]),
    ended: (sessionID, succeeded) => endings.push([sessionID, succeeded]),
    signal: controller.signal,
    wait: async () => {},
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort();
  await watcher.done;

  assert.deepEqual(endings, [
    ["a", true],
    ["b", false],
    ["c", false],
  ]);
  assert.equal(watcher.state(), "stopped");
});

test("a stream that fails or ends is opened again, with growing pauses", async () => {
  const controller = new AbortController();
  const endings = [];
  const pauses = [];
  const watcher = watchTurns({
    subscribe: scripted([
      new Error("sync"),
      new Error("while reading"),
      [],
      [{ type: "session.execution.succeeded", data: { sessionID: "a" } }],
    ]),
    ended: (sessionID, succeeded) => endings.push([sessionID, succeeded]),
    signal: controller.signal,
    wait: async (milliseconds) => {
      pauses.push(milliseconds);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(endings, [["a", true]]);
  assert.deepEqual(pauses.slice(0, 3), [1000, 2000, 4000]);
  controller.abort();
  await watcher.done;
});

test("the state says when the stream is not being read", async () => {
  const controller = new AbortController();
  let release;
  const watcher = watchTurns({
    subscribe: scripted([new Error("sync")]),
    ended: () => {},
    signal: controller.signal,
    wait: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(watcher.state(), "reconnecting");
  controller.abort();
  release();
  await watcher.done;
  assert.equal(watcher.state(), "stopped");
});
