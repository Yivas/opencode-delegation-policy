import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BOTH_OFF_LINE,
  createNoticeTracker,
  noticeLines,
  projectNotice,
} from "../dist/policy/notice.js";

// Expected behavior is Pi 0.22's notice (src/config-notice.ts and its use in src/index.ts): the
// next turn after an effective change says what changed, reversions and no-ops say nothing, both
// axes off speak once, and only a completed turn consumes the notice.

const UNSET = { kind: "unset" };

function preferences(overrides = {}) {
  return {
    intensity: "normal",
    preference: "standard",
    advisorMode: "with-delegation",
    roles: {
      small: { kind: "configured", model: "acme/small" },
      medium: { kind: "disabled" },
      large: { kind: "disabled" },
      visualDesign: UNSET,
    },
    thinking: {
      small: UNSET,
      medium: UNSET,
      large: UNSET,
      visualDesign: UNSET,
    },
    advisors: UNSET,
    ...overrides,
  };
}

test("a change is listed as previous -> current, field by field", () => {
  const lines = noticeLines(
    projectNotice(preferences()),
    projectNotice(
      preferences({
        intensity: "orchestrator",
        thinking: {
          small: { kind: "fixed", level: "high" },
          medium: UNSET,
          large: UNSET,
          visualDesign: UNSET,
        },
      }),
    ),
  );

  assert.deepEqual(lines, [
    "- Delegation intensity: normal -> orchestrator",
    "- Small thinking: unset -> fixed high",
  ]);
});

test("turning both axes off speaks once, and edits while off say nothing", () => {
  const on = projectNotice(preferences());
  const off = projectNotice(preferences({ intensity: "off" }));
  const offEdited = projectNotice(
    preferences({ intensity: "off", preference: "efficient" }),
  );

  assert.deepEqual(noticeLines(on, off), [`- ${BOTH_OFF_LINE}`]);
  assert.deepEqual(noticeLines(off, offEdited), []);
});

test("the first request of a session sets the baseline without a notice", () => {
  const tracker = createNoticeTracker();

  assert.equal(
    tracker.forRequest("ses", projectNotice(preferences())),
    undefined,
  );
});

test("a notice repeats within the turn and is consumed only when the turn succeeds", () => {
  const tracker = createNoticeTracker();
  tracker.forRequest("ses", projectNotice(preferences()));
  tracker.ended("ses", true);
  const changed = projectNotice(preferences({ intensity: "aggressive" }));

  const first = tracker.forRequest("ses", changed);
  // A tool continuation in the same turn carries it again: the model may not have read it yet.
  const again = tracker.forRequest("ses", changed);
  assert.match(first, /Delegation intensity: normal -> aggressive/);
  assert.equal(again, first);

  tracker.ended("ses", true);
  assert.equal(tracker.forRequest("ses", changed), undefined);
});

test("a turn that did not succeed leaves the notice for the next one", () => {
  const tracker = createNoticeTracker();
  tracker.forRequest("ses", projectNotice(preferences()));
  tracker.ended("ses", true);
  const changed = projectNotice(preferences({ intensity: "aggressive" }));
  tracker.forRequest("ses", changed);

  // The turn failed or was interrupted: the next turn still says it.
  tracker.ended("ses", false);
  assert.match(tracker.forRequest("ses", changed), /normal -> aggressive/);
});

test("a change reverted before any turn consumed it says nothing", () => {
  const tracker = createNoticeTracker();
  const original = projectNotice(preferences());
  tracker.forRequest("ses", original);
  tracker.ended("ses", true);
  tracker.forRequest("ses", projectNotice(preferences({ intensity: "off" })));
  tracker.ended("ses", false);

  assert.equal(tracker.forRequest("ses", original), undefined);
  // And a success then consumes nothing, so a later change is still measured from the original.
  tracker.ended("ses", true);
  assert.match(
    tracker.forRequest(
      "ses",
      projectNotice(preferences({ preference: "efficient" })),
    ),
    /Model preference: standard -> efficient/,
  );
});

test("an edit during the very first turn waits for the next turn", () => {
  const tracker = createNoticeTracker();
  tracker.forRequest("ses", projectNotice(preferences()));
  const changed = projectNotice(preferences({ intensity: "aggressive" }));
  assert.equal(tracker.forRequest("ses", changed), undefined);
  tracker.ended("ses", true);
  assert.match(tracker.forRequest("ses", changed), /normal -> aggressive/);
});

test("sessions keep separate notices", () => {
  const tracker = createNoticeTracker();
  tracker.forRequest("a", projectNotice(preferences()));
  tracker.forRequest("b", projectNotice(preferences()));
  tracker.ended("a", true);
  tracker.ended("b", true);

  assert.ok(
    tracker.forRequest("a", projectNotice(preferences({ intensity: "off" }))),
  );
  assert.equal(
    tracker.forRequest("b", projectNotice(preferences())),
    undefined,
  );
});
