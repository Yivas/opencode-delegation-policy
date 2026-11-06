import assert from "node:assert/strict";
import { test } from "node:test";

import { createPreferenceEditor } from "../dist/editor/server.js";
import { PreferenceStore } from "../dist/state/store.js";

const SECRET = "private host data";
function fixture() {
  const records = new Map();
  let writes = 0;
  let rejectAfterWrite = false;
  const store = new PreferenceStore({
    async get(key) {
      return records.has(key) ? JSON.parse(records.get(key)) : undefined;
    },
    async set(key, value) {
      writes += 1;
      records.set(key, JSON.stringify(value));
      if (rejectAfterWrite) throw new Error(SECRET);
    },
    async remove(key) {
      records.delete(key);
    },
  });
  const models = [
    {
      providerID: "openai",
      id: "gpt-5",
      modelID: "gpt-5",
      enabled: true,
      package: "@opencode/ai/providers/openai",
      limit: { output: 32000 },
      variants: [
        { id: "deep", settings: { reasoningEffort: "high" } },
        { id: "opaque", settings: { reasoningEffort: "not-a-level" } },
      ],
    },
    {
      providerID: "acme",
      id: "plain",
      modelID: "plain",
      enabled: true,
      limit: { output: 32000 },
      variants: [],
      headers: { token: SECRET },
      body: { private: SECRET },
    },
    {
      providerID: "acme",
      id: "disabled",
      modelID: "disabled",
      enabled: false,
      limit: { output: 32000 },
      variants: [],
    },
  ];
  let catalogueFails = false;
  let sessionExists = true;
  const ports = {
    store,
    catalog: {
      async list() {
        if (catalogueFails) throw new Error(SECRET);
        return {
          location: { directory: SECRET },
          data: structuredClone(models),
        };
      },
    },
    sessionExists: async () => sessionExists,
  };
  return {
    store,
    models,
    editor: createPreferenceEditor(ports),
    writes: () => writes,
    failCatalogue: () => {
      catalogueFails = true;
    },
    failAfterWrite: () => {
      rejectAfterWrite = true;
    },
    deleteSession: () => {
      sessionExists = false;
    },
  };
}

test("the editor projects catalogue identifiers and proven variants, never raw host metadata", async () => {
  const f = fixture();
  const snapshot = await f.editor.read({ scope: "defaults" });
  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.models, [
    { reference: "openai/gpt-5", variants: ["deep"] },
    { reference: "acme/plain", variants: [] },
  ]);
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /private host data|temperature|reasoningEffort/,
  );
  assert.equal(snapshot.view.provenance.intensity, "default");
  assert.equal(f.writes(), 0);

  const fitting = "x".repeat(256 - "openai/gpt-5#".length);
  const tooLong = `${fitting}x`;
  f.models[0].variants.push(
    { id: fitting, settings: { reasoningEffort: "high" } },
    { id: tooLong, settings: { reasoningEffort: "high" } },
  );
  const bounded = await f.editor.read({ scope: "defaults" });
  assert.ok(bounded.models[0].variants.includes(fitting));
  assert.equal(bounded.models[0].variants.includes(tooLong), false);
  const preview = await f.editor.preview({
    scope: "defaults",
    revision: bounded.revision,
    change: {
      roles: {
        small: { kind: "configured", model: `openai/gpt-5#${fitting}` },
      },
    },
  });
  assert.equal(preview.ok, true);

  f.models.push(structuredClone(f.models[0]));
  const ambiguous = await f.editor.read({ scope: "defaults" });
  assert.equal(
    ambiguous.models.some((model) => model.reference === "openai/gpt-5"),
    false,
  );
  f.failCatalogue();
  const offline = await f.editor.read({ scope: "defaults" });
  assert.equal(offline.ok, true);
  assert.deepEqual(offline.models, []);
  assert.match(offline.text, /catalogue unavailable/);
  assert.doesNotMatch(offline.text, /private host data/);
});

test("a preview leaves storage untouched and apply requires its unchanged source revision", async () => {
  const f = fixture();
  const snapshot = await f.editor.read({ scope: "defaults" });
  const input = {
    scope: "defaults",
    revision: snapshot.revision,
    change: {
      intensity: "normal",
      roles: {
        small: { kind: "configured", model: "openai/gpt-5" },
        medium: { kind: "disabled" },
        large: { kind: "disabled" },
      },
    },
  };
  const preview = await f.editor.preview(input);
  assert.equal(preview.ok, true);
  assert.match(preview.text, /Draft preview; nothing has been saved/);
  assert.equal(f.writes(), 0);
  const saved = await f.editor.apply(input);
  assert.equal(saved.ok, true);
  assert.match(saved.text, /Defaults saved/);
  assert.equal(f.writes(), 1);
  assert.equal((await f.store.readGlobal()).preferences.intensity, "normal");
  const stale = await f.editor.apply({
    ...input,
    change: { intensity: "off" },
  });
  assert.equal(stale.ok, false);
  assert.match(stale.text, /settings changed/);
  assert.equal(f.writes(), 1);
});

test("session editor scopes cannot change role models and must still exist before apply", async () => {
  const f = fixture();
  const snapshot = await f.editor.read({
    scope: "session",
    sessionID: "ses_A",
  });
  const input = {
    scope: "session",
    sessionID: "ses_A",
    revision: snapshot.revision,
    change: { intensity: "normal" },
  };
  const refused = await f.editor.apply({
    ...input,
    change: { roles: { small: { kind: "disabled" } } },
  });
  assert.equal(refused.ok, false);
  assert.equal(f.writes(), 0);
  const saved = await f.editor.apply(input);
  assert.equal(saved.ok, true);
  assert.equal(
    (await f.store.readSession("ses_A")).provenance.intensity,
    "session",
  );
  assert.equal((await f.store.readGlobal()).preferences.intensity, "off");
  const fresh = await f.editor.read({ scope: "session", sessionID: "ses_A" });
  f.deleteSession();
  assert.equal(
    (await f.editor.apply({ ...input, revision: fresh.revision })).ok,
    false,
  );
  assert.equal(f.writes(), 1);
  assert.equal(
    (await f.editor.read({ scope: "defaults", sessionID: "ses_A" })).ok,
    false,
  );
  assert.equal((await f.editor.read({ scope: "session" })).ok, false);
});

test("a write with a lost confirmation stays uncertain and exposes no host error", async () => {
  const f = fixture();
  const snapshot = await f.editor.read({ scope: "defaults" });
  f.failAfterWrite();
  const result = await f.editor.apply({
    scope: "defaults",
    revision: snapshot.revision,
    change: { intensity: "normal" },
  });
  assert.equal(result.ok, false);
  assert.match(result.text, /Could not confirm the save/);
  assert.doesNotMatch(result.text, /private host data/);
  assert.equal((await f.store.readGlobal()).preferences.intensity, "normal");
});
