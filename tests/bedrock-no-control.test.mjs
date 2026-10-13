import assert from "node:assert/strict";
import { test } from "node:test";

import { calculateOffCap } from "../dist/thinking/bedrock-budget.js";
import {
  calculateBedrockNoControlCap,
  NO_CONTROL_CATALOGUE,
  NO_CONTROL_CONDITIONS,
  NO_CONTROL_LEVELS,
  NO_CONTROL_TARGET,
  planBedrockNoControlLevel,
  planBedrockNoControlRange,
} from "../dist/thinking/bedrock-no-control.js";

// Expected rows are the 54 non-Claude reasoning rows of the Pi 0.87.1 catalogue (amazon-bedrock.json, read as data).
// Tuples are [protocolModelID, maxTokens, contextWindow, number of advertised levels]. The module under test does not
// compute them. No SDK, host, environment or network is used.
const EXPECTED_ROWS = [
  ["amazon.nova-2-lite-v1:0", 65535, 1000000, 5],
  ["deepseek.v3-v1:0", 81920, 163840, 5],
  ["deepseek.v3.2", 81920, 163840, 5],
  ["eu.amazon.nova-2-lite-v1:0", 65535, 1000000, 5],
  ["global.amazon.nova-2-lite-v1:0", 65535, 1000000, 5],
  ["global.openai.gpt-5.6-luna", 128000, 1050000, 6],
  ["global.openai.gpt-5.6-sol", 128000, 1050000, 6],
  ["global.openai.gpt-5.6-terra", 128000, 1050000, 6],
  ["global.openai.gpt-6-astra", 128000, 1050000, 6],
  ["global.xai.grok-4.6", 500000, 500000, 5],
  ["google.gemma-4-26b-a4b", 32768, 262144, 5],
  ["google.gemma-4-31b", 32768, 262144, 5],
  ["google.gemma-4-e2b", 8192, 131072, 5],
  ["in.openai.gpt-5.6-luna", 128000, 1050000, 6],
  ["in.openai.gpt-5.6-terra", 128000, 1050000, 6],
  ["jp.amazon.nova-2-lite-v1:0", 65535, 1000000, 5],
  ["minimax.minimax-m2", 128000, 204608, 5],
  ["minimax.minimax-m2.1", 131072, 204800, 5],
  ["minimax.minimax-m2.5", 98304, 196608, 5],
  ["mistral.magistral-small-2509", 40000, 128000, 5],
  ["moonshot.kimi-k2-thinking", 16000, 262143, 5],
  ["moonshotai.kimi-k2.5", 16384, 262143, 5],
  ["nvidia.nemotron-nano-3-30b", 8192, 262144, 5],
  ["nvidia.nemotron-super-3-120b", 131072, 262144, 5],
  ["openai.gpt-5.4", 128000, 272000, 6],
  ["openai.gpt-5.5", 128000, 272000, 6],
  ["openai.gpt-5.6-luna", 128000, 1050000, 6],
  ["openai.gpt-5.6-sol", 128000, 1050000, 6],
  ["openai.gpt-5.6-terra", 128000, 1050000, 6],
  ["openai.gpt-6-astra", 128000, 1050000, 6],
  ["openai.gpt-oss-120b", 16384, 128000, 5],
  ["openai.gpt-oss-120b-1:0", 16384, 128000, 5],
  ["openai.gpt-oss-20b", 16384, 128000, 5],
  ["openai.gpt-oss-20b-1:0", 16384, 128000, 5],
  ["openai.gpt-oss-safeguard-120b", 16384, 128000, 5],
  ["openai.gpt-oss-safeguard-20b", 16384, 128000, 5],
  ["qwen.qwen3-32b-v1:0", 16384, 32768, 5],
  ["us-gov.openai.gpt-oss-120b-1:0", 16384, 128000, 5],
  ["us-gov.openai.gpt-oss-20b-1:0", 16384, 128000, 5],
  ["us.amazon.nova-2-lite-v1:0", 65535, 1000000, 5],
  ["us.openai.gpt-5.6-luna", 128000, 1050000, 6],
  ["us.openai.gpt-5.6-sol", 128000, 1050000, 6],
  ["us.openai.gpt-5.6-terra", 128000, 1050000, 6],
  ["us.openai.gpt-6-astra", 128000, 1050000, 6],
  ["us.writer.palmyra-x4-v1:0", 8192, 122880, 5],
  ["us.writer.palmyra-x5-v1:0", 8192, 1040000, 5],
  ["us.xai.grok-4.6", 500000, 500000, 5],
  ["writer.palmyra-x4-v1:0", 8192, 122880, 5],
  ["writer.palmyra-x5-v1:0", 8192, 1040000, 5],
  ["xai.grok-4.3", 131072, 1000000, 5],
  ["xai.grok-4.6", 500000, 500000, 5],
  ["zai.glm-4.7", 131072, 204800, 5],
  ["zai.glm-4.7-flash", 131072, 200000, 5],
  ["zai.glm-5", 131072, 202752, 5],
];

const PACKAGE = "@opencode/ai/providers/amazon-bedrock";
const API = "bedrock-converse-stream";
const SECRET = "synthetic-secret-marker-n4c1";
const CLAUDE_ID = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

const UNMAPPED = "amazon.nova-2-lite-v1:0";
const MAPPED = "openai.gpt-5.5";
const GROK = "xai.grok-4.6";
const QWEN = "qwen.qwen3-32b-v1:0";
const GEMMA = "google.gemma-4-26b-a4b";
const MINIMAX = "minimax.minimax-m2.1";

const LEVELS_UNMAPPED = ["off", "minimal", "low", "medium", "high"];
const LEVELS_MAPPED = [...LEVELS_UNMAPPED, "xhigh"];

const candidate = (id, overrides = {}) => ({
  packageName: PACKAGE,
  api: API,
  protocolModelID: id,
  ...overrides,
});
const RAW = (callerCap) => ({ path: "raw", callerCap });
const SIMPLE = (callerCap, estimate) => ({
  path: "simple",
  callerCap,
  estimate,
});
const ABSENT = { kind: "absent" };
const UNKNOWN = { kind: "unknown" };
const known = (value) => ({ kind: "known", value });
const supplied = (tokens) => ({ kind: "supplied", tokens });

const capValue = (plan) => {
  assert.equal(plan.kind, "planned");
  assert.equal(plan.cap.kind, "calculated");
  return plan.cap.value;
};

test("catalogue holds the 54 archive rows exactly, frozen and unique", () => {
  assert.equal(NO_CONTROL_CATALOGUE.length, EXPECTED_ROWS.length);
  assert.equal(EXPECTED_ROWS.length, 54);
  assert.equal(
    new Set(NO_CONTROL_CATALOGUE.map((row) => row.protocolModelID)).size,
    54,
  );
  EXPECTED_ROWS.forEach(([id, maxTokens, contextWindow, count], index) => {
    const row = NO_CONTROL_CATALOGUE[index];
    assert.equal(row.protocolModelID, id);
    assert.equal(row.modelMaxTokens, maxTokens);
    assert.equal(row.contextWindow, contextWindow);
    assert.deepEqual(
      row.supportedLevels,
      count === 6 ? LEVELS_MAPPED : LEVELS_UNMAPPED,
    );
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.supportedLevels));
  });
  assert.ok(Object.isFrozen(NO_CONTROL_CATALOGUE));
  assert.equal(
    NO_CONTROL_CATALOGUE.filter((row) => row.supportedLevels.length === 5)
      .length,
    38,
  );
  assert.equal(
    NO_CONTROL_CATALOGUE.filter((row) => row.supportedLevels.length === 6)
      .length,
    16,
  );
});

test("exported rows and levels cannot be poisoned", () => {
  assert.throws(
    () => NO_CONTROL_CATALOGUE[0].supportedLevels.push("max"),
    TypeError,
  );
  assert.throws(() => {
    NO_CONTROL_CATALOGUE[0].modelMaxTokens = 1;
  }, TypeError);
  assert.throws(() => NO_CONTROL_CATALOGUE.push({}), TypeError);
  assert.throws(() => NO_CONTROL_LEVELS.push("auto"), TypeError);
  const plan = planBedrockNoControlLevel(
    candidate(UNMAPPED),
    "off",
    RAW(ABSENT),
  );
  assert.deepEqual(plan.supportedLevels, LEVELS_UNMAPPED);
});

test("the seven canonical levels and the target name are fixed", () => {
  assert.deepEqual(
    [...NO_CONTROL_LEVELS],
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  );
  assert.equal(NO_CONTROL_TARGET, "pi-builder-emits-no-thinking-control");
  assert.ok(Object.isFrozen(NO_CONTROL_CONDITIONS));
  for (const condition of [
    "pi-on-payload-replacement",
    "lazy-module-override",
    "native-thinking-settings",
    "host-compatibility-binding",
    "body-overlay-control-fields",
    "body-overlay-cap",
  ]) {
    assert.ok(NO_CONTROL_CONDITIONS.includes(condition), condition);
  }
});

test("lookup is exact and never falls back to aliases, prototypes or other packages", () => {
  for (const id of [
    "__proto__",
    "constructor",
    "toString",
    " openai.gpt-5.5",
    "OPENAI.GPT-5.5",
    "openai.gpt-5.5 ",
    "openai.gpt-5",
    CLAUDE_ID,
  ]) {
    assert.deepEqual(
      planBedrockNoControlLevel(candidate(id), "off", RAW(ABSENT)),
      {
        kind: "insufficient",
        reason: "model",
      },
    );
  }
  assert.deepEqual(
    planBedrockNoControlLevel(
      candidate(MAPPED, { packageName: "@opencode/ai/providers/anthropic" }),
      "off",
      RAW(ABSENT),
    ),
    { kind: "insufficient", reason: "package" },
  );
  assert.deepEqual(
    planBedrockNoControlLevel(
      candidate(MAPPED, { api: "openai-chat" }),
      "off",
      RAW(ABSENT),
    ),
    {
      kind: "insufficient",
      reason: "api",
    },
  );
});

test("fixed levels: admitted singleton, compatible equals the row's supported set, all seven serialize alike", () => {
  const off = planBedrockNoControlLevel(
    candidate(UNMAPPED),
    "off",
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.equal(off.kind, "planned");
  assert.equal(off.target, NO_CONTROL_TARGET);
  assert.deepEqual(off.admittedLevels, ["off"]);
  assert.deepEqual(off.supportedLevels, LEVELS_UNMAPPED);
  assert.deepEqual(off.compatibleLevels, LEVELS_UNMAPPED);
  assert.deepEqual(off.serializerEquivalentLevels, NO_CONTROL_LEVELS);
  assert.deepEqual(off.conditions, NO_CONTROL_CONDITIONS);

  const high = planBedrockNoControlLevel(
    candidate(MAPPED),
    "high",
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.deepEqual(high.admittedLevels, ["high"]);
  assert.deepEqual(high.compatibleLevels, LEVELS_MAPPED);

  const xhigh = planBedrockNoControlLevel(
    candidate(MAPPED),
    "xhigh",
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.deepEqual(xhigh.admittedLevels, ["xhigh"]);
});

test("xhigh is unsupported on unmapped rows and max is unsupported on every row, without a physical claim", () => {
  const unsupported = { kind: "unsupported-in-snapshot", scope: "level" };
  assert.deepEqual(
    planBedrockNoControlLevel(candidate(UNMAPPED), "xhigh", RAW(ABSENT)),
    unsupported,
  );
  assert.deepEqual(
    planBedrockNoControlLevel(candidate(MAPPED), "max", RAW(ABSENT)),
    unsupported,
  );
  assert.deepEqual(
    planBedrockNoControlLevel(candidate(UNMAPPED), "max", RAW(ABSENT)),
    unsupported,
  );
});

test("invalid levels fail with an opaque code and never echo the caller value", () => {
  for (const level of ["auto", "", "OFF", "High", undefined, null, 1, SECRET]) {
    const plan = planBedrockNoControlLevel(
      candidate(MAPPED),
      level,
      RAW(ABSENT),
    );
    assert.deepEqual(plan, { kind: "invalid-input", code: "level" });
    assert.ok(!JSON.stringify(plan).includes(SECRET));
  }
});

test("ranges intersect the supported set and never select one level", () => {
  const range = (from, to) => ({ from, to });
  const full = planBedrockNoControlRange(
    candidate(UNMAPPED),
    range("off", "max"),
    RAW(ABSENT),
  );
  assert.deepEqual(full.admittedLevels, LEVELS_UNMAPPED);
  const fullMapped = planBedrockNoControlRange(
    candidate(MAPPED),
    range("off", "max"),
    RAW(ABSENT),
  );
  assert.deepEqual(fullMapped.admittedLevels, LEVELS_MAPPED);
  const lowHigh = planBedrockNoControlRange(
    candidate(UNMAPPED),
    range("low", "high"),
    RAW(ABSENT),
  );
  assert.deepEqual(lowHigh.admittedLevels, ["low", "medium", "high"]);
  const lowXhigh = planBedrockNoControlRange(
    candidate(UNMAPPED),
    range("low", "xhigh"),
    RAW(ABSENT),
  );
  assert.deepEqual(lowXhigh.admittedLevels, ["low", "medium", "high"]);
  const xhighMaxUnmapped = planBedrockNoControlRange(
    candidate(UNMAPPED),
    range("xhigh", "max"),
    RAW(ABSENT),
  );
  assert.deepEqual(xhighMaxUnmapped, {
    kind: "unsupported-in-snapshot",
    scope: "range",
  });
  const xhighMaxMapped = planBedrockNoControlRange(
    candidate(MAPPED),
    range("xhigh", "max"),
    RAW(ABSENT),
  );
  assert.deepEqual(xhighMaxMapped.admittedLevels, ["xhigh"]);
});

test("malformed ranges are rejected as range errors, and their accessors are never invoked", () => {
  for (const bad of [
    null,
    undefined,
    [],
    ["off", "max"],
    { from: "off" },
    { from: "max", to: "off" },
    { from: "auto", to: "high" },
  ]) {
    assert.deepEqual(
      planBedrockNoControlRange(candidate(MAPPED), bad, RAW(ABSENT)),
      {
        kind: "invalid-input",
        code: "range",
      },
    );
  }
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "from", {
    enumerable: true,
    get() {
      reads += 1;
      return "off";
    },
  });
  accessor.to = "high";
  assert.deepEqual(
    planBedrockNoControlRange(candidate(MAPPED), accessor, RAW(ABSENT)),
    {
      kind: "invalid-input",
      code: "range",
    },
  );
  assert.equal(reads, 0);
});

test("malformed candidates are rejected without invoking accessors", () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "protocolModelID", {
    enumerable: true,
    get() {
      reads += 1;
      return MAPPED;
    },
  });
  accessor.packageName = PACKAGE;
  accessor.api = API;
  assert.deepEqual(planBedrockNoControlLevel(accessor, "off", RAW(ABSENT)), {
    kind: "invalid-input",
    code: "candidate",
  });
  assert.equal(reads, 0);
});

test("the request path is explicit and no path default exists", () => {
  for (const request of [
    undefined,
    null,
    {},
    { path: "auto", callerCap: ABSENT },
    { path: undefined, callerCap: ABSENT },
  ]) {
    assert.deepEqual(
      planBedrockNoControlLevel(candidate(MAPPED), "off", request),
      {
        kind: "invalid-input",
        code: "request",
      },
    );
  }
});

test("request accessors are rejected without invoking them", () => {
  let reads = 0;
  const pathAccessor = {};
  Object.defineProperty(pathAccessor, "path", {
    enumerable: true,
    get() {
      reads += 1;
      return "raw";
    },
  });
  pathAccessor.callerCap = ABSENT;
  assert.deepEqual(
    planBedrockNoControlLevel(candidate(MAPPED), "off", pathAccessor),
    {
      kind: "invalid-input",
      code: "request",
    },
  );
  assert.equal(reads, 0);
});

test("raw path reads no estimate, so an estimate accessor is never invoked", () => {
  let reads = 0;
  const request = { path: "raw", callerCap: ABSENT };
  Object.defineProperty(request, "estimate", {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error(SECRET);
    },
  });
  const plan = planBedrockNoControlLevel(candidate(GEMMA), "off", request);
  assert.equal(plan.kind, "planned");
  assert.deepEqual(plan.cap, {
    kind: "absent",
    path: "raw",
    basis: "source-path",
  });
  assert.equal(reads, 0);
});

test("a missing or malformed caller cap is invalid, while unknown stays unresolved", () => {
  assert.deepEqual(
    planBedrockNoControlLevel(candidate(MAPPED), "off", { path: "raw" }),
    {
      kind: "invalid-input",
      code: "caller-cap",
    },
  );
  for (const cap of [
    known(-1),
    known(Number.NaN),
    known(Number.POSITIVE_INFINITY),
    known("1000"),
    SECRET,
    1000,
  ]) {
    assert.deepEqual(
      planBedrockNoControlLevel(candidate(MAPPED), "off", RAW(cap)),
      {
        kind: "invalid-input",
        code: "caller-cap",
      },
    );
  }
  const unknownRaw = planBedrockNoControlLevel(
    candidate(MAPPED),
    "off",
    RAW(UNKNOWN),
  );
  assert.deepEqual(unknownRaw.cap, {
    kind: "unresolved",
    unresolved: "caller-cap",
  });
  const unknownSimple = planBedrockNoControlLevel(
    candidate(MAPPED),
    "off",
    SIMPLE(UNKNOWN, supplied(0)),
  );
  assert.deepEqual(unknownSimple.cap, {
    kind: "unresolved",
    unresolved: "caller-cap",
  });
});

test("an unknown or malformed estimate is unresolved or invalid, never zero", () => {
  const unknown = planBedrockNoControlLevel(
    candidate(GROK),
    "off",
    SIMPLE(ABSENT, UNKNOWN),
  );
  assert.deepEqual(unknown.cap, { kind: "unresolved", unresolved: "estimate" });
  for (const estimate of [
    supplied(-1),
    supplied(Number.NaN),
    supplied(Number.POSITIVE_INFINITY),
    supplied("0"),
    SECRET,
  ]) {
    assert.deepEqual(
      planBedrockNoControlLevel(
        candidate(GROK),
        "off",
        SIMPLE(ABSENT, estimate),
      ),
      {
        kind: "invalid-input",
        code: "estimate",
      },
    );
  }
});

test("raw keeps absence and never applies the simple clamp", () => {
  assert.deepEqual(
    planBedrockNoControlLevel(candidate(GEMMA), "off", RAW(ABSENT)).cap,
    {
      kind: "absent",
      path: "raw",
      basis: "source-path",
    },
  );
  assert.deepEqual(
    planBedrockNoControlLevel(candidate(GROK), "off", RAW(ABSENT)).cap.kind,
    "absent",
  );
  assert.equal(
    capValue(
      planBedrockNoControlLevel(candidate(GROK), "off", RAW(known(600000))),
    ),
    600000,
  );
  assert.equal(
    capValue(planBedrockNoControlLevel(candidate(GROK), "off", RAW(known(0)))),
    0,
  );
  assert.equal(
    capValue(
      planBedrockNoControlLevel(candidate(GROK), "off", RAW(known(1234.5))),
    ),
    1234.5,
  );
});

test("simple reproduces the source clamp for the named fixtures", () => {
  // Grok 4.6: maxTokens 500000 clamped to 495904 at zero estimate (window 500000 minus 4096).
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(GROK),
        "medium",
        SIMPLE(ABSENT, supplied(0)),
      ),
    ),
    495904,
  );
  // Qwen 3 32B: window 32768 with maxTokens 16384 clamps above estimate 12288.
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(QWEN),
        "off",
        SIMPLE(ABSENT, supplied(12288)),
      ),
    ),
    16384,
  );
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(QWEN),
        "off",
        SIMPLE(ABSENT, supplied(12289)),
      ),
    ),
    16383,
  );
  // GPT 5.5: window 272000 with maxTokens 128000 clamps above estimate 139904.
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(MAPPED),
        "off",
        SIMPLE(ABSENT, supplied(0)),
      ),
    ),
    128000,
  );
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(MAPPED),
        "off",
        SIMPLE(ABSENT, supplied(139904)),
      ),
    ),
    128000,
  );
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(MAPPED),
        "off",
        SIMPLE(ABSENT, supplied(139905)),
      ),
    ),
    127999,
  );
  // MiniMax M2.1: window 204800 with maxTokens 131072 clamps above estimate 69632.
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(MINIMAX),
        "off",
        SIMPLE(ABSENT, supplied(69632)),
      ),
    ),
    131072,
  );
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(MINIMAX),
        "off",
        SIMPLE(ABSENT, supplied(69633)),
      ),
    ),
    131071,
  );
  // Gemma 4 26B: simple absent gives the catalogue default; raw absent gives no cap at all.
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(GEMMA),
        "off",
        SIMPLE(ABSENT, supplied(0)),
      ),
    ),
    32768,
  );
});

test("a known caller cap may exceed the model maximum and is clamped only by the window", () => {
  assert.equal(
    capValue(
      planBedrockNoControlLevel(
        candidate(GEMMA),
        "off",
        SIMPLE(known(200000), supplied(0)),
      ),
    ),
    200000,
  );
  const frame = calculateBedrockNoControlCap({
    path: "simple",
    modelMaxTokens: 128000,
    contextWindow: 1050000,
    callerCap: known(500000),
    estimate: supplied(0),
  });
  assert.equal(frame.kind, "calculated");
  assert.equal(frame.value, 500000);
});

test("zero and negative windows ignore the estimate and use the max(1, cap) branch", () => {
  assert.equal(
    calculateBedrockNoControlCap({
      path: "simple",
      modelMaxTokens: 1000,
      contextWindow: 0,
      callerCap: ABSENT,
      estimate: supplied(-5),
    }).value,
    1000,
  );
  assert.equal(
    calculateBedrockNoControlCap({
      path: "simple",
      modelMaxTokens: 1000,
      contextWindow: -1,
      callerCap: known(0),
      estimate: UNKNOWN,
    }).value,
    1,
  );
  assert.equal(
    calculateBedrockNoControlCap({
      path: "simple",
      modelMaxTokens: 1000,
      contextWindow: 0,
      callerCap: known(0),
      estimate: supplied(0),
    }).value,
    1,
  );
  let estimateReads = 0;
  const frame = {
    path: "simple",
    modelMaxTokens: 1000,
    contextWindow: -1,
    callerCap: ABSENT,
  };
  Object.defineProperty(frame, "estimate", {
    enumerable: true,
    get() {
      estimateReads += 1;
      return supplied(0);
    },
  });
  assert.equal(calculateBedrockNoControlCap(frame).value, 1000);
  assert.equal(estimateReads, 0);
});

test("a positive window with a known zero cap stays zero", () => {
  assert.equal(
    calculateBedrockNoControlCap({
      path: "simple",
      modelMaxTokens: 1000,
      contextWindow: 10000,
      callerCap: known(0),
      estimate: supplied(0),
    }).value,
    0,
  );
});

test("a large estimate clamps to one token, except a zero caller cap which stays zero", () => {
  const large = (callerCap) =>
    calculateBedrockNoControlCap({
      path: "simple",
      modelMaxTokens: 1000,
      contextWindow: 10000,
      callerCap,
      estimate: supplied(10000),
    }).value;
  assert.equal(large(ABSENT), 1);
  assert.equal(large(known(0)), 0);
});

test("fractional estimates are used as supplied, not rounded", () => {
  const value = calculateBedrockNoControlCap({
    path: "simple",
    modelMaxTokens: 10000,
    contextWindow: 5000,
    callerCap: ABSENT,
    estimate: supplied(0.5),
  }).value;
  assert.equal(value, 903.5);
});

test("invalid numeric frame inputs fail locally with opaque codes", () => {
  const base = {
    path: "simple",
    modelMaxTokens: 1000,
    contextWindow: 10000,
    callerCap: ABSENT,
    estimate: supplied(0),
  };
  const code = (patch) => calculateBedrockNoControlCap({ ...base, ...patch });
  assert.deepEqual(code({ modelMaxTokens: 0 }), {
    kind: "invalid-input",
    code: "model-max",
  });
  assert.deepEqual(code({ modelMaxTokens: Number.POSITIVE_INFINITY }), {
    kind: "invalid-input",
    code: "model-max",
  });
  assert.deepEqual(code({ contextWindow: Number.NaN }), {
    kind: "invalid-input",
    code: "context-window",
  });
  assert.deepEqual(code({ estimate: supplied(-0.5) }), {
    kind: "invalid-input",
    code: "estimate",
  });
  assert.deepEqual(code({ estimate: supplied(Number.NaN) }), {
    kind: "invalid-input",
    code: "estimate",
  });
  assert.deepEqual(code({ estimate: supplied(Number.POSITIVE_INFINITY) }), {
    kind: "invalid-input",
    code: "estimate",
  });
  assert.deepEqual(code({ callerCap: known(-1) }), {
    kind: "invalid-input",
    code: "caller-cap",
  });
  assert.deepEqual(code({ callerCap: undefined }), {
    kind: "invalid-input",
    code: "caller-cap",
  });
  assert.deepEqual(calculateBedrockNoControlCap(null), {
    kind: "invalid-input",
    code: "request",
  });
});

test("the calculator agrees numerically with calculateOffCap for valid simple frames, not its off label", () => {
  const frames = [
    {
      modelMaxTokens: 128000,
      contextWindow: 272000,
      estimate: supplied(0),
      callerCap: ABSENT,
    },
    {
      modelMaxTokens: 128000,
      contextWindow: 272000,
      estimate: supplied(139905),
      callerCap: ABSENT,
    },
    {
      modelMaxTokens: 500000,
      contextWindow: 500000,
      estimate: supplied(0),
      callerCap: ABSENT,
    },
    {
      modelMaxTokens: 16384,
      contextWindow: 32768,
      estimate: supplied(12289),
      callerCap: ABSENT,
    },
    {
      modelMaxTokens: 1000,
      contextWindow: 0,
      estimate: supplied(5),
      callerCap: ABSENT,
    },
    {
      modelMaxTokens: 1000,
      contextWindow: 10000,
      estimate: supplied(0.5),
      callerCap: known(0),
    },
    {
      modelMaxTokens: 1000,
      contextWindow: 10000,
      estimate: supplied(10000),
      callerCap: known(4000),
    },
    {
      modelMaxTokens: 10000,
      contextWindow: 5000,
      estimate: supplied(0),
      callerCap: known(1234.5),
    },
  ];
  for (const frame of frames) {
    const ours = calculateBedrockNoControlCap({ path: "simple", ...frame });
    const offCap = calculateOffCap(frame);
    assert.equal(offCap.kind, "calculated");
    assert.equal(ours.value, offCap.stages.M, JSON.stringify(frame));
    assert.ok(!ours.source.includes("off"));
  }
});

test("the cap is independent of the logical level for the same request", () => {
  const request = SIMPLE(ABSENT, supplied(5000));
  for (const row of [UNMAPPED, MAPPED]) {
    const caps = NO_CONTROL_CATALOGUE.find(
      (entry) => entry.protocolModelID === row,
    ).supportedLevels.map(
      (level) => planBedrockNoControlLevel(candidate(row), level, request).cap,
    );
    for (const cap of caps) {
      assert.deepEqual(cap, caps[0]);
    }
  }
});

test("planned results are frozen and carry no proof, native or role claim", () => {
  const plan = planBedrockNoControlLevel(
    candidate(MAPPED),
    "high",
    SIMPLE(ABSENT, supplied(0)),
  );
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.admittedLevels));
  assert.ok(Object.isFrozen(plan.cap));
  assert.notEqual(plan.kind, "proven");
  assert.ok(!JSON.stringify(plan).includes('"proven"'));
});

test("path validation precedes admission, while unsupported levels and ranges skip cap reads", () => {
  const row = candidate(UNMAPPED);
  assert.deepEqual(planBedrockNoControlLevel(row, "max", {}), {
    kind: "invalid-input",
    code: "request",
  });
  assert.deepEqual(
    planBedrockNoControlLevel(row, "max", SIMPLE(known(-1), { kind: "bogus" })),
    { kind: "unsupported-in-snapshot", scope: "level" },
  );
  let reads = 0;
  const request = {
    path: "simple",
    get callerCap() {
      reads += 1;
      throw new Error(SECRET);
    },
    get estimate() {
      reads += 1;
      throw new Error(SECRET);
    },
  };
  assert.deepEqual(planBedrockNoControlLevel(row, "max", request), {
    kind: "unsupported-in-snapshot",
    scope: "level",
  });
  assert.deepEqual(
    planBedrockNoControlRange(row, { from: "xhigh", to: "max" }, request),
    { kind: "unsupported-in-snapshot", scope: "range" },
  );
  assert.equal(reads, 0);
});

test("invalid and insufficient results never echo caller-supplied values", () => {
  const results = [
    planBedrockNoControlLevel(candidate(SECRET), "off", RAW(ABSENT)),
    planBedrockNoControlLevel(candidate(MAPPED), SECRET, RAW(ABSENT)),
    planBedrockNoControlLevel(candidate(MAPPED), "off", {
      path: SECRET,
      callerCap: ABSENT,
    }),
    planBedrockNoControlLevel(candidate(MAPPED), "off", RAW(known(SECRET))),
    calculateBedrockNoControlCap({
      path: "simple",
      modelMaxTokens: 1000,
      contextWindow: 10000,
      callerCap: ABSENT,
      estimate: supplied(SECRET),
    }),
  ];
  for (const result of results) {
    assert.ok(!JSON.stringify(result).includes(SECRET));
  }
});
