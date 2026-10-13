import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CODEX_API,
  CODEX_CANONICAL_LEVELS,
  CODEX_CAP_OMISSION,
  CODEX_CATALOGUE,
  CODEX_CONDITIONS,
  CODEX_PROVIDER,
  CODEX_SDK_CLAMP_EVIDENCE,
  CODEX_SOURCE_HASHES,
  CODEX_SOURCE_SCOPE,
  planCodexLevel,
  planCodexRange,
} from "../dist/thinking/codex.js";

// Expected rows are the eight openai-codex-responses records of the Pi AI 0.87.1 catalogue (providers/data/openai-codex.json,
// read as data). Maps are copied in JSON order; advertised sets follow models.js getSupportedThinkingLevels. The module
// under test does not compute them here. No SDK, host, environment or network is used.

const SECRET = "synthetic-secret-marker-c3x9";
const REFERENCE = "reasoning.encrypted_content";

const SIX = ["off", "minimal", "low", "medium", "high", "xhigh"];
const SEVEN = [...SIX, "max"];
const ASTRA_ADVERTISED = ["minimal", "low", "medium", "high", "xhigh", "max"];

const MAP_SPARK = { xhigh: "xhigh", minimal: "low" };
const MAP_LUNA_TERRA = { xhigh: "xhigh", max: "max", minimal: "low" };
const MAP_ASTRA = {
  off: null,
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};
const MAP_GPT6 = {
  off: "none",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

// [protocolModelID, thinkingLevelMap, advertised levels, maxTokens, contextWindow]
const EXPECTED_ROWS = [
  ["gpt-5.3-codex-spark", MAP_SPARK, SIX, 128000, 128000],
  ["gpt-5.5", MAP_SPARK, SIX, 128000, 272000],
  ["gpt-5.6-luna", MAP_LUNA_TERRA, SEVEN, 128000, 272000],
  ["gpt-5.6-sol", MAP_LUNA_TERRA, SEVEN, 128000, 272000],
  ["gpt-5.6-terra", MAP_LUNA_TERRA, SEVEN, 128000, 272000],
  ["gpt-6-astra", MAP_ASTRA, ASTRA_ADVERTISED, 128000, 272000],
  ["gpt-6-luna", MAP_GPT6, SEVEN, 128000, 272000],
  ["gpt-6-sol", MAP_GPT6, SEVEN, 128000, 272000],
];

const identity = (id, overrides = {}) => ({
  provider: CODEX_PROVIDER,
  api: CODEX_API,
  protocolModelID: id,
  ...overrides,
});
const planned = (plan) => {
  assert.equal(plan.kind, "planned", JSON.stringify(plan));
  return plan;
};

test("catalogue holds the eight exact records with copied maps, advertised sets and reference limits", () => {
  assert.equal(CODEX_CATALOGUE.length, 8);
  EXPECTED_ROWS.forEach(
    ([id, map, advertised, maxTokens, contextWindow], index) => {
      const row = CODEX_CATALOGUE[index];
      assert.equal(row.protocolModelID, id);
      assert.equal(row.provider, CODEX_PROVIDER);
      assert.equal(row.api, CODEX_API);
      assert.deepEqual({ ...row.thinkingLevelMap }, map, id);
      assert.deepEqual([...row.supportedLevels], advertised, id);
      assert.equal(row.modelMaxTokens, maxTokens);
      assert.equal(row.contextWindow, contextWindow);
    },
  );
  assert.equal(
    CODEX_CATALOGUE.filter((row) => row.supportedLevels.length === 6).length,
    3,
  );
  assert.equal(
    CODEX_CATALOGUE.filter((row) => row.supportedLevels.length === 7).length,
    5,
  );
});

test("catalogue rows, maps and advertised sets are deeply frozen", () => {
  assert.ok(Object.isFrozen(CODEX_CATALOGUE));
  for (const row of CODEX_CATALOGUE) {
    assert.ok(Object.isFrozen(row));
    assert.ok(Object.isFrozen(row.thinkingLevelMap));
    assert.ok(Object.isFrozen(row.supportedLevels));
  }
  assert.throws(() => CODEX_CATALOGUE.push({}), TypeError);
  assert.throws(() => {
    CODEX_CATALOGUE[0].modelMaxTokens = 1;
  }, TypeError);
  assert.throws(() => {
    CODEX_CATALOGUE[0].thinkingLevelMap.max = "max";
  }, TypeError);
  assert.throws(
    () => CODEX_CATALOGUE[0].supportedLevels.push("max"),
    TypeError,
  );
  assert.throws(() => CODEX_CANONICAL_LEVELS.push("auto"), TypeError);
});

test("source metadata names the Codex API file and the catalogue record by hash", () => {
  assert.deepEqual(
    { ...CODEX_SOURCE_HASHES },
    {
      "api/openai-codex-responses.js":
        "6e69310d77278231cfc87d7f03ee815d4a0f2ff273e6c43fcee6835e7df2b0c7",
      "providers/data/openai-codex.json":
        "4bb30a26d1b40e1f67c9f24891fca0ce25b030bc4cbbb529be78608cd4466fdf",
      "models.js":
        "75fa33149fb608bc4a7b7a0586c8ca8f0024465d580091b0c426c0baf3fbc80a",
    },
  );
  assert.ok(Object.isFrozen(CODEX_SOURCE_HASHES));
  assert.match(
    CODEX_SOURCE_SCOPE,
    /api\/openai-codex-responses\.js streamSimple/,
  );
});

test("lookup needs the exact provider, API and id; aliases, mismatches and prototype keys are rejected", () => {
  for (const id of [
    "gpt-5.5 ",
    "GPT-5.5",
    "gpt-5",
    "gpt-5.5-codex",
    "__proto__",
    "constructor",
  ]) {
    assert.deepEqual(
      planCodexLevel(identity(id), "minimal"),
      { kind: "insufficient", reason: "model" },
      id,
    );
  }
  assert.deepEqual(
    planCodexLevel(identity("gpt-5.5", { provider: "openai" }), "minimal"),
    {
      kind: "insufficient",
      reason: "provider",
    },
  );
  assert.deepEqual(
    planCodexLevel(identity("gpt-5.5", { api: "openai-responses" }), "minimal"),
    {
      kind: "insufficient",
      reason: "api",
    },
  );
  assert.deepEqual(
    planCodexRange(identity("gpt-5.5", { api: "openai-completions" }), {
      from: "off",
      to: "high",
    }),
    {
      kind: "insufficient",
      reason: "api",
    },
  );
});

test("identity is read from own data properties only; inherited, accessor, revoked and throwing inputs are rejected quietly", () => {
  assert.deepEqual(
    planCodexLevel(Object.create(identity("gpt-5.5")), "minimal"),
    { kind: "invalid-input", code: "candidate" },
  );
  assert.deepEqual(planCodexLevel(null, "minimal"), {
    kind: "invalid-input",
    code: "candidate",
  });
  assert.deepEqual(planCodexLevel(undefined, "minimal"), {
    kind: "invalid-input",
    code: "candidate",
  });

  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "protocolModelID", {
    enumerable: true,
    get() {
      reads += 1;
      return "gpt-5.5";
    },
  });
  accessor.provider = CODEX_PROVIDER;
  accessor.api = CODEX_API;
  assert.deepEqual(planCodexLevel(accessor, "minimal"), {
    kind: "invalid-input",
    code: "candidate",
  });
  assert.equal(reads, 0);

  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.deepEqual(planCodexLevel(proxy, "minimal"), {
    kind: "invalid-input",
    code: "candidate",
  });

  const throwing = new Proxy(identity("gpt-5.5"), {
    getOwnPropertyDescriptor() {
      throw new Error(SECRET);
    },
  });
  const result = planCodexLevel(throwing, "minimal");
  assert.deepEqual(result, { kind: "invalid-input", code: "candidate" });
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("advertised boundaries: astra has no off, luna and sol have off, spark and gpt-5.5 have no max", () => {
  assert.deepEqual(planCodexLevel(identity("gpt-6-astra"), "off"), {
    kind: "unsupported-in-snapshot",
    scope: "level",
    level: "off",
    sourceEvidence: CODEX_SDK_CLAMP_EVIDENCE,
    source: CODEX_SOURCE_SCOPE,
    capOmission: CODEX_CAP_OMISSION,
    conditions: CODEX_CONDITIONS,
  });
  assert.equal(
    planned(planCodexLevel(identity("gpt-6-luna"), "off")).admittedLevels[0],
    "off",
  );
  assert.equal(
    planned(planCodexLevel(identity("gpt-6-sol"), "off")).admittedLevels[0],
    "off",
  );
  for (const id of ["gpt-5.3-codex-spark", "gpt-5.5"]) {
    assert.equal(
      planCodexLevel(identity(id), "max").kind,
      "unsupported-in-snapshot",
      id,
    );
    assert.equal(
      planned(planCodexLevel(identity(id), "xhigh")).admittedLevels[0],
      "xhigh",
      id,
    );
  }
  assert.equal(
    planned(planCodexLevel(identity("gpt-5.6-luna"), "max")).candidates[0]
      .recipe.reasoning.effort,
    "max",
  );
});

test("unknown, SDK-only and non-string levels are invalid; they are never clamped or defaulted", () => {
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
    const result = planCodexLevel(identity("gpt-5.5"), level);
    assert.deepEqual(result, { kind: "invalid-input", code: "level" });
    assert.ok(!JSON.stringify(result).includes(SECRET));
  }
});

test("minimal and low share one class with compatible set minimal and low; the admitted set is the requested singleton", () => {
  const minimal = planned(planCodexLevel(identity("gpt-5.5"), "minimal"));
  assert.equal(minimal.scope, "level");
  assert.deepEqual(minimal.admittedLevels, ["minimal"]);
  assert.deepEqual(
    minimal.candidates.map((c) => c.compatibleLevels),
    [["minimal", "low"]],
  );
  assert.deepEqual(
    minimal.candidates.map((c) => c.admittedLevels),
    [["minimal"]],
  );
  const low = planned(planCodexLevel(identity("gpt-5.5"), "low"));
  assert.deepEqual(low.candidates[0].compatibleLevels, ["minimal", "low"]);
  assert.deepEqual(low.candidates[0].admittedLevels, ["low"]);
  assert.deepEqual(minimal.candidates[0].recipe.reasoning, {
    effort: "low",
    summary: "auto",
  });
});

test("positive levels carry effort from the row map and summary auto; medium, high, xhigh and max are singleton classes", () => {
  const cases = [
    ["gpt-5.6-luna", "medium", "medium"],
    ["gpt-5.6-luna", "high", "high"],
    ["gpt-5.6-luna", "xhigh", "xhigh"],
    ["gpt-5.6-luna", "max", "max"],
    ["gpt-6-astra", "xhigh", "xhigh"],
    ["gpt-6-astra", "max", "max"],
  ];
  for (const [id, level, effort] of cases) {
    const plan = planned(planCodexLevel(identity(id), level));
    assert.equal(plan.candidates.length, 1, `${id} ${level}`);
    assert.deepEqual(
      plan.candidates[0].recipe.reasoning,
      { effort, summary: "auto" },
      `${id} ${level}`,
    );
    assert.equal(plan.candidates[0].summary, "auto");
    assert.deepEqual(
      plan.candidates[0].compatibleLevels,
      [level],
      `${id} ${level}`,
    );
  }
});

test("off is a supported recipe with effort none and no summary field, and the summary descriptor is absent", () => {
  for (const id of [
    "gpt-5.3-codex-spark",
    "gpt-5.5",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-6-luna",
    "gpt-6-sol",
  ]) {
    const plan = planned(planCodexLevel(identity(id), "off"));
    const candidate = plan.candidates[0];
    assert.deepEqual(candidate.recipe.reasoning, { effort: "none" }, id);
    assert.equal("summary" in candidate.recipe.reasoning, false, id);
    assert.equal(candidate.summary, "absent", id);
    assert.deepEqual(candidate.compatibleLevels, ["off"], id);
  }
});

test("every admitted recipe keeps the encrypted reasoning include constant, including off", () => {
  for (const id of ["gpt-5.5", "gpt-6-astra", "gpt-6-luna"]) {
    for (const level of ["off", "minimal", "high", "max"]) {
      const plan = planCodexLevel(identity(id), level);
      if (plan.kind !== "planned") continue;
      for (const candidate of plan.candidates) {
        assert.deepEqual(
          candidate.recipe.include,
          [REFERENCE],
          `${id} ${level}`,
        );
      }
    }
  }
});

test("inclusive range off..high on gpt-5.5 returns four candidate classes without selecting one", () => {
  const plan = planned(
    planCodexRange(identity("gpt-5.5"), { from: "off", to: "high" }),
  );
  assert.equal(plan.scope, "range");
  assert.deepEqual(plan.admittedLevels, [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(plan.excludedLevels, []);
  assert.deepEqual(
    plan.candidates.map((c) => [
      c.recipe.reasoning.effort,
      c.summary,
      c.compatibleLevels,
      c.admittedLevels,
    ]),
    [
      ["none", "absent", ["off"], ["off"]],
      ["low", "auto", ["minimal", "low"], ["minimal", "low"]],
      ["medium", "auto", ["medium"], ["medium"]],
      ["high", "auto", ["high"], ["high"]],
    ],
  );
});

test("astra off..max excludes off, returns five positive classes and keeps every admitted set exact", () => {
  const plan = planned(
    planCodexRange(identity("gpt-6-astra"), { from: "off", to: "max" }),
  );
  assert.deepEqual(plan.admittedLevels, [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.deepEqual(plan.excludedLevels, ["off"]);
  assert.equal(plan.candidates.length, 5);
  assert.deepEqual(
    plan.candidates.map((c) => c.recipe.reasoning.effort),
    ["low", "medium", "high", "xhigh", "max"],
  );
  assert.deepEqual(plan.candidates[0].compatibleLevels, ["minimal", "low"]);
  assert.deepEqual(plan.candidates[0].admittedLevels, ["minimal", "low"]);
});

test("gpt-6-sol off..max returns six classes for seven advertised levels, with off classed separately", () => {
  const plan = planned(
    planCodexRange(identity("gpt-6-sol"), { from: "off", to: "max" }),
  );
  assert.equal(plan.candidates.length, 6);
  assert.equal(plan.candidates[0].recipe.reasoning.effort, "none");
  assert.equal(plan.candidates[0].summary, "absent");
  assert.deepEqual(plan.admittedLevels, [...SEVEN]);
});

test("a range inside one class keeps the full compatible set and admits only the intersection", () => {
  const plan = planned(
    planCodexRange(identity("gpt-6-astra"), { from: "low", to: "high" }),
  );
  assert.deepEqual(
    plan.candidates.map((c) => [c.compatibleLevels, c.admittedLevels]),
    [
      [["minimal", "low"], ["low"]],
      [["medium"], ["medium"]],
      [["high"], ["high"]],
    ],
  );
  const minLow = planned(
    planCodexRange(identity("gpt-5.3-codex-spark"), {
      from: "minimal",
      to: "low",
    }),
  );
  assert.equal(minLow.candidates.length, 1);
  assert.deepEqual(minLow.candidates[0].compatibleLevels, ["minimal", "low"]);
  assert.deepEqual(minLow.candidates[0].admittedLevels, ["minimal", "low"]);
});

test("unsupported bounds are filtered, not rejected, while a range with no advertised member is unsupported", () => {
  const partial = planned(
    planCodexRange(identity("gpt-5.3-codex-spark"), {
      from: "xhigh",
      to: "max",
    }),
  );
  assert.deepEqual(partial.admittedLevels, ["xhigh"]);
  assert.deepEqual(partial.excludedLevels, ["max"]);
  assert.deepEqual(
    planCodexRange(identity("gpt-5.3-codex-spark"), { from: "max", to: "max" }),
    {
      kind: "unsupported-in-snapshot",
      scope: "range",
      source: CODEX_SOURCE_SCOPE,
      capOmission: CODEX_CAP_OMISSION,
      conditions: CODEX_CONDITIONS,
    },
  );
  assert.equal(
    planCodexRange(identity("gpt-6-astra"), { from: "off", to: "off" }).kind,
    "unsupported-in-snapshot",
  );
});

test("reversed, sparse, non-record, array and unknown-bound ranges are rejected cleanly", () => {
  for (const bad of [
    { from: "high", to: "low" },
    { from: "off" },
    { to: "high" },
    { from: "none", to: "high" },
    { from: "off", to: "auto" },
    [],
    ["off", "high"],
    null,
    undefined,
    "off..high",
  ]) {
    assert.deepEqual(planCodexRange(identity("gpt-5.5"), bad), {
      kind: "invalid-input",
      code: "range",
    });
  }
});

test("range accessors and revoked range proxies are rejected without invoking accessors or throwing", () => {
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
  assert.deepEqual(planCodexRange(identity("gpt-5.5"), range), {
    kind: "invalid-input",
    code: "range",
  });
  assert.equal(reads, 0);

  const { proxy, revoke } = Proxy.revocable([], {});
  revoke();
  assert.deepEqual(planCodexRange(identity("gpt-5.5"), proxy), {
    kind: "invalid-input",
    code: "range",
  });
});

test("every planned or unsupported result carries the builder cap-omission descriptor and the source conditions", () => {
  const results = [
    planCodexLevel(identity("gpt-5.5"), "minimal"),
    planCodexLevel(identity("gpt-6-astra"), "off"),
    planCodexRange(identity("gpt-5.5"), { from: "off", to: "high" }),
    planCodexRange(identity("gpt-5.3-codex-spark"), { from: "max", to: "max" }),
  ];
  for (const result of results) {
    assert.equal(result.capOmission, CODEX_CAP_OMISSION);
    assert.deepEqual(result.conditions, CODEX_CONDITIONS);
    assert.equal("cap" in result, false);
    assert.equal("maxTokens" in result, false);
  }
  assert.equal(
    CODEX_CAP_OMISSION,
    "pi-builder-emits-no-cap-field-before-on-payload",
  );
  for (const condition of [
    "truthy-api-key-prerequisite-simple-and-raw",
    "account-id-token-claim-prerequisite",
    "successful-simple-preprocessing",
    "on-payload-full-body-replacement",
    "native-provider-model-transport-correspondence-unknown",
    "provider-effort-and-summary-acceptance-unknown",
    "auth-runtime-unexecuted",
  ]) {
    assert.ok(CODEX_CONDITIONS.includes(condition), condition);
  }
});

test("planner recipes never write effort off, and effort none never carries a summary", () => {
  for (const row of CODEX_CATALOGUE) {
    for (const level of CODEX_CANONICAL_LEVELS) {
      const plan = planCodexLevel(identity(row.protocolModelID), level);
      if (plan.kind !== "planned") continue;
      const { reasoning } = plan.candidates[0].recipe;
      assert.notEqual(reasoning.effort, "off");
      if (reasoning.effort === "none")
        assert.equal("summary" in reasoning, false);
      else assert.equal(reasoning.summary, "auto");
    }
  }
});

test("results are deeply frozen and no caller input is modified", () => {
  const range = Object.freeze({ from: "off", to: "high" });
  const candidate = Object.freeze(identity("gpt-5.5"));
  const plan = planCodexRange(candidate, range);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.admittedLevels));
  assert.ok(Object.isFrozen(plan.candidates));
  assert.ok(Object.isFrozen(plan.candidates[0].recipe));
  assert.ok(Object.isFrozen(plan.candidates[0].recipe.reasoning));
  assert.ok(Object.isFrozen(plan.candidates[0].recipe.include));
  assert.throws(() => {
    plan.candidates[0].recipe.reasoning.effort = "high";
  }, TypeError);
  assert.deepEqual(candidate, identity("gpt-5.5"));
  assert.deepEqual(range, { from: "off", to: "high" });
});

test("the module exposes only the Simple source planner surface", async () => {
  const exported = Object.keys(
    await import("../dist/thinking/codex.js"),
  ).sort();
  assert.deepEqual(exported, [
    "CODEX_API",
    "CODEX_CANONICAL_LEVELS",
    "CODEX_CAP_OMISSION",
    "CODEX_CATALOGUE",
    "CODEX_CONDITIONS",
    "CODEX_PROVIDER",
    "CODEX_SDK_CLAMP_EVIDENCE",
    "CODEX_SOURCE_HASHES",
    "CODEX_SOURCE_SCOPE",
    "planCodexLevel",
    "planCodexRange",
  ]);
});
