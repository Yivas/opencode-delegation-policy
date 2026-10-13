import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AZURE_API,
  AZURE_CANONICAL_LEVELS,
  AZURE_CAP_FLOOR,
  AZURE_CAP_SOURCE,
  AZURE_CAP_TARGET_STAGE,
  AZURE_CATALOGUE,
  AZURE_CONDITIONS,
  AZURE_PROVIDER,
  AZURE_SDK_CLAMP_EVIDENCE,
  AZURE_SOURCE_HASHES,
  AZURE_SOURCE_SCOPE,
  planAzureLevel,
  planAzureRange,
} from "../dist/thinking/azure.js";

// Fixtures: the 29 reasoning records of providers/data/azure-openai-responses.json (group "azure-openai-responses") of
// Pi AI 0.87.1, copied as data. The fourth field is the record's thinkingLevelMap; undefined means the key is absent.
// Expectations below are derived from the archive text of models.js getSupportedThinkingLevels (l. 553-565),
// api/azure-openai-responses.js streamSimple (l. 122-137) and buildParams (l. 223-254), and from simple-options.js
// (l. 4-17). They do not call the module under test. No SDK, host, environment or network is used.
const FIXTURES = [
  ["gpt-5", 128000, 400000, { off: null }],
  ["gpt-5-mini", 128000, 400000, { off: null }],
  ["gpt-5-nano", 128000, 400000, { off: null }],
  ["gpt-5-pro", 128000, 400000, { off: null }],
  ["gpt-5.1", 128000, 400000, { off: null }],
  ["gpt-5.2", 128000, 400000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.2-chat-latest", 16384, 128000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.2-pro", 128000, 400000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.3-codex", 128000, 400000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.3-codex-spark", 32000, 128000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.4", 128000, 1050000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.4-mini", 128000, 400000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.4-nano", 128000, 400000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.4-pro", 128000, 1050000, { off: null, xhigh: "xhigh" }],
  ["gpt-5.5", 128000, 1050000, { off: null, xhigh: "xhigh" }],
  [
    "gpt-5.5-pro",
    128000,
    1050000,
    { off: null, xhigh: "xhigh", minimal: null, low: null },
  ],
  ["gpt-5.6-luna", 128000, 1050000, { off: null, xhigh: "xhigh", max: "max" }],
  ["gpt-5.6-sol", 128000, 1050000, { off: null, xhigh: "xhigh", max: "max" }],
  ["gpt-5.6-terra", 128000, 1050000, { off: null, xhigh: "xhigh", max: "max" }],
  [
    "gpt-6-astra",
    128000,
    272000,
    {
      off: null,
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  ],
  [
    "gpt-6-luna",
    128000,
    272000,
    {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  ],
  [
    "gpt-6-sol",
    128000,
    272000,
    {
      off: "none",
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
  ],
  ["gpt-realtime-2.1", 32000, 128000, undefined],
  ["o1", 100000, 200000, undefined],
  ["o1-pro", 100000, 200000, undefined],
  ["o3", 100000, 200000, undefined],
  ["o3-mini", 100000, 200000, undefined],
  ["o3-pro", 100000, 200000, undefined],
  ["o4-mini", 100000, 200000, undefined],
];

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const REF = "reasoning.encrypted_content";
const SECRET = "synthetic-secret-marker-az4k";
const PROVIDER = "azure-openai-responses";
const API = "azure-openai-responses";
const ABSENT = { kind: "absent" };
const UNKNOWN = { kind: "unknown" };
const known = (value) => ({ kind: "known", value });
const supplied = (tokens) => ({ kind: "supplied", tokens });
const request = (callerCap, estimate) => ({ callerCap, estimate });
const identity = (name, overrides = {}) => ({
  provider: PROVIDER,
  api: API,
  protocolModelID: name,
  ...overrides,
});
const mapOf = (fixture) => fixture[3] ?? {};
// A genuine hole at index 0, built at runtime so the literal stays free of empty slots.
const sparseHighArray = () => {
  const holey = new Array(2);
  holey[1] = "high";
  return holey;
};

// Expectations are re-derived here from the archive rules, not taken from the module.
function expectedAdmitted(map, level) {
  const mapped = map[level];
  if (mapped === null) return false;
  if (level === "xhigh" || level === "max") return mapped !== undefined;
  return true;
}
function expectedAdvertised(map) {
  return LEVELS.filter((level) => expectedAdmitted(map, level));
}
function expectedRecipe(map, level) {
  if (level === "off") return { reasoning: { effort: map.off ?? "none" } };
  return {
    reasoning: { effort: map[level] ?? level, summary: "auto" },
    include: [REF],
  };
}
function expectedCap(fixture, callerValue, estimateTokens) {
  const requested = callerValue ?? fixture[1];
  const room = fixture[2] - estimateTokens - 4096;
  const simpleMaxTokens = Math.min(requested, Math.max(1, room));
  return {
    simpleMaxTokens,
    maxOutputTokensTarget: Math.max(simpleMaxTokens, 16),
  };
}
const keyOf = (recipe) => JSON.stringify(recipe);

const planned = (plan) => {
  assert.equal(plan.kind, "planned", JSON.stringify(plan));
  return plan;
};

test("catalogue holds the 29 archive rows with exact identity, limits and maps", () => {
  assert.equal(AZURE_CATALOGUE.length, 29);
  FIXTURES.forEach((fixture, index) => {
    const row = AZURE_CATALOGUE[index];
    assert.equal(row.protocolModelID, fixture[0]);
    assert.equal(row.provider, PROVIDER);
    assert.equal(row.api, API);
    assert.equal(row.modelMaxTokens, fixture[1], fixture[0]);
    assert.equal(row.contextWindow, fixture[2], fixture[0]);
    assert.deepEqual({ ...row.thinkingLevelMap }, mapOf(fixture), fixture[0]);
    assert.deepEqual(
      [...row.supportedLevels],
      expectedAdvertised(mapOf(fixture)),
      fixture[0],
    );
  });
});

test("admitted-size shape counts match the archive: 4 for 5 rows, 3 for 1, 5 for 18, 6 for 5", () => {
  const sizes = new Map();
  for (const row of AZURE_CATALOGUE) {
    sizes.set(
      row.supportedLevels.length,
      (sizes.get(row.supportedLevels.length) ?? 0) + 1,
    );
  }
  assert.deepEqual(
    [...sizes.entries()].sort((a, b) => a[0] - b[0]),
    [
      [3, 1],
      [4, 5],
      [5, 18],
      [6, 5],
    ],
  );
  assert.equal(
    AZURE_CATALOGUE.filter((row) => row.supportedLevels.includes("off")).length,
    9,
  );
});

test("catalogue rows, maps and advertised sets are deeply frozen", () => {
  assert.ok(Object.isFrozen(AZURE_CATALOGUE));
  for (const row of AZURE_CATALOGUE) {
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.thinkingLevelMap));
    assert.ok(Object.isFrozen(row.supportedLevels));
  }
  assert.throws(() => AZURE_CATALOGUE.push({}), TypeError);
  assert.throws(() => {
    AZURE_CATALOGUE[0].modelMaxTokens = 1;
  }, TypeError);
  assert.throws(() => {
    AZURE_CATALOGUE[0].thinkingLevelMap.max = "max";
  }, TypeError);
  assert.throws(
    () => AZURE_CATALOGUE[0].supportedLevels.push("max"),
    TypeError,
  );
  assert.throws(() => AZURE_CANONICAL_LEVELS.push("auto"), TypeError);
});

test("source metadata names the exact archive files and their hashes", () => {
  assert.deepEqual(
    { ...AZURE_SOURCE_HASHES },
    {
      "api/azure-openai-responses.js":
        "2cce830528a0d063cd76e9f234632637ed9782e12c687d3c5bc79f10483a7ff2",
      "providers/data/azure-openai-responses.json":
        "c351c6af1882660ffa8a8598594b86671b45817106e45ac920535aaeac59fc96",
      "api/simple-options.js":
        "1caf860e028e22639578aba3ec8b79e5be9650c27bd3f19471c78502976555f3",
      "models.js":
        "75fa33149fb608bc4a7b7a0586c8ca8f0024465d580091b0c426c0baf3fbc80a",
    },
  );
  assert.ok(Object.isFrozen(AZURE_SOURCE_HASHES));
  assert.match(
    AZURE_SOURCE_SCOPE,
    /api\/azure-openai-responses\.js streamSimple/,
  );
  assert.equal(AZURE_CAP_FLOOR, 16);
  assert.equal(AZURE_CAP_TARGET_STAGE, "before-sampling-params-and-on-payload");
});

test("lookup needs the exact provider, API and id; aliases, mismatches and prototype keys are rejected", () => {
  for (const name of [
    "gpt-5 ",
    "GPT-5",
    "gpt-5-turbo",
    "gpt-5.5-",
    "gpt-realtime",
    "o1-mini",
    "__proto__",
    "constructor",
  ]) {
    assert.deepEqual(
      planAzureLevel(identity(name), "minimal", request(ABSENT, supplied(0))),
      {
        kind: "insufficient",
        reason: "model",
      },
      name,
    );
  }
  assert.deepEqual(
    planAzureLevel(
      identity("gpt-5.5", { provider: "openai-codex" }),
      "minimal",
      request(ABSENT, supplied(0)),
    ),
    { kind: "insufficient", reason: "provider" },
  );
  assert.deepEqual(
    planAzureLevel(
      identity("gpt-5.5", { api: "openai-responses" }),
      "minimal",
      request(ABSENT, supplied(0)),
    ),
    { kind: "insufficient", reason: "api" },
  );
  assert.deepEqual(
    planAzureRange(
      identity("gpt-5.5", { api: "openai-completions" }),
      { from: "off", to: "high" },
      request(ABSENT, supplied(0)),
    ),
    { kind: "insufficient", reason: "api" },
  );
});

test("identity is read from own data properties only; inherited, accessor, revoked and trapping inputs are rejected quietly", () => {
  assert.deepEqual(
    planAzureLevel(
      Object.create(identity("gpt-5")),
      "minimal",
      request(ABSENT, supplied(0)),
    ),
    {
      kind: "invalid-input",
      code: "candidate",
    },
  );
  assert.deepEqual(
    planAzureLevel(null, "minimal", request(ABSENT, supplied(0))),
    {
      kind: "invalid-input",
      code: "candidate",
    },
  );

  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "protocolModelID", {
    enumerable: true,
    get() {
      reads += 1;
      return "gpt-5";
    },
  });
  accessor.provider = PROVIDER;
  accessor.api = API;
  assert.deepEqual(
    planAzureLevel(accessor, "minimal", request(ABSENT, supplied(0))),
    {
      kind: "invalid-input",
      code: "candidate",
    },
  );
  assert.equal(reads, 0);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(
    planAzureLevel(revoked.proxy, "minimal", request(ABSENT, supplied(0))),
    {
      kind: "invalid-input",
      code: "candidate",
    },
  );

  const trapping = new Proxy(identity("gpt-5"), {
    getOwnPropertyDescriptor() {
      throw new Error(SECRET);
    },
  });
  const result = planAzureLevel(
    trapping,
    "minimal",
    request(ABSENT, supplied(0)),
  );
  assert.deepEqual(result, { kind: "invalid-input", code: "candidate" });
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("all 203 canonical cases: 143 admitted with one singleton recipe each, 60 rejected as unsupported", () => {
  let admitted = 0;
  let rejected = 0;
  let offAdmitted = 0;
  for (const fixture of FIXTURES) {
    const map = mapOf(fixture);
    for (const level of LEVELS) {
      const plan = planAzureLevel(
        identity(fixture[0]),
        level,
        request(ABSENT, supplied(0)),
      );
      if (expectedAdmitted(map, level)) {
        admitted += 1;
        const result = planned(plan);
        assert.equal(result.scope, "level");
        assert.equal(result.candidates.length, 1, `${fixture[0]} ${level}`);
        const candidate = result.candidates[0];
        assert.deepEqual(
          candidate.recipe,
          expectedRecipe(map, level),
          `${fixture[0]} ${level}`,
        );
        const twins = LEVELS.filter(
          (other) =>
            expectedAdmitted(map, other) &&
            keyOf(expectedRecipe(map, other)) ===
              keyOf(expectedRecipe(map, level)),
        );
        assert.deepEqual(
          [...candidate.compatibleLevels],
          twins,
          `${fixture[0]} ${level}`,
        );
        assert.deepEqual(
          [...candidate.admittedLevels],
          [level],
          `${fixture[0]} ${level}`,
        );
        assert.equal(twins.length, 1, `${fixture[0]} ${level} singleton`);
        if (level === "off") {
          offAdmitted += 1;
          assert.deepEqual(
            candidate.recipe,
            { reasoning: { effort: "none" } },
            fixture[0],
          );
          assert.equal("include" in candidate.recipe, false, fixture[0]);
          assert.equal(
            "summary" in candidate.recipe.reasoning,
            false,
            fixture[0],
          );
        }
      } else {
        rejected += 1;
        assert.deepEqual(
          plan,
          {
            kind: "unsupported-in-snapshot",
            scope: "level",
            level,
            sourceEvidence: AZURE_SDK_CLAMP_EVIDENCE,
            source: AZURE_SOURCE_SCOPE,
            conditions: AZURE_CONDITIONS,
          },
          `${fixture[0]} ${level}`,
        );
        assert.equal(
          "cap" in plan,
          false,
          `${fixture[0]} ${level} must not read cap state`,
        );
      }
    }
  }
  assert.equal(admitted, 143);
  assert.equal(rejected, 60);
  assert.equal(offAdmitted, 9);
});

test("every admitted fixed case carries the cap arithmetic for an absent caller cap and zero estimate", () => {
  for (const fixture of FIXTURES) {
    for (const level of LEVELS) {
      if (!expectedAdmitted(mapOf(fixture), level)) continue;
      const result = planned(
        planAzureLevel(
          identity(fixture[0]),
          level,
          request(ABSENT, supplied(0)),
        ),
      );
      assert.equal(result.cap.kind, "resolved", fixture[0]);
      const want = expectedCap(fixture, undefined, 0);
      assert.equal(
        result.cap.simpleMaxTokens,
        want.simpleMaxTokens,
        fixture[0],
      );
      assert.equal(
        result.cap.maxOutputTokensTarget,
        want.maxOutputTokensTarget,
        fixture[0],
      );
    }
  }
});

test("unsupported fixed levels read no request state, so hostile request objects never surface", () => {
  let reads = 0;
  const hostile = {};
  Object.defineProperty(hostile, "callerCap", {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error(SECRET);
    },
  });
  Object.defineProperty(hostile, "estimate", {
    enumerable: true,
    get() {
      reads += 1;
      throw new Error(SECRET);
    },
  });
  assert.equal(
    planAzureLevel(identity("gpt-5"), "off", hostile).kind,
    "unsupported-in-snapshot",
  );
  assert.equal(
    planAzureLevel(identity("gpt-5"), "xhigh", hostile).kind,
    "unsupported-in-snapshot",
  );
  assert.equal(
    planAzureLevel(identity("gpt-6-astra"), "minimal", hostile).kind,
    "unsupported-in-snapshot",
  );
  assert.equal(reads, 0);
});

test("level validation runs before admission: unknown or non-canonical strings are invalid, never clamped", () => {
  for (const level of [
    "none",
    "auto",
    "OFF",
    "High",
    "",
    undefined,
    null,
    1,
    true,
    SECRET,
  ]) {
    const result = planAzureLevel(
      identity("gpt-5.5"),
      level,
      request(ABSENT, supplied(0)),
    );
    assert.deepEqual(result, { kind: "invalid-input", code: "level" });
    assert.ok(!JSON.stringify(result).includes(SECRET));
  }
});

test("the 812 inclusive range intervals preserve every supported candidate and select nothing", () => {
  let intervals = 0;
  for (const fixture of FIXTURES) {
    const map = mapOf(fixture);
    for (let low = 0; low < LEVELS.length; low += 1) {
      for (let high = low; high < LEVELS.length; high += 1) {
        intervals += 1;
        const span = LEVELS.slice(low, high + 1);
        const admitted = span.filter((level) => expectedAdmitted(map, level));
        const range = { from: LEVELS[low], to: LEVELS[high] };
        const label = `${fixture[0]} ${range.from}..${range.to}`;
        const result = planAzureRange(
          identity(fixture[0]),
          range,
          request(ABSENT, supplied(0)),
        );
        if (admitted.length === 0) {
          assert.deepEqual(
            result,
            {
              kind: "unsupported-in-snapshot",
              scope: "range",
              source: AZURE_SOURCE_SCOPE,
              conditions: AZURE_CONDITIONS,
            },
            label,
          );
          continue;
        }
        const plan = planned(result);
        assert.equal(plan.scope, "range");
        assert.deepEqual([...plan.admittedLevels], admitted, label);
        const groups = new Map();
        for (const level of admitted) {
          const key = keyOf(expectedRecipe(map, level));
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(level);
        }
        const expectedCandidates = [...groups.entries()].map(
          ([key, members]) => ({
            recipe: JSON.parse(key),
            compatibleLevels: LEVELS.filter(
              (other) =>
                expectedAdmitted(map, other) &&
                keyOf(expectedRecipe(map, other)) === key,
            ),
            admittedLevels: members,
          }),
        );
        assert.deepEqual(
          plan.candidates.map((candidate) => ({
            recipe: candidate.recipe,
            compatibleLevels: [...candidate.compatibleLevels],
            admittedLevels: [...candidate.admittedLevels],
          })),
          expectedCandidates,
          label,
        );
      }
    }
  }
  assert.equal(intervals, 812);
});

test("range edges: the full span on gpt-5 excludes unadvertised levels, and gpt-6-luna off..max keeps six classes", () => {
  const gpt5 = planned(
    planAzureRange(
      identity("gpt-5"),
      { from: "off", to: "max" },
      request(ABSENT, supplied(0)),
    ),
  );
  assert.deepEqual(
    [...gpt5.admittedLevels],
    ["minimal", "low", "medium", "high"],
  );
  assert.deepEqual([...gpt5.excludedLevels], ["off", "xhigh", "max"]);
  assert.equal(gpt5.candidates.length, 4);

  const luna = planned(
    planAzureRange(
      identity("gpt-6-luna"),
      { from: "off", to: "max" },
      request(ABSENT, supplied(0)),
    ),
  );
  assert.equal(luna.candidates.length, 6);
  assert.deepEqual(luna.candidates[0].recipe, {
    reasoning: { effort: "none" },
  });
  assert.deepEqual([...luna.excludedLevels], ["minimal"]);

  const pro = planned(
    planAzureRange(
      identity("gpt-5.5-pro"),
      { from: "xhigh", to: "max" },
      request(ABSENT, supplied(0)),
    ),
  );
  assert.deepEqual([...pro.admittedLevels], ["xhigh"]);
  assert.deepEqual([...pro.excludedLevels], ["max"]);
});

test("off..low on gpt-6-sol returns the off class and the low class, each with its own recipe", () => {
  const plan = planned(
    planAzureRange(
      identity("gpt-6-sol"),
      { from: "off", to: "low" },
      request(ABSENT, supplied(0)),
    ),
  );
  assert.deepEqual([...plan.admittedLevels], ["off", "low"]);
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.recipe),
    [
      { reasoning: { effort: "none" } },
      { reasoning: { effort: "low", summary: "auto" }, include: [REF] },
    ],
  );
});

test("invalid ranges are rejected with the range code, and their accessors are never invoked", () => {
  const bad = [
    { from: "high", to: "low" },
    { from: "off" },
    { to: "high" },
    { from: "none", to: "high" },
    { from: "off", to: "auto" },
    [],
    ["off", "high"],
    sparseHighArray(),
    null,
    undefined,
    "off..high",
  ];
  for (const range of bad) {
    assert.deepEqual(
      planAzureRange(identity("gpt-5.5"), range, request(ABSENT, supplied(0))),
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
    planAzureRange(identity("gpt-5.5"), accessor, request(ABSENT, supplied(0))),
    {
      kind: "invalid-input",
      code: "range",
    },
  );
  assert.equal(reads, 0);

  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  assert.deepEqual(
    planAzureRange(
      identity("gpt-5.5"),
      revoked.proxy,
      request(ABSENT, supplied(0)),
    ),
    {
      kind: "invalid-input",
      code: "range",
    },
  );
});

test("caller cap absent, known and above the catalogue maximum are numeric states, not clipped", () => {
  const absent = planned(
    planAzureLevel(identity("gpt-5"), "minimal", request(ABSENT, supplied(0))),
  );
  assert.equal(absent.cap.simpleMaxTokens, 128000);
  assert.equal(absent.cap.maxOutputTokensTarget, 128000);

  const above = planned(
    planAzureLevel(
      identity("gpt-5"),
      "minimal",
      request(known(200000), supplied(0)),
    ),
  );
  assert.deepEqual(above.cap.callerCap, { kind: "known", value: 200000 });
  assert.equal(
    above.cap.simpleMaxTokens,
    200000,
    "a supplied cap above the catalogue maximum is not clipped",
  );
  assert.equal(above.cap.maxOutputTokensTarget, 200000);

  const fraction = planned(
    planAzureLevel(
      identity("gpt-5"),
      "minimal",
      request(known(0.5), supplied(0)),
    ),
  );
  assert.equal(fraction.cap.simpleMaxTokens, 0.5);
  assert.equal(fraction.cap.maxOutputTokensTarget, 16);
});

test("the target floor keeps M distinct: M of 1, 15 and 16 raise to 16, and M of 17 stays 17", () => {
  const cases = [
    [1, 1, 16],
    [15, 15, 16],
    [16, 16, 16],
    [17, 17, 17],
  ];
  for (const [caller, simple, target] of cases) {
    const result = planned(
      planAzureLevel(
        identity("gpt-5"),
        "minimal",
        request(known(caller), supplied(0)),
      ),
    );
    assert.equal(result.cap.simpleMaxTokens, simple, `caller ${caller}`);
    assert.equal(result.cap.maxOutputTokensTarget, target, `caller ${caller}`);
    assert.deepEqual(result.cap.callerCap, { kind: "known", value: caller });
  }
});

test("the window boundary and an exhausted room give the expected M and T", () => {
  // gpt-5: window 400000. room = 400000 - E - 4096. At E = 267904 the room is exactly 128000; at E = 267905 it is 127999.
  assert.equal(
    planned(
      planAzureLevel(
        identity("gpt-5"),
        "minimal",
        request(ABSENT, supplied(267904)),
      ),
    ).cap.simpleMaxTokens,
    128000,
  );
  assert.equal(
    planned(
      planAzureLevel(
        identity("gpt-5"),
        "minimal",
        request(ABSENT, supplied(267905)),
      ),
    ).cap.simpleMaxTokens,
    127999,
  );
  // A room of zero or less clamps M to one token, and the target then raises it to 16.
  const exhausted = planned(
    planAzureLevel(
      identity("gpt-5"),
      "minimal",
      request(ABSENT, supplied(395904)),
    ),
  );
  assert.equal(exhausted.cap.simpleMaxTokens, 1);
  assert.equal(exhausted.cap.maxOutputTokensTarget, 16);
  const over = planned(
    planAzureLevel(
      identity("gpt-5"),
      "minimal",
      request(ABSENT, supplied(900000)),
    ),
  );
  assert.equal(over.cap.simpleMaxTokens, 1);
  assert.equal(over.cap.maxOutputTokensTarget, 16);
});

test("unknown caller cap or estimate is unresolved, the recipe stays known, and nothing defaults to zero", () => {
  const callerUnknown = planned(
    planAzureLevel(identity("gpt-5.5"), "high", request(UNKNOWN, supplied(0))),
  );
  assert.deepEqual(callerUnknown.cap, {
    kind: "unresolved",
    unresolved: "caller-cap",
    source: AZURE_CAP_SOURCE,
  });
  assert.deepEqual(callerUnknown.candidates[0].recipe, {
    reasoning: { effort: "high", summary: "auto" },
    include: [REF],
  });

  const estimateUnknown = planned(
    planAzureLevel(identity("gpt-5.5"), "high", request(known(1000), UNKNOWN)),
  );
  assert.deepEqual(estimateUnknown.cap, {
    kind: "unresolved",
    unresolved: "estimate",
    source: AZURE_CAP_SOURCE,
  });

  const bothUnknown = planned(
    planAzureLevel(identity("gpt-5.5"), "high", request(UNKNOWN, UNKNOWN)),
  );
  assert.equal(bothUnknown.cap.unresolved, "caller-cap");
});

test("local cap preconditions exclude zero; malformed states fail with fixed codes and no value echo", () => {
  const row = identity("gpt-5");
  assert.deepEqual(planAzureLevel(row, "minimal", undefined), {
    kind: "invalid-input",
    code: "request",
  });
  assert.deepEqual(planAzureLevel(row, "minimal", null), {
    kind: "invalid-input",
    code: "request",
  });
  assert.deepEqual(planAzureLevel(row, "minimal", { estimate: supplied(0) }), {
    kind: "invalid-input",
    code: "caller-cap",
  });
  assert.deepEqual(planAzureLevel(row, "minimal", { callerCap: ABSENT }), {
    kind: "invalid-input",
    code: "estimate",
  });
  for (const cap of [
    known(0),
    known(-1),
    known(Number.NaN),
    known(Number.POSITIVE_INFINITY),
    known("1000"),
    known(SECRET),
    1000,
    SECRET,
  ]) {
    assert.deepEqual(
      planAzureLevel(row, "minimal", request(cap, supplied(0))),
      { kind: "invalid-input", code: "caller-cap" },
    );
  }
  for (const estimate of [
    supplied(-1),
    supplied(Number.NaN),
    supplied(Number.POSITIVE_INFINITY),
    supplied("0"),
    SECRET,
    undefined,
  ]) {
    assert.deepEqual(
      planAzureLevel(row, "minimal", request(ABSENT, estimate)),
      { kind: "invalid-input", code: "estimate" },
    );
  }
  const echoed = planAzureLevel(
    row,
    "minimal",
    request(known(SECRET), supplied(0)),
  );
  assert.ok(!JSON.stringify(echoed).includes(SECRET));
});

test("request accessors are not invoked; revoked and throwing-descriptor proxies fail quietly", () => {
  let reads = 0;
  const accessorRequest = {};
  Object.defineProperty(accessorRequest, "callerCap", {
    enumerable: true,
    get() {
      reads += 1;
      return ABSENT;
    },
  });
  accessorRequest.estimate = supplied(0);
  assert.deepEqual(
    planAzureLevel(identity("gpt-5"), "minimal", accessorRequest),
    { kind: "invalid-input", code: "caller-cap" },
  );
  assert.equal(reads, 0);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(
    planAzureLevel(identity("gpt-5"), "minimal", revoked.proxy),
    { kind: "invalid-input", code: "request" },
  );

  const trapping = new Proxy(request(ABSENT, supplied(0)), {
    getOwnPropertyDescriptor() {
      throw new Error(SECRET);
    },
  });
  // The trap fails the first own-field read, so the failure is reported as the caller-cap field, opaquely.
  const result = planAzureLevel(identity("gpt-5"), "minimal", trapping);
  assert.deepEqual(result, { kind: "invalid-input", code: "caller-cap" });
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("every planned and unsupported result carries the source conditions and no acceptance claim", () => {
  const results = [
    planAzureLevel(
      identity("gpt-5.5"),
      "minimal",
      request(ABSENT, supplied(0)),
    ),
    planAzureLevel(identity("gpt-5"), "off", request(ABSENT, supplied(0))),
    planAzureRange(
      identity("gpt-6-sol"),
      { from: "off", to: "max" },
      request(ABSENT, supplied(0)),
    ),
  ];
  for (const result of results) {
    assert.deepEqual(result.conditions, AZURE_CONDITIONS);
    assert.equal(result.source, AZURE_SOURCE_SCOPE);
  }
  for (const condition of [
    "pi-api-key-truthy-prerequisite",
    "azure-client-and-deployment-resolution-unobserved",
    "simple-forwards-no-azure-overrides",
    "context-estimate-caller-supplied",
    "sampling-params-overlay-after-builder",
    "on-payload-whole-params-replacement",
    "retry-reuses-built-params",
    "native-correspondence-unknown",
    "provider-acceptance-unknown",
    "auth-runtime-unexecuted",
    "source-recipe-not-final-wire",
  ]) {
    assert.ok(AZURE_CONDITIONS.includes(condition), condition);
  }
});

test("results are deeply frozen and no caller input is modified", () => {
  const callerCap = Object.freeze(known(1000));
  const estimate = Object.freeze(supplied(0));
  const req = Object.freeze({ callerCap, estimate });
  const range = Object.freeze({ from: "off", to: "high" });
  const candidate = Object.freeze(identity("gpt-6-luna"));
  const plan = planned(planAzureRange(candidate, range, req));
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.admittedLevels));
  assert.ok(Object.isFrozen(plan.candidates));
  assert.ok(Object.isFrozen(plan.candidates[0].recipe));
  assert.ok(Object.isFrozen(plan.candidates[0].recipe.reasoning));
  assert.ok(Object.isFrozen(plan.cap));
  assert.throws(() => {
    plan.candidates[0].recipe.reasoning.effort = "high";
  }, TypeError);
  assert.deepEqual(candidate, identity("gpt-6-luna"));
  assert.deepEqual(req, { callerCap: known(1000), estimate: supplied(0) });
  assert.deepEqual(range, { from: "off", to: "high" });
});

test("the module exposes only the Simple source planner surface", async () => {
  const exported = Object.keys(
    await import("../dist/thinking/azure.js"),
  ).sort();
  assert.deepEqual(exported, [
    "AZURE_API",
    "AZURE_CANONICAL_LEVELS",
    "AZURE_CAP_FLOOR",
    "AZURE_CAP_SOURCE",
    "AZURE_CAP_TARGET_STAGE",
    "AZURE_CATALOGUE",
    "AZURE_CONDITIONS",
    "AZURE_PROVIDER",
    "AZURE_SDK_CLAMP_EVIDENCE",
    "AZURE_SOURCE_HASHES",
    "AZURE_SOURCE_SCOPE",
    "planAzureLevel",
    "planAzureRange",
  ]);
  assert.equal(AZURE_API, API);
  assert.equal(AZURE_PROVIDER, PROVIDER);
});
