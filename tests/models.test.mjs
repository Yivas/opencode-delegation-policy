import assert from "node:assert/strict";
import { test } from "node:test";

import { PreferenceStore } from "../dist/state/store.js";
import { validateDelegationAxes } from "../dist/validation/models.js";

const SESSION_ID = "parent";
const GLOBAL_KEY = "preferences.v1.global";
const SECRET = "sk-test-secret-value";
const OPENAI = "@opencode/ai/providers/openai";

// Storage double with the ctx.storage surface: values travel as JSON text, so every read is a
// fresh copy. A failed read rejects with a message that must never reach the caller.
function createStorageDouble() {
  const records = new Map();
  const writes = [];
  let failNextRead = false;
  return {
    records,
    writes,
    failNextRead() {
      failNextRead = true;
    },
    storage: {
      async get(key) {
        if (failNextRead) {
          failNextRead = false;
          throw new Error(`read failed with ${SECRET}`);
        }
        const text = records.get(key);
        return text === undefined ? undefined : JSON.parse(text);
      },
      async set(key, value) {
        writes.push(key);
        records.set(key, JSON.stringify(value));
      },
      async remove(key) {
        records.delete(key);
      },
    },
  };
}

// Catalogue double with the ctx.model.list surface. Each call is counted, and it hands out
// copies so the test can prove the validator never mutates what the host returned.
function catalogDouble(models) {
  const double = {
    models,
    calls: 0,
    failWith: undefined,
    async list() {
      double.calls += 1;
      if (double.failWith !== undefined) {
        throw double.failWith;
      }
      return {
        location: { directory: "/synthetic/project" },
        data: structuredClone(double.models),
      };
    },
  };
  return double;
}

function catalogModel(providerID, id, overrides = {}) {
  return {
    id,
    modelID: id,
    providerID,
    name: id,
    package: "@opencode/ai/providers/groq",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 200000, output: 32000 },
    ...overrides,
  };
}

function effortVariant(id, level) {
  return {
    id,
    settings: { reasoningEffort: level },
  };
}

function openAIResponsesModel(id, variants) {
  return catalogModel("openai", id, {
    modelID: "gpt-5.4",
    package: OPENAI,
    variants: variants.map((item) => ({
      ...item,
      settings: {
        ...item.settings,
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    })),
  });
}

function configured(model) {
  return { kind: "configured", model };
}

const UNSET = { kind: "unset" };
const DISABLED = { kind: "disabled" };

const UNREADABLE_ISSUES = [
  { field: "preferences", code: "preferences-unreadable" },
];

// Stored form of a valid global document, used to build corrupt and future variants.
const STORED_GLOBAL = {
  schemaVersion: 1,
  intensity: "off",
  preference: "standard",
  advisorMode: "with-delegation",
  roles: {
    small: UNSET,
    medium: UNSET,
    large: UNSET,
    visualDesign: UNSET,
    advisor: UNSET,
  },
  thinking: {
    small: UNSET,
    medium: UNSET,
    large: UNSET,
    visualDesign: UNSET,
    advisor: UNSET,
  },
};

function sessionStorageKey(sessionID) {
  return `preferences.v1.session.${Buffer.from(sessionID).toString("hex")}`;
}

// Catalogue shared by most cases: one proven-level model, one budget-only model and one
// slash-bearing identifier.
function standardCatalog() {
  return [
    catalogModel("acme", "small-model", {
      variants: [effortVariant("low", "low"), effortVariant("deep", "high")],
    }),
    catalogModel("acme", "medium-model"),
    catalogModel("acme", "large-model"),
    catalogModel("acme", "advisor-model"),
    catalogModel("acme", "vendor/model/v2", {
      variants: [effortVariant("fast", "low")],
    }),
  ];
}

test("a corrupt global document fails both axes closed without querying the catalogue or overwriting it", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({ intensity: "normal" });
  const original = JSON.stringify({ ...STORED_GLOBAL, intensity: "turbo" });
  double.records.set(GLOBAL_KEY, original);
  const writesBefore = double.writes.length;
  const catalog = catalogDouble(standardCatalog());

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result, {
    delegation: { status: "error", issues: UNREADABLE_ISSUES },
    advisor: { status: "error", issues: UNREADABLE_ISSUES },
  });
  assert.equal(catalog.calls, 0);
  assert.equal(double.writes.length, writesBefore);
  assert.equal(double.records.get(GLOBAL_KEY), original);
});

test("a future global document is not read as the current version", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  const future = JSON.stringify({
    schemaVersion: 2,
    intensity: "orchestrator",
  });
  double.records.set(GLOBAL_KEY, future);
  const catalog = catalogDouble(standardCatalog());

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: UNREADABLE_ISSUES,
  });
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: UNREADABLE_ISSUES,
  });
  assert.equal(catalog.calls, 0);
  assert.equal(double.records.get(GLOBAL_KEY), future);
});

test("a corrupt session document fails both axes and is left in storage", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({ intensity: "normal" });
  const key = sessionStorageKey(SESSION_ID);
  const original = JSON.stringify({ schemaVersion: 1, intensity: "turbo" });
  double.records.set(key, original);
  const catalog = catalogDouble(standardCatalog());

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: UNREADABLE_ISSUES,
  });
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: UNREADABLE_ISSUES,
  });
  assert.equal(catalog.calls, 0);
  assert.equal(double.records.get(key), original);
});

test("a failed storage read fails both axes and reveals neither the error nor defaults", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  double.failNextRead();
  const catalog = catalogDouble(standardCatalog());

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: UNREADABLE_ISSUES,
  });
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: UNREADABLE_ISSUES,
  });
  assert.equal(catalog.calls, 0);
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test("an invalid session identifier is a caller error and is not reported as unreadable", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);

  await assert.rejects(
    validateDelegationAxes({
      store,
      catalog: catalogDouble(standardCatalog()),
      sessionID: "",
    }),
    { name: "PreferenceStateError", code: "invalid-session-id" },
  );
});

test("off axes do not validate their stored roles or query the catalogue", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "off",
    advisorMode: "off",
    roles: {
      small: configured("acme/unknown"),
      advisor: configured("acme/nope"),
    },
    thinking: { small: { kind: "fixed", level: "turbo" } },
  });
  const catalog = catalogDouble(standardCatalog());

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result, {
    delegation: { status: "off" },
    advisor: { status: "off" },
  });
  assert.equal(catalog.calls, 0);
});

test("with delegation off, an invalid stored ordinary role is ignored while a valid Advisor is validated", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "off",
    advisorMode: "on",
    roles: {
      small: configured("acme/unknown"),
      advisor: configured("acme/advisor-model"),
    },
  });
  const catalog = catalogDouble(standardCatalog());

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, { status: "off" });
  assert.deepEqual(result.advisor, {
    status: "active",
    advisor: {
      role: "advisor",
      model: { providerID: "acme", id: "advisor-model" },
      thinking: { kind: "unset" },
    },
  });
  assert.equal(catalog.calls, 1);
});

test("an active delegation needs at least one valid enabled ordinary role", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: {
      small: DISABLED,
      medium: UNSET,
      large: DISABLED,
      visualDesign: configured("acme/small-model"),
    },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [{ field: "roles", code: "no-ordinary-role" }],
  });
  assert.deepEqual(result.advisor, { status: "off" });
});

test("each intensity activates delegation with any single valid ordinary role", async () => {
  const modelByRole = {
    small: { reference: "acme/small-model", id: "small-model" },
    medium: { reference: "acme/medium-model", id: "medium-model" },
    large: { reference: "acme/large-model", id: "large-model" },
  };
  for (const intensity of ["normal", "aggressive", "orchestrator"]) {
    for (const role of Object.keys(modelByRole)) {
      const double = createStorageDouble();
      const store = new PreferenceStore(double.storage);
      await store.saveDefaults({
        intensity,
        advisorMode: "off",
        roles: { [role]: configured(modelByRole[role].reference) },
      });

      const result = await validateDelegationAxes({
        store,
        catalog: catalogDouble(standardCatalog()),
        sessionID: SESSION_ID,
      });

      assert.deepEqual(
        result.delegation,
        {
          status: "active",
          intensity,
          roles: [
            {
              role,
              model: { providerID: "acme", id: modelByRole[role].id },
              thinking: { kind: "unset" },
            },
          ],
        },
        `${intensity} with ${role}`,
      );
    }
  }
});

test("an invalid configured ordinary role invalidates delegation even when another ordinary role is valid", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: {
      small: configured("acme/missing-model"),
      medium: configured("acme/medium-model"),
    },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [{ role: "small", field: "model", code: "model-not-found" }],
  });
});

test("an invalid configured Visual Design role invalidates delegation and leaves Advisor alone", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: configured("acme/small-model"),
      visualDesign: configured("acme/missing-model"),
      advisor: configured("acme/advisor-model"),
    },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [{ role: "visualDesign", field: "model", code: "model-not-found" }],
  });
  assert.equal(result.advisor.status, "active");
});

test("a valid configured Visual Design role joins the delegation roles", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "aggressive",
    advisorMode: "off",
    roles: {
      small: configured("acme/small-model"),
      visualDesign: configured("acme/medium-model"),
    },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(
    result.delegation.roles.map((selection) => selection.role),
    ["small", "visualDesign"],
  );
});

test("model references keep the exact base identifier with internal slashes and an inline variant", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/vendor/model/v2#fast") },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.roles, [
    {
      role: "small",
      model: { providerID: "acme", id: "vendor/model/v2", variant: "fast" },
      thinking: { kind: "unset" },
    },
  ]);
});

test("native invalid reference formats are rejected as invalid references without fallback", async () => {
  const invalidReferences = [
    "no-provider",
    "/model",
    "acme/",
    "acme/model#",
    "acme/model#fast#extra",
    "acme#x/model",
  ];

  for (const reference of invalidReferences) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      advisorMode: "off",
      roles: { small: configured(reference) },
    });

    const result = await validateDelegationAxes({
      store,
      catalog: catalogDouble(standardCatalog()),
      sessionID: SESSION_ID,
    });

    assert.deepEqual(
      result.delegation,
      {
        status: "error",
        issues: [
          { role: "small", field: "model", code: "invalid-reference" },
          { field: "roles", code: "no-ordinary-role" },
        ],
      },
      reference,
    );
  }
});

test("matching uses the host model id, never its protocol modelID alias or another provider", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: {
      small: configured("acme/alias-id"),
      medium: configured("other/small-model"),
    },
  });
  const catalog = catalogDouble([
    catalogModel("acme", "real-id", { modelID: "alias-id" }),
    catalogModel("acme", "small-model"),
  ]);

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [
      { role: "small", field: "model", code: "model-not-found" },
      { role: "medium", field: "model", code: "model-not-found" },
      { field: "roles", code: "no-ordinary-role" },
    ],
  });
});

test("a disabled model, an unknown inline variant and duplicate catalogue entries are reported", async () => {
  const cases = [
    {
      catalog: [catalogModel("acme", "small-model", { enabled: false })],
      reference: "acme/small-model",
      code: ["model", "model-disabled"],
    },
    {
      catalog: [catalogModel("acme", "small-model")],
      reference: "acme/small-model#missing",
      code: ["variant", "variant-not-found"],
    },
    {
      catalog: [
        catalogModel("acme", "small-model"),
        catalogModel("acme", "small-model"),
      ],
      reference: "acme/small-model",
      code: ["model", "ambiguous-model"],
    },
    {
      catalog: [
        catalogModel("acme", "small-model", {
          variants: [
            effortVariant("deep", "high"),
            effortVariant("deep", "low"),
          ],
        }),
      ],
      reference: "acme/small-model",
      code: ["variant", "ambiguous-variant"],
    },
  ];

  for (const { catalog, reference, code } of cases) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      advisorMode: "off",
      roles: { small: configured(reference) },
    });

    const result = await validateDelegationAxes({
      store,
      catalog: catalogDouble(catalog),
      sessionID: SESSION_ID,
    });

    assert.deepEqual(
      result.delegation.issues[0],
      { role: "small", field: code[0], code: code[1] },
      reference,
    );
  }
});

test("unset thinking keeps an inline variant exactly as written, even a budget-only one", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/large-model#budget") },
  });
  const catalog = catalogDouble([
    catalogModel("acme", "large-model", {
      variants: [
        { id: "budget", settings: { thinking: { budgetTokens: 8000 } } },
      ],
    }),
  ]);

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.roles, [
    {
      role: "small",
      model: { providerID: "acme", id: "large-model", variant: "budget" },
      thinking: { kind: "unset" },
    },
  ]);
});

test("a fixed role with several proven variants returns them all for the launch choice", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("openai/small-model") },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const catalog = catalogDouble([
    openAIResponsesModel("small-model", [
      effortVariant("deep", "high"),
      effortVariant("arbitrary", "high"),
      effortVariant("low", "low"),
    ]),
  ]);

  const first = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });
  const second = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  const expected = {
    kind: "options",
    options: [
      {
        variant: "deep",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
      },
      {
        variant: "arbitrary",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
      },
    ],
  };
  assert.deepEqual(
    withoutEvidence(first.delegation.roles[0].thinking),
    expected,
  );
  assert.deepEqual(
    withoutEvidence(second.delegation.roles[0].thinking),
    expected,
  );
  assert.deepEqual(first.delegation.roles[0].model, {
    providerID: "openai",
    id: "small-model",
  });
});

test("a fixed requirement with a matching inline variant keeps that variant", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("openai/small-model#deep") },
    thinking: { small: { kind: "fixed", level: "high" } },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble([
      openAIResponsesModel("small-model", [effortVariant("deep", "high")]),
    ]),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(withoutEvidence(result.delegation.roles), [
    {
      role: "small",
      model: { providerID: "openai", id: "small-model", variant: "deep" },
      thinking: {
        kind: "inline",
        variant: "deep",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
      },
    },
  ]);
});

test("a fixed requirement rejects a conflicting inline variant instead of replacing it", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("openai/small-model#low") },
    thinking: { small: { kind: "fixed", level: "high" } },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble([
      openAIResponsesModel("small-model", [effortVariant("low", "low")]),
    ]),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [
      { role: "small", field: "thinking", code: "thinking-variant-mismatch" },
      { field: "roles", code: "no-ordinary-role" },
    ],
  });
});

test("a range rejects reversed bounds, unknown levels and a model without proven variants", async () => {
  const cases = [
    {
      thinking: { kind: "range", from: "high", to: "low" },
      code: "thinking-range-invalid",
    },
    {
      thinking: { kind: "range", from: "low", to: "ultra" },
      code: "thinking-range-invalid",
    },
    {
      thinking: { kind: "fixed", level: "ultra" },
      code: "thinking-level-invalid",
    },
    {
      thinking: { kind: "range", from: "minimal", to: "medium" },
      code: "thinking-unsupported",
      reference: "acme/medium-model",
    },
  ];

  for (const { thinking, code, reference = "acme/small-model" } of cases) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      advisorMode: "off",
      roles: { small: configured(reference) },
      thinking: { small: thinking },
    });

    const result = await validateDelegationAxes({
      store,
      catalog: catalogDouble(standardCatalog()),
      sessionID: SESSION_ID,
    });

    assert.deepEqual(
      result.delegation.issues[0],
      { role: "small", field: "thinking", code },
      JSON.stringify(thinking),
    );
  }
});

test("a range accepts an inline variant on its endpoints and rejects one outside", async () => {
  const catalog = [
    openAIResponsesModel("small-model", [
      effortVariant("low", "low"),
      effortVariant("medium", "medium"),
      effortVariant("high", "high"),
    ]),
  ];

  for (const [reference, expected] of [
    ["openai/small-model#low", "ok"],
    ["openai/small-model#medium", "ok"],
    ["openai/small-model#high", "thinking-variant-mismatch"],
  ]) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      advisorMode: "off",
      roles: { small: configured(reference) },
      thinking: { small: { kind: "range", from: "low", to: "medium" } },
    });

    const result = await validateDelegationAxes({
      store,
      catalog: catalogDouble(catalog),
      sessionID: SESSION_ID,
    });

    if (expected === "ok") {
      assert.equal(result.delegation.status, "active", reference);
    } else {
      assert.deepEqual(
        result.delegation.issues[0],
        { role: "small", field: "thinking", code: expected },
        reference,
      );
    }
  }
});

test("conflicting overlays make a fixed level unusable instead of guessing", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/small-model#deep") },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const conflicting = catalogModel("acme", "small-model", {
    variants: [
      {
        id: "deep",
        settings: {
          reasoningEffort: "high",
          thinking: { type: "enabled", budgetTokens: 4096 },
        },
      },
    ],
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble([conflicting]),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.issues[0], {
    role: "small",
    field: "thinking",
    code: "thinking-variant-unproven",
  });
});

test("a model change that removes the proven level invalidates the previous selection on the next validation", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("openai/small-model") },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const catalog = catalogDouble([
    openAIResponsesModel("small-model", [effortVariant("high", "high")]),
  ]);

  const before = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });
  catalog.models = [
    openAIResponsesModel("small-model", [effortVariant("low", "low")]),
  ];
  const after = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.equal(before.delegation.status, "active");
  assert.deepEqual(after.delegation.issues[0], {
    role: "small",
    field: "thinking",
    code: "thinking-unsupported",
  });
  assert.equal(catalog.calls, 2);
});

test("a model that is disabled after a successful validation is reported on the next one", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/small-model") },
  });
  const catalog = catalogDouble(standardCatalog());

  assert.equal(
    (await validateDelegationAxes({ store, catalog, sessionID: SESSION_ID }))
      .delegation.status,
    "active",
  );
  catalog.models = standardCatalog().map((entry) =>
    entry.id === "small-model" ? { ...entry, enabled: false } : entry,
  );

  assert.deepEqual(
    (await validateDelegationAxes({ store, catalog, sessionID: SESSION_ID }))
      .delegation,
    {
      status: "error",
      issues: [
        { role: "small", field: "model", code: "model-disabled" },
        { field: "roles", code: "no-ordinary-role" },
      ],
    },
  );
});

test("an Advisor on without a configured Advisor is an Advisor error that leaves delegation alone", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: { small: configured("acme/small-model") },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: [{ role: "advisor", field: "model", code: "not-configured" }],
  });
});

test("the Advisor mode and intensity combine into the expected axis states", async () => {
  const advisorRoles = {
    small: configured("acme/small-model"),
    advisor: configured("acme/advisor-model"),
  };
  const cases = [
    { intensity: "off", advisorMode: "off", advisor: "off" },
    { intensity: "normal", advisorMode: "off", advisor: "off" },
    { intensity: "off", advisorMode: "on", advisor: "active" },
    { intensity: "normal", advisorMode: "on", advisor: "active" },
    { intensity: "off", advisorMode: "with-delegation", advisor: "off" },
    {
      intensity: "aggressive",
      advisorMode: "with-delegation",
      advisor: "active",
    },
  ];

  for (const { intensity, advisorMode, advisor } of cases) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({ intensity, advisorMode, roles: advisorRoles });

    const result = await validateDelegationAxes({
      store,
      catalog: catalogDouble(standardCatalog()),
      sessionID: SESSION_ID,
    });

    assert.equal(result.advisor.status, advisor, `${intensity}/${advisorMode}`);
  }
});

test("with-delegation, active intensity, invalid delegation and a valid Advisor give D:ERR with A:ON", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "with-delegation",
    roles: {
      small: configured("acme/missing-model"),
      advisor: configured("acme/advisor-model"),
    },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "error");
  assert.deepEqual(result.advisor, {
    status: "active",
    advisor: {
      role: "advisor",
      model: { providerID: "acme", id: "advisor-model" },
      thinking: { kind: "unset" },
    },
  });
});

test("unsupported Advisor thinking invalidates only the Advisor axis", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: configured("acme/small-model"),
      advisor: configured("acme/advisor-model"),
    },
    thinking: { advisor: { kind: "fixed", level: "high" } },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: [
      { role: "advisor", field: "thinking", code: "thinking-unsupported" },
    ],
  });
});

test("an inactive axis does not validate its thinking even when its role is invalid", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: {
      small: configured("acme/small-model"),
      advisor: configured("acme/missing"),
    },
    thinking: { advisor: { kind: "range", from: "high", to: "low" } },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(result.advisor, { status: "off" });
});

test("a catalogue rejection fails only the active axes and never echoes the host error", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: configured("acme/small-model"),
      advisor: configured("acme/advisor-model"),
    },
  });
  const catalog = catalogDouble(standardCatalog());
  catalog.failWith = new Error(`auth token ${SECRET} rejected`);

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [
      { role: "small", field: "catalog", code: "catalog-unavailable" },
      { field: "roles", code: "no-ordinary-role" },
    ],
  });
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: [
      { role: "advisor", field: "catalog", code: "catalog-unavailable" },
    ],
  });
  assert.ok(!JSON.stringify(result).includes(SECRET));
  assert.ok(!JSON.stringify(result).includes("auth token"));
});

test("a catalogue rejection with only inactive configured roles is never queried", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "off",
    advisorMode: "off",
    roles: { small: configured("acme/small-model") },
  });
  const catalog = catalogDouble(standardCatalog());
  catalog.failWith = new Error(SECRET);

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result, {
    delegation: { status: "off" },
    advisor: { status: "off" },
  });
  assert.equal(catalog.calls, 0);
});

test("the validation output carries only identifiers, variants, levels and issues", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: configured("acme/small-model#deep"),
      advisor: configured("acme/advisor-model"),
    },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const catalog = catalogDouble([
    catalogModel("acme", "small-model", {
      headers: { authorization: SECRET },
      body: { apiKey: SECRET },
      variants: [
        { ...effortVariant("deep", "high"), headers: { "x-secret": SECRET } },
      ],
    }),
    catalogModel("acme", "advisor-model"),
  ]);

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  // Overlays with headers or body make the level unknown, so the delegation error names only
  // the field and code, never the overlay content.
  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [
      { role: "small", field: "thinking", code: "thinking-variant-unproven" },
      { field: "roles", code: "no-ordinary-role" },
    ],
  });
  assert.deepEqual(result.advisor, {
    status: "active",
    advisor: {
      role: "advisor",
      model: { providerID: "acme", id: "advisor-model" },
      thinking: { kind: "unset" },
    },
  });
  assert.ok(!JSON.stringify(result).includes(SECRET));
  assert.ok(!JSON.stringify(result).includes("headers"));
  assert.ok(!JSON.stringify(result).includes("body"));
});

test("validation never mutates the catalogue or the persisted view", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: configured("openai/small-model#deep"),
      advisor: configured("acme/advisor-model"),
    },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const catalog = catalogDouble([
    openAIResponsesModel("small-model", [effortVariant("deep", "high")]),
    catalogModel("acme", "advisor-model"),
  ]);
  const catalogBefore = structuredClone(catalog.models);
  const storedBefore = double.records.get(GLOBAL_KEY);
  const writesBefore = double.writes.length;

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });
  result.delegation.roles[0].model.variant = "tampered";
  result.advisor.advisor.model.id = "tampered";

  assert.deepEqual(catalog.models, catalogBefore);
  assert.equal(double.records.get(GLOBAL_KEY), storedBefore);
  assert.equal(double.writes.length, writesBefore);
  const view = await store.readSession(SESSION_ID);
  assert.deepEqual(
    view.preferences.roles.small,
    configured("openai/small-model#deep"),
  );
});

// Host boundary double for responses that the JSON-cloning catalogue double cannot express,
// such as prototype-only objects. It returns the same value on every call and counts them.
function rawCatalogDouble(listed) {
  const counter = { calls: 0 };
  return {
    get calls() {
      return counter.calls;
    },
    async list() {
      counter.calls += 1;
      return listed;
    },
  };
}

function catalogEnvelope(data) {
  return { location: { directory: "/synthetic/project" }, data };
}

test("with-delegation and an unset or disabled Advisor leave the Advisor axis off while delegation stays active", async () => {
  for (const advisorRole of [UNSET, DISABLED]) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      roles: { small: configured("acme/small-model"), advisor: advisorRole },
    });
    const catalog = catalogDouble(standardCatalog());

    const result = await validateDelegationAxes({
      store,
      catalog,
      sessionID: SESSION_ID,
    });

    assert.equal(result.delegation.status, "active", advisorRole.kind);
    assert.deepEqual(result.advisor, { status: "off" }, advisorRole.kind);
    assert.equal(catalog.calls, 1);
  }
});

test("with-delegation with an active intensity reports a configured but unavailable Advisor", async () => {
  const models = [
    ...standardCatalog().filter((model) => model.id !== "advisor-model"),
    catalogModel("acme", "advisor-model", { enabled: false }),
  ];
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    roles: {
      small: configured("acme/small-model"),
      advisor: configured("acme/advisor-model"),
    },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(models),
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: [{ role: "advisor", field: "model", code: "model-disabled" }],
  });
});

test("on with a disabled Advisor is an Advisor error that names only the missing configuration", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: { small: configured("acme/small-model"), advisor: DISABLED },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble(standardCatalog()),
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: [{ role: "advisor", field: "model", code: "not-configured" }],
  });
});

test("each validation reads the catalogue once for both active axes and again on the next request", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: configured("acme/small-model"),
      advisor: configured("acme/advisor-model"),
    },
  });
  const catalog = catalogDouble(standardCatalog());
  const validate = () =>
    validateDelegationAxes({ store, catalog, sessionID: SESSION_ID });

  const succeeded = await validate();
  assert.equal(succeeded.delegation.status, "active");
  assert.equal(succeeded.advisor.status, "active");
  assert.equal(catalog.calls, 1);

  catalog.models = standardCatalog().map((model) =>
    model.id === "advisor-model" ? { ...model, enabled: false } : model,
  );
  const refreshed = await validate();
  assert.deepEqual(refreshed.advisor.issues, [
    { role: "advisor", field: "model", code: "model-disabled" },
  ]);
  assert.equal(catalog.calls, 2);

  catalog.failWith = new Error(`token ${SECRET} rejected`);
  const rejected = await validate();
  assert.deepEqual(rejected.delegation.issues[0], {
    role: "small",
    field: "catalog",
    code: "catalog-unavailable",
  });
  assert.deepEqual(rejected.advisor.issues, [
    { role: "advisor", field: "catalog", code: "catalog-unavailable" },
  ]);
  assert.equal(catalog.calls, 3);

  catalog.failWith = undefined;
  catalog.models = standardCatalog();
  const recovered = await validate();
  assert.equal(recovered.delegation.status, "active");
  assert.equal(recovered.advisor.status, "active");
  assert.equal(catalog.calls, 4);
});

test("a corrupt or future Advisor substate fails both axes as an unreadable document", async () => {
  const corruptAdvisorSubstates = [
    { roles: { advisor: { kind: "configured" } } },
    {
      roles: {
        advisor: { kind: "configured", model: "acme/advisor-model", note: 1 },
      },
    },
    { roles: { advisor: { kind: "tiered" } } },
    { thinking: { advisor: { kind: "fixed" } } },
    { thinking: { advisor: { kind: "budget", tokens: 8000 } } },
  ];

  for (const substate of corruptAdvisorSubstates) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    const roles = { ...STORED_GLOBAL.roles, ...substate.roles };
    const thinking = { ...STORED_GLOBAL.thinking, ...substate.thinking };
    const original = JSON.stringify({
      ...STORED_GLOBAL,
      intensity: "normal",
      roles,
      thinking,
    });
    double.records.set(GLOBAL_KEY, original);
    const catalog = catalogDouble(standardCatalog());

    const result = await validateDelegationAxes({
      store,
      catalog,
      sessionID: SESSION_ID,
    });

    assert.deepEqual(
      result,
      {
        delegation: { status: "error", issues: UNREADABLE_ISSUES },
        advisor: { status: "error", issues: UNREADABLE_ISSUES },
      },
      JSON.stringify(substate),
    );
    assert.equal(catalog.calls, 0);
    assert.equal(double.records.get(GLOBAL_KEY), original);
  }
});

// Malformed host envelopes and entries, as the JSON host could return them. Each one must
// fail only the active axes, with an opaque diagnostic and without echoing the secret.
const MALFORMED_CATALOGUES = [
  { name: "null envelope", listed: null },
  { name: "data not an array", listed: catalogEnvelope(null) },
  { name: "null entry", listed: catalogEnvelope([null]) },
  { name: "array entry", listed: catalogEnvelope([[]]) },
  {
    name: "providerID not text",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { providerID: 7 }),
    ]),
  },
  {
    name: "id not text",
    listed: catalogEnvelope([catalogModel("acme", "small-model", { id: 7 })]),
  },
  {
    name: "enabled not boolean",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { enabled: SECRET }),
    ]),
  },
  {
    name: "variants not an array",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { variants: "none" }),
    ]),
  },
  {
    name: "variant entry null",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { variants: [null] }),
    ]),
  },
  {
    name: "variant id empty",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { variants: [{ id: "" }] }),
    ]),
  },
  {
    name: "variant id with a hash",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { variants: [{ id: "a#b" }] }),
    ]),
  },
  {
    name: "variant id not text",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { variants: [{ id: 3 }] }),
    ]),
  },
  {
    name: "package not text",
    listed: catalogEnvelope([
      catalogModel("acme", "small-model", { package: 42 }),
    ]),
  },
];

test("a malformed catalogue fails only the active axes with an opaque diagnostic", async () => {
  for (const { name, listed } of MALFORMED_CATALOGUES) {
    for (const { intensity, advisorMode } of [
      { intensity: "normal", advisorMode: "on" },
      { intensity: "off", advisorMode: "on" },
    ]) {
      const double = createStorageDouble();
      const store = new PreferenceStore(double.storage);
      await store.saveDefaults({
        intensity,
        advisorMode,
        roles: {
          small: configured("acme/small-model"),
          advisor: configured("acme/advisor-model"),
        },
      });
      const catalog = rawCatalogDouble(listed);

      const result = await validateDelegationAxes({
        store,
        catalog,
        sessionID: SESSION_ID,
      });

      const label = `${name} with ${intensity}`;
      assert.deepEqual(
        result.advisor,
        {
          status: "error",
          issues: [
            { role: "advisor", field: "catalog", code: "catalog-unavailable" },
          ],
        },
        label,
      );
      if (intensity === "off") {
        assert.deepEqual(result.delegation, { status: "off" }, label);
      } else {
        assert.deepEqual(
          result.delegation,
          {
            status: "error",
            issues: [
              { role: "small", field: "catalog", code: "catalog-unavailable" },
              { field: "roles", code: "no-ordinary-role" },
            ],
          },
          label,
        );
      }
      assert.ok(!JSON.stringify(result).includes(SECRET), label);
      assert.equal(catalog.calls, 1, label);
    }
  }
});

const sparseModels = [];
sparseModels[1] = catalogModel("acme", "small-model", {
  variants: [effortVariant("deep", "high")],
});
sparseModels[2] = catalogModel("acme", "advisor-model");
const sparseVariants = [];
sparseVariants[1] = effortVariant("deep", "high");

for (const { name, data } of [
  { name: "model entries", data: sparseModels },
  {
    name: "variant entries",
    data: [
      catalogModel("acme", "small-model", { variants: sparseVariants }),
      catalogModel("acme", "advisor-model"),
    ],
  },
]) {
  test(`sparse ${name} fail active axes with a catalogue diagnostic`, async () => {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      advisorMode: "on",
      roles: {
        small: configured("acme/small-model"),
        advisor: configured("acme/advisor-model"),
      },
      thinking: { small: { kind: "fixed", level: "high" } },
    });
    const catalog = rawCatalogDouble(catalogEnvelope(data));

    const result = await validateDelegationAxes({
      store,
      catalog,
      sessionID: SESSION_ID,
    });

    assert.deepEqual(result.delegation, {
      status: "error",
      issues: [
        { role: "small", field: "catalog", code: "catalog-unavailable" },
        { field: "roles", code: "no-ordinary-role" },
      ],
    });
    assert.deepEqual(result.advisor, {
      status: "error",
      issues: [
        { role: "advisor", field: "catalog", code: "catalog-unavailable" },
      ],
    });
    assert.equal(catalog.calls, 1);
  });
}

test("a literal off effort stays unproven under an arbitrary or off-named variant, so the model is unmapped", async () => {
  const offVariants = [
    effortVariant("off", "off"),
    effortVariant("arbitrary", "off"),
    effortVariant("low", "low"),
  ];
  const cases = [
    {
      reference: "acme/small-model",
      thinking: { kind: "fixed", level: "off" },
      code: "thinking-unmapped",
    },
    {
      reference: "acme/small-model#arbitrary",
      thinking: { kind: "fixed", level: "off" },
      code: "thinking-variant-unproven",
    },
    {
      reference: "acme/small-model#off",
      thinking: { kind: "range", from: "off", to: "high" },
      code: "thinking-variant-unproven",
    },
  ];

  for (const { reference, thinking, code } of cases) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      advisorMode: "off",
      roles: { small: configured(reference) },
      thinking: { small: thinking },
    });

    const result = await validateDelegationAxes({
      store,
      catalog: catalogDouble([
        catalogModel("acme", "small-model", { variants: offVariants }),
      ]),
      sessionID: SESSION_ID,
    });

    assert.deepEqual(
      result.delegation.issues[0],
      { role: "small", field: "thinking", code },
      reference,
    );
  }
});

test("a range from off keeps only the proven levels inside it", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("xai/grok-4.3") },
    thinking: { small: { kind: "range", from: "off", to: "low" } },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: catalogDouble([
      catalogModel("xai", "grok-4.3", {
        package: "@opencode/ai/providers/xai",
        variants: [
          {
            id: "arbitrary",
            settings: {
              reasoningEffort: "none",
              include: ["reasoning.encrypted_content"],
            },
          },
          {
            id: "low",
            settings: {
              reasoningEffort: "low",
              reasoningSummary: "auto",
              include: ["reasoning.encrypted_content"],
            },
          },
        ],
      }),
    ]),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(withoutEvidence(result.delegation.roles[0].thinking), {
    kind: "options",
    options: [
      {
        variant: "arbitrary",
        transportKind: "native",
        compatibleLevels: ["off"],
        admittedLevels: ["off"],
      },
      {
        variant: "low",
        transportKind: "native",
        compatibleLevels: ["low"],
        admittedLevels: ["low"],
      },
    ],
  });
});

test("settings inherited through a prototype do not prove the fixed level", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/small-model#deep") },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const inherited = catalogModel("acme", "small-model", {
    variants: [
      { id: "deep", settings: Object.create({ reasoningEffort: "high" }) },
    ],
  });

  const result = await validateDelegationAxes({
    store,
    catalog: rawCatalogDouble(catalogEnvelope([inherited])),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.issues[0], {
    role: "small",
    field: "thinking",
    code: "thinking-variant-unproven",
  });
});

// Family matrix through the validator and the real PreferenceStore. Each row configures one
// ordinary role with an arbitrary variant id; the expected outcome is the role-specific result.
function familyCatalog(variants, modelID = "gpt-5.4", overrides = {}) {
  const packageName = overrides.package ?? OPENAI;
  const providerID =
    packageName === OPENAI
      ? "openai"
      : packageName === "@opencode/ai/providers/alibaba/chat"
        ? "alibaba"
        : packageName === "@opencode/ai/providers/openrouter"
          ? "openrouter"
          : "acme";
  const responseVariants =
    packageName === OPENAI
      ? variants.map((variant) => ({
          ...variant,
          settings: {
            ...variant.settings,
            reasoningSummary: "auto",
            include: ["reasoning.encrypted_content"],
          },
        }))
      : variants;
  return [
    catalogModel(providerID, modelID, {
      package: packageName,
      ...overrides,
      variants: responseVariants,
    }),
  ];
}

// Anthropic catalogue entry for a verified adaptive model (Pi thinkingLevelMap: xhigh and max mapped).
function anthropicCatalog(variants, id = "claude-opus-4-8") {
  return [
    catalogModel("anthropic", id, {
      package: "@opencode/ai/providers/anthropic",
      variants,
    }),
  ];
}

function anthropicEffortVariant(id, effort) {
  return {
    id,
    settings: { thinking: { type: "adaptive", display: "summarized" }, effort },
  };
}

async function validateSmallWithFixed(level, reference, catalog) {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured(reference) },
    thinking: { small: { kind: "fixed", level } },
  });
  return validateDelegationAxes({
    store,
    catalog: catalogDouble(catalog),
    sessionID: SESSION_ID,
  });
}

test("a fixed level proven by an arbitrary variant id is offered as an option, never chosen", async () => {
  const result = await validateSmallWithFixed(
    "high",
    "anthropic/claude-opus-4-8",
    anthropicCatalog([
      anthropicEffortVariant("zeta", "low"),
      anthropicEffortVariant("arbitrary-high", "high"),
      anthropicEffortVariant("alpha", "high"),
    ]),
  );

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(withoutEvidence(result.delegation.roles[0].thinking), {
    kind: "options",
    options: [
      {
        variant: "arbitrary-high",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
      },
      {
        variant: "alpha",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
      },
    ],
  });
});

test("an inline variant with a proven matching level is kept exactly as written", async () => {
  const result = await validateSmallWithFixed(
    "high",
    "anthropic/claude-opus-4-8#custom-deep",
    anthropicCatalog([anthropicEffortVariant("custom-deep", "high")]),
  );

  assert.deepEqual(result.delegation.roles[0].model, {
    providerID: "anthropic",
    id: "claude-opus-4-8",
    variant: "custom-deep",
  });
  assert.deepEqual(withoutEvidence(result.delegation.roles[0].thinking), {
    kind: "inline",
    variant: "custom-deep",
    transportKind: "native",
    compatibleLevels: ["high"],
    admittedLevels: ["high"],
  });
});

test("an inline source-mapped off variant conflicts with fixed high and is not replaced", async () => {
  const result = await validateSmallWithFixed(
    "high",
    "xai/grok-4.3#custom-off",
    [
      catalogModel("xai", "grok-4.3", {
        package: "@opencode/ai/providers/xai",
        variants: [
          {
            id: "custom-off",
            settings: {
              reasoningEffort: "none",
              include: ["reasoning.encrypted_content"],
            },
          },
        ],
      }),
    ],
  );

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [
      { role: "small", field: "thinking", code: "thinking-variant-mismatch" },
      { field: "roles", code: "no-ordinary-role" },
    ],
  });
});

test("budget-only variants make a fixed level unmapped, distinct from unsupported", async () => {
  const result = await validateSmallWithFixed(
    "high",
    "openrouter/synthetic-model",
    familyCatalog(
      [
        { id: "high", settings: { reasoning: { max_tokens: 8000 } } },
        { id: "max", settings: { reasoning: { max_tokens: 16000 } } },
      ],
      "synthetic-model",
      { package: "@opencode/ai/providers/openrouter" },
    ),
  );

  assert.deepEqual(result.delegation.issues[0], {
    role: "small",
    field: "thinking",
    code: "thinking-unmapped",
  });
});

test("native OpenRouter effort fields do not admit a model-specific role", async () => {
  const result = await validateSmallWithFixed(
    "high",
    "openrouter/synthetic-unknown-model",
    familyCatalog(
      [
        {
          id: "high",
          settings: { reasoning: { effort: "high" } },
        },
      ],
      "synthetic-unknown-model",
      { package: "@opencode/ai/providers/openrouter" },
    ),
  );

  assert.deepEqual(result.delegation, {
    status: "error",
    issues: [
      { role: "small", field: "thinking", code: "thinking-unmapped" },
      { field: "roles", code: "no-ordinary-role" },
    ],
  });
});

test("a DeepSeek catalogue recipe remains eligible for role thinking", async () => {
  const result = await validateSmallWithFixed(
    "high",
    "deepseek/deepseek-flash",
    [
      catalogModel("deepseek", "deepseek-flash", {
        package: "@opencode/ai/providers/deepseek",
        variants: [
          {
            id: "deep",
            settings: { reasoningEffort: "high" },
            body: { thinking: { type: "enabled" } },
          },
        ],
      }),
    ],
  );

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(withoutEvidence(result.delegation.roles[0].thinking), {
    kind: "options",
    options: [
      {
        variant: "deep",
        transportKind: "native",
        compatibleLevels: ["high"],
        admittedLevels: ["high"],
      },
    ],
  });
});

test("a model whose only variant proves another level is unsupported for the requested one", async () => {
  const result = await validateSmallWithFixed(
    "max",
    "anthropic/claude-opus-4-8",
    anthropicCatalog([anthropicEffortVariant("low", "low")]),
  );

  assert.deepEqual(result.delegation.issues[0], {
    role: "small",
    field: "thinking",
    code: "thinking-unsupported",
  });
});

test("native Alibaba off syntax does not prove model-specific role eligibility", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "on",
    roles: {
      small: configured("acme/small-model"),
      advisor: configured("alibaba/synthetic-model#no-thinking"),
    },
    thinking: { advisor: { kind: "fixed", level: "off" } },
  });
  const catalog = catalogDouble([
    catalogModel("acme", "small-model"),
    catalogModel("alibaba", "synthetic-model", {
      package: "@opencode/ai/providers/alibaba/chat",
      variants: [{ id: "no-thinking", settings: { enableThinking: false } }],
    }),
  ]);

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.equal(result.delegation.status, "active");
  assert.deepEqual(result.advisor, {
    status: "error",
    issues: [
      { role: "advisor", field: "thinking", code: "thinking-variant-unproven" },
    ],
  });
});

test("a catalogue entry whose modelID is not text fails the active axes as catalogue unavailable", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/small-model") },
  });
  const catalog = rawCatalogDouble(
    catalogEnvelope([catalogModel("acme", "small-model", { modelID: 9 })]),
  );

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.issues[0], {
    role: "small",
    field: "catalog",
    code: "catalog-unavailable",
  });
});

// Many-to-one proofs through the validator. Pi sends the same effort for minimal and low on
// adaptive Anthropic models, so one variant proves both and is reported as a set, never a choice.
test("a range returns the whole many-to-one set a variant proves, without choosing one level", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("anthropic/claude-opus-4-8") },
    thinking: { small: { kind: "range", from: "minimal", to: "low" } },
  });
  const ranged = await validateDelegationAxes({
    store,
    catalog: catalogDouble(
      anthropicCatalog([anthropicEffortVariant("effort-low", "low")]),
    ),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(withoutEvidence(ranged.delegation.roles[0].thinking), {
    kind: "options",
    options: [
      {
        variant: "effort-low",
        transportKind: "native",
        compatibleLevels: ["minimal", "low"],
        admittedLevels: ["minimal", "low"],
      },
    ],
  });
});

test("a fixed minimal is admitted by the variant Pi also maps to low, reported as minimal only", async () => {
  const result = await validateSmallWithFixed(
    "minimal",
    "anthropic/claude-opus-4-8",
    anthropicCatalog([anthropicEffortVariant("effort-low", "low")]),
  );

  assert.equal(result.delegation.status, "active");
  // The variant also proves low; the admitted set is only minimal, and the full proof is kept.
  assert.deepEqual(withoutEvidence(result.delegation.roles[0].thinking), {
    kind: "options",
    options: [
      {
        variant: "effort-low",
        transportKind: "native",
        compatibleLevels: ["minimal", "low"],
        admittedLevels: ["minimal"],
      },
    ],
  });
});

test("a catalogue-capped Anthropic budget does not validate a role's request level", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("anthropic/claude-sonnet-4-5#capped") },
    thinking: { small: { kind: "fixed", level: "high" } },
  });
  const catalog = catalogDouble([
    catalogModel("anthropic", "claude-sonnet-4-5", {
      package: "@opencode/ai/providers/anthropic",
      limit: { context: 200000, output: 64000 },
      variants: [
        {
          id: "capped",
          settings: { thinking: { type: "enabled", budgetTokens: 16384 } },
        },
      ],
    }),
  ]);

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.issues[0], {
    role: "small",
    field: "thinking",
    code: "thinking-variant-unproven",
  });
});

test("a malformed output limit fails the catalogue for the active axes", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/small-model") },
  });
  const catalog = rawCatalogDouble(
    catalogEnvelope([
      catalogModel("acme", "small-model", { limit: { context: 1, output: 0 } }),
    ]),
  );

  const result = await validateDelegationAxes({
    store,
    catalog,
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.issues[0], {
    role: "small",
    field: "catalog",
    code: "catalog-unavailable",
  });
});

// Evidence is asserted in protocols.test.mjs against its exact scope. Here a selection is compared on
// transport and levels, so the same proof reads the same wherever the evidence string sits.
function withoutEvidence(value) {
  if (Array.isArray(value)) {
    return value.map(withoutEvidence);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const { evidence, ...rest } = value;
  if (evidence !== undefined) {
    assert.equal(typeof evidence, "string");
    assert.notEqual(evidence, "");
  }
  return Object.fromEntries(
    Object.entries(rest).map(([key, field]) => [key, withoutEvidence(field)]),
  );
}

// Bedrock validator cases. The catalogue entry's host id differs from its protocol modelID, so a
// proof read from the protocol id or the alias would be a false positive. An unproven variant
// must fail a fixed or range requirement closed, and stay opaque with its exact ModelRef when unset.
const BEDROCK_PACKAGE = "@opencode/ai/providers/amazon-bedrock";

function bedrockAliasCatalog() {
  return catalogDouble([
    catalogModel("acme", "bedrock-gpt-oss-host", {
      modelID: "openai.gpt-oss-120b",
      package: BEDROCK_PACKAGE,
      variants: [
        {
          id: "bedrock-low",
          body: { additionalModelRequestFields: { reasoning_effort: "low" } },
        },
      ],
    }),
  ]);
}

test("a fixed or range requirement fails closed on an unproven Bedrock variant, even if its body names a level", async () => {
  const cases = [
    { thinking: { kind: "fixed", level: "low" } },
    { thinking: { kind: "range", from: "low", to: "high" } },
  ];
  for (const { thinking } of cases) {
    const double = createStorageDouble();
    const store = new PreferenceStore(double.storage);
    await store.saveDefaults({
      intensity: "normal",
      advisorMode: "off",
      roles: { small: configured("acme/bedrock-gpt-oss-host") },
      thinking: { small: thinking },
    });

    const result = await validateDelegationAxes({
      store,
      catalog: bedrockAliasCatalog(),
      sessionID: SESSION_ID,
    });

    assert.deepEqual(result.delegation, {
      status: "error",
      issues: [
        { role: "small", field: "thinking", code: "thinking-unmapped" },
        { field: "roles", code: "no-ordinary-role" },
      ],
    });
  }
});

test("unset keeps an unproven Bedrock variant opaque with its exact ModelRef, including the variant", async () => {
  const double = createStorageDouble();
  const store = new PreferenceStore(double.storage);
  await store.saveDefaults({
    intensity: "normal",
    advisorMode: "off",
    roles: { small: configured("acme/bedrock-gpt-oss-host#bedrock-low") },
  });

  const result = await validateDelegationAxes({
    store,
    catalog: bedrockAliasCatalog(),
    sessionID: SESSION_ID,
  });

  assert.deepEqual(result.delegation.roles, [
    {
      role: "small",
      model: {
        providerID: "acme",
        id: "bedrock-gpt-oss-host",
        variant: "bedrock-low",
      },
      thinking: { kind: "unset" },
    },
  ]);
});
