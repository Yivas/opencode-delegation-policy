import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateMistralSimpleCap,
  MISTRAL_CAP_SOURCE,
  MISTRAL_CATALOGUE,
  MISTRAL_CONDITIONS,
  MISTRAL_SOURCE_HASHES,
  MISTRAL_SOURCE_SCOPE,
  planMistralLevel,
  planMistralRange,
} from "../dist/thinking/mistral.js";

// Expected values come from the Pi AI 0.87.1 archive, read as text and JSON. They are not computed by the module under
// test: rows from providers/data/mistral.json, caps from api/simple-options.js with catalogue windows, and channel
// selection from api/mistral-conversations.js (usesReasoningEffort). No SDK, host, environment or network is used.

const PROVIDER = "mistral";
const API = "mistral-conversations";
const SECRET = "synthetic-secret-marker-m7q2";

// [protocolModelID, channel, maxTokens, contextWindow, Simple cap at estimate 0 with no caller cap]
const EXPECTED_ROWS = [
  ["mistral-small-latest", "reasoning_effort", 256000, 256000, 251904],
  ["mistral-small-2603", "reasoning_effort", 256000, 256000, 251904],
  ["mistral-medium-latest", "reasoning_effort", 262144, 262144, 258048],
  ["mistral-medium-2604", "reasoning_effort", 262144, 262144, 258048],
  ["mistral-medium-3.5", "reasoning_effort", 262144, 262144, 258048],
  ["zai-glm-5-2", "reasoning_effort", 131072, 1000000, 131072],
  ["magistral-small", "prompt_mode", 128000, 128000, 123904],
  ["magistral-medium-latest", "prompt_mode", 16384, 128000, 16384],
  ["zai-glm-5-3", "prompt_mode", 131072, 1000000, 131072],
];

const EFFORT_IDS = [
  "mistral-small-latest",
  "mistral-small-2603",
  "mistral-medium-latest",
  "mistral-medium-2604",
  "mistral-medium-3.5",
  "zai-glm-5-2",
];
const PROMPT_IDS = [
  "magistral-small",
  "magistral-medium-latest",
  "zai-glm-5-3",
];
const POSITIVE = ["minimal", "low", "medium", "high"];
const SUPPORTED = ["off", ...POSITIVE];

const SOURCE_HASHES = {
  "api/mistral-conversations.js":
    "beea0b191eaf33f0b412fb0c10219fac89a599fba9c4f215a1fcfd5ea8c3f46e",
  "api/mistral-conversations.lazy.js":
    "df0028011c26593830914429185f22bc60fa942e86ac871faa361abd2eaaf83e",
  "api/simple-options.js":
    "1caf860e028e22639578aba3ec8b79e5be9650c27bd3f19471c78502976555f3",
  "models.js":
    "75fa33149fb608bc4a7b7a0586c8ca8f0024465d580091b0c426c0baf3fbc80a",
  "providers/data/mistral.json":
    "df70e9066f39ffd93734895530653d642e9491bf66dd4b6ab1138f0cb400ae65",
  "utils/estimate.js":
    "ad08d86f790f6113d82610d9b0d5007eb8ebd27245409cc7262aed0b43613ced",
};

const OFF_CONTROL = { reasoningEffort: "absent", promptMode: "absent" };
const EFFORT_CONTROL = { reasoningEffort: "high", promptMode: "absent" };
const PROMPT_CONTROL = { reasoningEffort: "absent", promptMode: "reasoning" };

const identity = (id, overrides = {}) => ({
  provider: PROVIDER,
  api: API,
  protocolModelID: id,
  ...overrides,
});
const SIMPLE = (callerCap, estimate) => ({ callerCap, estimate });
const ABSENT = { kind: "absent" };
const UNKNOWN = { kind: "unknown" };
const known = (value) => ({ kind: "known", value });
const supplied = (tokens) => ({ kind: "supplied", tokens });

const cap = (plan) => {
  assert.equal(plan.kind, "planned");
  assert.equal(plan.cap.kind, "calculated");
  return plan.cap.value;
};

test("catalogue holds the nine archive rows exactly, with their channels and advertised levels", () => {
  assert.equal(MISTRAL_CATALOGUE.length, 9);
  EXPECTED_ROWS.forEach(([id, channel, maxTokens, contextWindow], index) => {
    const row = MISTRAL_CATALOGUE[index];
    assert.equal(row.protocolModelID, id);
    assert.equal(row.provider, PROVIDER);
    assert.equal(row.api, API);
    assert.equal(row.channel, channel);
    assert.equal(row.modelMaxTokens, maxTokens);
    assert.equal(row.contextWindow, contextWindow);
    assert.deepEqual(row.supportedLevels, SUPPORTED);
  });
  assert.equal(
    MISTRAL_CATALOGUE.filter((row) => row.channel === "reasoning_effort")
      .length,
    6,
  );
  assert.equal(
    MISTRAL_CATALOGUE.filter((row) => row.channel === "prompt_mode").length,
    3,
  );
  assert.deepEqual(
    MISTRAL_CATALOGUE.filter((row) => row.channel === "reasoning_effort").map(
      (row) => row.protocolModelID,
    ),
    EFFORT_IDS,
  );
  assert.deepEqual(
    MISTRAL_CATALOGUE.filter((row) => row.channel === "prompt_mode").map(
      (row) => row.protocolModelID,
    ),
    PROMPT_IDS,
  );
});

test("catalogue rows and their nested arrays are deeply frozen", () => {
  assert.ok(Object.isFrozen(MISTRAL_CATALOGUE));
  for (const row of MISTRAL_CATALOGUE) {
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.supportedLevels));
  }
  assert.throws(() => MISTRAL_CATALOGUE.push({}), TypeError);
  assert.throws(() => {
    MISTRAL_CATALOGUE[0].modelMaxTokens = 1;
  }, TypeError);
  assert.throws(
    () => MISTRAL_CATALOGUE[0].supportedLevels.push("max"),
    TypeError,
  );
});

test("source metadata names the exact hashed Pi files and the simple path scope", () => {
  assert.deepEqual({ ...MISTRAL_SOURCE_HASHES }, SOURCE_HASHES);
  assert.ok(Object.isFrozen(MISTRAL_SOURCE_HASHES));
  assert.match(
    MISTRAL_SOURCE_SCOPE,
    /api\/mistral-conversations\.js streamSimple/,
  );
});

test("lookup needs the exact provider, API and row id, with no aliases or package identity", () => {
  for (const id of [
    "mistral-small",
    "Mistral-Small-Latest",
    "mistral-small-latest ",
    "magistral-small-2509",
    "__proto__",
    "constructor",
  ]) {
    assert.deepEqual(
      planMistralLevel(identity(id), "off", SIMPLE(ABSENT, supplied(0))),
      {
        kind: "insufficient",
        reason: "model",
      },
    );
  }
  assert.deepEqual(
    planMistralLevel(
      identity("zai-glm-5-2", { provider: "Mistral" }),
      "off",
      SIMPLE(ABSENT, supplied(0)),
    ),
    {
      kind: "insufficient",
      reason: "provider",
    },
  );
  assert.deepEqual(
    planMistralLevel(
      identity("zai-glm-5-2", { provider: "@opencode/ai/providers/mistral" }),
      "off",
      SIMPLE(ABSENT, supplied(0)),
    ),
    { kind: "insufficient", reason: "provider" },
  );
  assert.deepEqual(
    planMistralLevel(
      identity("zai-glm-5-2", { api: "openai-completions" }),
      "off",
      SIMPLE(ABSENT, supplied(0)),
    ),
    {
      kind: "insufficient",
      reason: "api",
    },
  );
  assert.deepEqual(
    planMistralRange(
      identity("zai-glm-5-2", { api: "mistral-chat" }),
      { from: "off", to: "high" },
      SIMPLE(ABSENT, supplied(0)),
    ),
    {
      kind: "insufficient",
      reason: "api",
    },
  );
});

test("identity fields must be own data properties; inherited or accessor fields are rejected unread", () => {
  const inherited = Object.create(identity("zai-glm-5-2"));
  assert.deepEqual(
    planMistralLevel(inherited, "off", SIMPLE(ABSENT, supplied(0))),
    { kind: "invalid-input", code: "candidate" },
  );

  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "protocolModelID", {
    enumerable: true,
    get() {
      reads += 1;
      return "zai-glm-5-2";
    },
  });
  accessor.provider = PROVIDER;
  accessor.api = API;
  assert.deepEqual(
    planMistralLevel(accessor, "off", SIMPLE(ABSENT, supplied(0))),
    { kind: "invalid-input", code: "candidate" },
  );
  assert.equal(reads, 0);

  assert.deepEqual(
    planMistralLevel(
      { packageName: "@opencode/ai/providers/mistral" },
      "off",
      SIMPLE(ABSENT, supplied(0)),
    ),
    {
      kind: "invalid-input",
      code: "candidate",
    },
  );
  assert.deepEqual(planMistralLevel(null, "off", SIMPLE(ABSENT, supplied(0))), {
    kind: "invalid-input",
    code: "candidate",
  });
});

test("throwing property traps return opaque errors at every input boundary", () => {
  const trapped = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error(SECRET);
      },
    },
  );
  const row = identity("zai-glm-5-2");
  const results = [
    [
      planMistralLevel(trapped, "low", SIMPLE(ABSENT, supplied(0))),
      "candidate",
    ],
    [planMistralRange(row, trapped, SIMPLE(ABSENT, supplied(0))), "range"],
    [planMistralLevel(row, "low", trapped), "caller-cap"],
    [planMistralLevel(row, "low", SIMPLE(trapped, supplied(0))), "caller-cap"],
    [planMistralLevel(row, "low", SIMPLE(ABSENT, trapped)), "estimate"],
    [calculateMistralSimpleCap(trapped), "model-max"],
  ];
  for (const [result, code] of results) {
    assert.deepEqual(result, { kind: "invalid-input", code });
    assert.ok(!JSON.stringify(result).includes(SECRET));
  }
});

test("revoked objects return opaque errors including array detection for ranges", () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const row = identity("zai-glm-5-2");
  assert.deepEqual(
    planMistralLevel(revoked.proxy, "off", SIMPLE(ABSENT, supplied(0))),
    {
      kind: "invalid-input",
      code: "candidate",
    },
  );
  assert.deepEqual(
    planMistralRange(row, revoked.proxy, SIMPLE(ABSENT, supplied(0))),
    {
      kind: "invalid-input",
      code: "range",
    },
  );
  assert.deepEqual(calculateMistralSimpleCap(revoked.proxy), {
    kind: "invalid-input",
    code: "model-max",
  });
});

test("off omits both fields as a candidate with only the off class, not as a clearing recipe", () => {
  const plan = planMistralLevel(
    identity("mistral-small-latest"),
    "off",
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.equal(plan.kind, "planned");
  assert.equal(plan.scope, "level");
  assert.deepEqual(plan.candidates.length, 1);
  assert.deepEqual(plan.candidates[0].control, OFF_CONTROL);
  assert.deepEqual(plan.candidates[0].admittedLevels, ["off"]);
  assert.deepEqual(plan.candidates[0].compatibleLevels, ["off"]);
  assert.deepEqual(plan.admittedLevels, ["off"]);
});

test("every positive level on an effort row serializes reasoningEffort high with the full compatible set", () => {
  for (const id of EFFORT_IDS) {
    for (const level of POSITIVE) {
      const plan = planMistralLevel(
        identity(id),
        level,
        SIMPLE(ABSENT, supplied(0)),
      );
      assert.equal(plan.kind, "planned", `${id} ${level}`);
      assert.equal(plan.channel, "reasoning_effort");
      assert.deepEqual(plan.candidates[0].control, EFFORT_CONTROL);
      assert.deepEqual(plan.candidates[0].admittedLevels, [level]);
      assert.deepEqual(plan.candidates[0].compatibleLevels, POSITIVE);
    }
  }
});

test("every positive level on a prompt row serializes promptMode reasoning and omits reasoningEffort", () => {
  for (const id of PROMPT_IDS) {
    for (const level of POSITIVE) {
      const plan = planMistralLevel(
        identity(id),
        level,
        SIMPLE(ABSENT, supplied(0)),
      );
      assert.equal(plan.kind, "planned", `${id} ${level}`);
      assert.equal(plan.channel, "prompt_mode");
      assert.deepEqual(plan.candidates[0].control, PROMPT_CONTROL);
      assert.deepEqual(plan.candidates[0].compatibleLevels, POSITIVE);
    }
  }
});

test("fixed xhigh and max are unsupported with SDK-clamp evidence kept separate from admission", () => {
  for (const level of ["xhigh", "max"]) {
    const plan = planMistralLevel(
      identity("zai-glm-5-2"),
      level,
      SIMPLE(ABSENT, supplied(0)),
    );
    assert.equal(plan.kind, "unsupported-in-snapshot");
    assert.equal(plan.scope, "level");
    assert.equal(plan.level, level);
    assert.match(plan.sourceEvidence, /not policy admission/);
  }
});

test("unknown strings and non-strings are invalid levels, never a silent fallback to off", () => {
  for (const level of [
    "auto",
    "",
    "OFF",
    "High",
    "none",
    undefined,
    null,
    1,
    true,
    SECRET,
  ]) {
    const plan = planMistralLevel(
      identity("zai-glm-5-2"),
      level,
      SIMPLE(ABSENT, supplied(0)),
    );
    assert.deepEqual(plan, { kind: "invalid-input", code: "level" });
    assert.ok(!JSON.stringify(plan).includes(SECRET));
  }
});

test("range off..high returns two candidates, the off class and the positive class, with nothing selected", () => {
  const plan = planMistralRange(
    identity("magistral-small"),
    { from: "off", to: "high" },
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.equal(plan.kind, "planned");
  assert.equal(plan.scope, "range");
  assert.equal(plan.candidates.length, 2);
  assert.deepEqual(plan.candidates[0].control, OFF_CONTROL);
  assert.deepEqual(plan.candidates[0].admittedLevels, ["off"]);
  assert.deepEqual(plan.candidates[1].control, PROMPT_CONTROL);
  assert.deepEqual(plan.candidates[1].admittedLevels, POSITIVE);
  assert.deepEqual(plan.candidates[1].compatibleLevels, POSITIVE);
  assert.deepEqual(plan.admittedLevels, SUPPORTED);
});

test("a positive subrange returns one candidate whose compatible set stays the full four", () => {
  const plan = planMistralRange(
    identity("zai-glm-5-2"),
    { from: "low", to: "medium" },
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.equal(plan.candidates.length, 1);
  assert.deepEqual(plan.candidates[0].admittedLevels, ["low", "medium"]);
  assert.deepEqual(plan.candidates[0].compatibleLevels, POSITIVE);
  assert.deepEqual(plan.candidates[0].control, EFFORT_CONTROL);
});

test("a range that reaches above high is intersected with the advertised levels, not rejected", () => {
  const plan = planMistralRange(
    identity("mistral-medium-2604"),
    { from: "high", to: "max" },
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.equal(plan.kind, "planned");
  assert.deepEqual(plan.admittedLevels, ["high"]);
  assert.equal(plan.candidates.length, 1);
});

test("a range entirely above the advertised levels is unsupported", () => {
  assert.deepEqual(
    planMistralRange(
      identity("mistral-medium-2604"),
      { from: "xhigh", to: "max" },
      SIMPLE(ABSENT, supplied(0)),
    ),
    {
      kind: "unsupported-in-snapshot",
      scope: "range",
      source: MISTRAL_SOURCE_SCOPE,
      conditions: MISTRAL_CONDITIONS,
    },
  );
});

test("reversed, sparse, non-record and unknown ranges are rejected cleanly as range errors", () => {
  for (const bad of [
    { from: "high", to: "low" },
    { from: "off" },
    { to: "high" },
    [],
    ["off", "high"],
    null,
    undefined,
    { from: "auto", to: "high" },
    { from: "off", to: "none" },
  ]) {
    assert.deepEqual(
      planMistralRange(
        identity("zai-glm-5-2"),
        bad,
        SIMPLE(ABSENT, supplied(0)),
      ),
      {
        kind: "invalid-input",
        code: "range",
      },
    );
  }
});

test("range accessors are rejected without invoking them", () => {
  let reads = 0;
  const range = {};
  Object.defineProperty(range, "from", {
    enumerable: true,
    get() {
      reads += 1;
      return "off";
    },
  });
  range.to = "high";
  assert.deepEqual(
    planMistralRange(
      identity("zai-glm-5-2"),
      range,
      SIMPLE(ABSENT, supplied(0)),
    ),
    {
      kind: "invalid-input",
      code: "range",
    },
  );
  assert.equal(reads, 0);
});

test("the Simple cap at estimate zero matches the archive for all nine rows", () => {
  for (const [id, , , , expected] of EXPECTED_ROWS) {
    assert.equal(
      cap(planMistralLevel(identity(id), "high", SIMPLE(ABSENT, supplied(0)))),
      expected,
      id,
    );
  }
});

test("a supplied caller cap above the catalogue maximum is not clipped to that maximum", () => {
  assert.equal(
    cap(
      planMistralLevel(
        identity("zai-glm-5-2"),
        "low",
        SIMPLE(known(500000), supplied(0)),
      ),
    ),
    500000,
  );
  assert.equal(
    cap(
      planMistralLevel(
        identity("mistral-medium-latest"),
        "low",
        SIMPLE(known(300000), supplied(0)),
      ),
    ),
    258048,
  );
});

test("caller caps of zero, a fraction and absence are numeric contract values, not unknowns", () => {
  assert.equal(
    cap(
      planMistralLevel(
        identity("zai-glm-5-2"),
        "low",
        SIMPLE(known(0), supplied(0)),
      ),
    ),
    0,
  );
  assert.equal(
    cap(
      planMistralLevel(
        identity("zai-glm-5-2"),
        "low",
        SIMPLE(known(0.5), supplied(0)),
      ),
    ),
    0.5,
  );
  assert.equal(
    cap(
      planMistralLevel(
        identity("zai-glm-5-2"),
        "low",
        SIMPLE(ABSENT, supplied(0.5)),
      ),
    ),
    131072,
  );
});

test("an unknown caller cap or estimate is unresolved and never becomes zero", () => {
  assert.deepEqual(
    planMistralLevel(
      identity("zai-glm-5-2"),
      "low",
      SIMPLE(UNKNOWN, supplied(0)),
    ).cap,
    {
      kind: "unresolved",
      unresolved: "caller-cap",
    },
  );
  assert.deepEqual(
    planMistralLevel(identity("zai-glm-5-2"), "low", SIMPLE(ABSENT, UNKNOWN))
      .cap,
    {
      kind: "unresolved",
      unresolved: "estimate",
    },
  );
  assert.deepEqual(
    planMistralLevel(identity("zai-glm-5-2"), "low", SIMPLE(UNKNOWN, UNKNOWN))
      .cap,
    {
      kind: "unresolved",
      unresolved: "caller-cap",
    },
  );
});

test("malformed request inputs fail with fixed codes and no echo", () => {
  const row = identity("zai-glm-5-2");
  assert.deepEqual(planMistralLevel(row, "low", undefined), {
    kind: "invalid-input",
    code: "request",
  });
  assert.deepEqual(planMistralLevel(row, "low", null), {
    kind: "invalid-input",
    code: "request",
  });
  assert.deepEqual(planMistralLevel(row, "low", { estimate: supplied(0) }), {
    kind: "invalid-input",
    code: "caller-cap",
  });
  assert.deepEqual(planMistralLevel(row, "low", { callerCap: ABSENT }), {
    kind: "invalid-input",
    code: "estimate",
  });
  assert.deepEqual(
    planMistralLevel(row, "low", SIMPLE(known(-1), supplied(0))),
    { kind: "invalid-input", code: "caller-cap" },
  );
  assert.deepEqual(
    planMistralLevel(row, "low", SIMPLE(known(Number.NaN), supplied(0))),
    { kind: "invalid-input", code: "caller-cap" },
  );
  assert.deepEqual(
    planMistralLevel(row, "low", SIMPLE(known("1000"), supplied(0))),
    { kind: "invalid-input", code: "caller-cap" },
  );
  for (const estimate of [
    supplied(-1),
    supplied(Number.NaN),
    supplied(Number.POSITIVE_INFINITY),
    supplied("0"),
    SECRET,
  ]) {
    assert.deepEqual(planMistralLevel(row, "low", SIMPLE(ABSENT, estimate)), {
      kind: "invalid-input",
      code: "estimate",
    });
  }
  const plan = planMistralLevel(row, "low", SIMPLE(known(SECRET), supplied(0)));
  assert.ok(!JSON.stringify(plan).includes(SECRET));
});

test("unsupported admission reads neither the caller cap nor the estimate", () => {
  let reads = 0;
  const request = {};
  Object.defineProperty(request, "callerCap", {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error(SECRET);
    },
  });
  Object.defineProperty(request, "estimate", {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error(SECRET);
    },
  });
  assert.equal(
    planMistralLevel(identity("zai-glm-5-2"), "xhigh", request).kind,
    "unsupported-in-snapshot",
  );
  assert.equal(
    planMistralRange(
      identity("zai-glm-5-2"),
      { from: "xhigh", to: "max" },
      request,
    ).kind,
    "unsupported-in-snapshot",
  );
  assert.equal(reads, 0);
});

test("the estimate boundary for the clamp is exact on the two windows", () => {
  assert.equal(
    cap(
      planMistralLevel(
        identity("magistral-medium-latest"),
        "low",
        SIMPLE(ABSENT, supplied(107520)),
      ),
    ),
    16384,
  );
  assert.equal(
    cap(
      planMistralLevel(
        identity("magistral-medium-latest"),
        "low",
        SIMPLE(ABSENT, supplied(107521)),
      ),
    ),
    16383,
  );
  assert.equal(
    cap(
      planMistralLevel(
        identity("zai-glm-5-2"),
        "low",
        SIMPLE(ABSENT, supplied(864832)),
      ),
    ),
    131072,
  );
  assert.equal(
    cap(
      planMistralLevel(
        identity("zai-glm-5-2"),
        "low",
        SIMPLE(ABSENT, supplied(864833)),
      ),
    ),
    131071,
  );
  assert.equal(
    cap(
      planMistralLevel(
        identity("zai-glm-5-3"),
        "low",
        SIMPLE(ABSENT, supplied(864833)),
      ),
    ),
    131071,
  );
});

test("the cap calculator checks its own frame and the window is positive", () => {
  const calculated = calculateMistralSimpleCap({
    modelMaxTokens: 128000,
    contextWindow: 128000,
    callerCap: ABSENT,
    estimate: supplied(0),
  });
  assert.equal(calculated.kind, "calculated");
  assert.equal(calculated.value, 123904);
  assert.equal(calculated.source, MISTRAL_CAP_SOURCE);
  assert.deepEqual(calculateMistralSimpleCap(null), {
    kind: "invalid-input",
    code: "request",
  });
  assert.deepEqual(
    calculateMistralSimpleCap({
      modelMaxTokens: 0,
      contextWindow: 128000,
      callerCap: ABSENT,
      estimate: supplied(0),
    }),
    { kind: "invalid-input", code: "model-max" },
  );
  assert.deepEqual(
    calculateMistralSimpleCap({
      modelMaxTokens: 1000,
      contextWindow: 0,
      callerCap: ABSENT,
      estimate: supplied(0),
    }),
    { kind: "invalid-input", code: "context-window" },
  );
});

test("every planned result carries its source scope and the retained conditions", () => {
  const level = planMistralLevel(
    identity("mistral-small-latest"),
    "high",
    SIMPLE(ABSENT, supplied(0)),
  );
  const range = planMistralRange(
    identity("zai-glm-5-3"),
    { from: "off", to: "high" },
    SIMPLE(ABSENT, supplied(0)),
  );
  for (const plan of [level, range]) {
    assert.equal(plan.source, MISTRAL_SOURCE_SCOPE);
    assert.deepEqual(plan.conditions, MISTRAL_CONDITIONS);
  }
  for (const condition of [
    "pi-api-key-truthy-prerequisite",
    "pi-on-payload-replacement",
    "native-provider-options-forwarded-settings",
    "body-overlay-control-and-cap-fields",
    "virtual-pi-cap-not-native-cap",
    "provider-acceptance-unverified",
  ]) {
    assert.ok(MISTRAL_CONDITIONS.includes(condition), condition);
  }
});

test("results are deeply frozen and inputs are never modified", () => {
  const row = identity("magistral-small");
  const request = Object.freeze({
    callerCap: Object.freeze(known(1000)),
    estimate: Object.freeze(supplied(0)),
  });
  const range = Object.freeze({ from: "off", to: "high" });
  const plan = planMistralRange(row, range, request);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.admittedLevels));
  assert.ok(Object.isFrozen(plan.candidates));
  assert.ok(Object.isFrozen(plan.candidates[0].control));
  assert.ok(Object.isFrozen(plan.cap));
  assert.throws(() => {
    plan.candidates[0].control.reasoningEffort = "high";
  }, TypeError);
  assert.deepEqual(row, identity("magistral-small"));
  assert.deepEqual(request, { callerCap: known(1000), estimate: supplied(0) });
  assert.deepEqual(range, { from: "off", to: "high" });
});

test("the module exposes only the source planner surface, with no raw or native planner", async () => {
  const exported = Object.keys(
    await import("../dist/thinking/mistral.js"),
  ).sort();
  assert.deepEqual(exported, [
    "MISTRAL_API",
    "MISTRAL_CANONICAL_LEVELS",
    "MISTRAL_CAP_SOURCE",
    "MISTRAL_CATALOGUE",
    "MISTRAL_CONDITIONS",
    "MISTRAL_POSITIVE_LEVELS",
    "MISTRAL_PROVIDER",
    "MISTRAL_SDK_CLAMP_EVIDENCE",
    "MISTRAL_SOURCE_HASHES",
    "MISTRAL_SOURCE_SCOPE",
    "MISTRAL_SUPPORTED_LEVELS",
    "calculateMistralSimpleCap",
    "planMistralLevel",
    "planMistralRange",
  ]);
});
