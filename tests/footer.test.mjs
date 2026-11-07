import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createFooterTracker,
  FOOTER_READ_TIMEOUT_MS,
  FOOTER_REFRESH_MS,
  footerLabel,
  parseFooterState,
  UNKNOWN_LABEL,
} from "../dist/footer.js";
import { footerState } from "../dist/footer-state.js";
import { PreferenceStore } from "../dist/state/store.js";
import { registerFooter } from "../dist/tui.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function trackerPorts() {
  const reads = [];
  const changed = [];
  const periods = [];
  const deadlines = [];
  return {
    reads,
    changed,
    periods,
    deadlines,
    ports: {
      read: (sessionID) => {
        const pending = deferred();
        reads.push({ sessionID, ...pending });
        return pending.promise;
      },
      changed: (handler) => {
        changed.push(handler);
        return () => changed.splice(changed.indexOf(handler), 1);
      },
      every: (milliseconds, handler) => {
        const entry = { milliseconds, handler };
        periods.push(entry);
        return () => periods.splice(periods.indexOf(entry), 1);
      },
      after: (milliseconds, handler) => {
        const entry = { milliseconds, handler, cancelled: false };
        deadlines.push(entry);
        return () => {
          entry.cancelled = true;
        };
      },
    },
  };
}

test("the label names both axes, and anything off-contract is unknown", () => {
  assert.equal(
    footerLabel(parseFooterState({ delegation: "AGG", advisor: "PART" })),
    "D:AGG A:PART",
  );
  for (const reply of [
    undefined,
    null,
    "D:AGG",
    { delegation: "AGG" },
    { delegation: "aggressive", advisor: "ON" },
    { delegation: "AGG", advisor: "MAYBE" },
  ]) {
    assert.equal(footerLabel(parseFooterState(reply)), UNKNOWN_LABEL);
  }
});

test("a footer shows unknown until its own session answers, and a late answer for another session is ignored", async () => {
  const { reads, ports } = trackerPorts();
  const labels = [];
  const tracker = createFooterTracker(ports, (label) => labels.push(label));

  tracker.watch("a");
  tracker.watch("b");
  assert.deepEqual(
    reads.map((read) => read.sessionID),
    ["a", "b"],
  );
  reads[1].resolve({ delegation: "NORM", advisor: "ON" });
  reads[0].resolve({ delegation: "ORCH", advisor: "OFF" });
  await flush();

  assert.deepEqual(labels, [UNKNOWN_LABEL, UNKNOWN_LABEL, "D:NORM A:ON"]);
  tracker.dispose();
});

test("a failed read says unknown instead of keeping the previous answer", async () => {
  const { reads, ports } = trackerPorts();
  const labels = [];
  const tracker = createFooterTracker(ports, (label) => labels.push(label));

  tracker.watch(undefined);
  reads[0].resolve({ delegation: "NORM", advisor: "OFF" });
  await flush();
  tracker.refresh();
  reads[1].reject(new Error("host detail"));
  await flush();

  assert.deepEqual(labels.slice(-2), ["D:NORM A:OFF", UNKNOWN_LABEL]);
  tracker.dispose();
});

test("after a change event the old state is not kept on screen while the new one is read", async () => {
  const { reads, changed, periods, ports } = trackerPorts();
  const labels = [];
  const tracker = createFooterTracker(ports, (label) => labels.push(label));

  tracker.watch("a");
  reads[0].resolve({ delegation: "NORM", advisor: "ON" });
  await flush();
  assert.equal(labels.at(-1), "D:NORM A:ON");

  // A periodic read only confirms: the label stays until the answer arrives.
  periods[0].handler();
  assert.equal(labels.at(-1), "D:NORM A:ON");
  // A change event says the label is out of date.
  changed[0]();
  assert.equal(labels.at(-1), UNKNOWN_LABEL);
  reads[2].resolve({ delegation: "AGG", advisor: "ON" });
  await flush();
  assert.equal(labels.at(-1), "D:AGG A:ON");
  tracker.dispose();
});

test("a periodic read that never answers stops the old label from looking confirmed", async () => {
  const { reads, periods, deadlines, ports } = trackerPorts();
  const labels = [];
  const tracker = createFooterTracker(ports, (label) => labels.push(label));

  tracker.watch("a");
  reads[0].resolve({ delegation: "NORM", advisor: "ON" });
  await flush();
  assert.equal(deadlines[0].cancelled, true);

  periods[0].handler();
  assert.equal(deadlines[1].milliseconds, FOOTER_READ_TIMEOUT_MS);
  assert.equal(labels.at(-1), "D:NORM A:ON");
  // The host never answers: at the deadline the label is no longer claimed.
  deadlines[1].handler();
  assert.equal(labels.at(-1), UNKNOWN_LABEL);
  // An answer after the deadline describes a moment too old to show: it is dropped.
  reads[1].resolve({ delegation: "AGG", advisor: "ON" });
  await flush();
  assert.equal(labels.at(-1), UNKNOWN_LABEL);
  // The next read can confirm again.
  periods[0].handler();
  reads[2].resolve({ delegation: "AGG", advisor: "ON" });
  await flush();
  assert.equal(labels.at(-1), "D:AGG A:ON");

  tracker.dispose();
  assert.equal(
    deadlines.every((entry) => entry.cancelled),
    true,
  );
});

test("a change event and the period read again, the same session does not, and dispose stops everything", async () => {
  const { reads, changed, periods, ports } = trackerPorts();
  const labels = [];
  const tracker = createFooterTracker(ports, (label) => labels.push(label));

  tracker.watch("a");
  tracker.watch("a");
  assert.equal(reads.length, 1);
  assert.equal(periods[0].milliseconds, FOOTER_REFRESH_MS);

  changed[0]();
  periods[0].handler();
  assert.equal(reads.length, 3);

  tracker.dispose();
  assert.equal(changed.length, 0);
  assert.equal(periods.length, 0);
  reads[2].resolve({ delegation: "NORM", advisor: "ON" });
  await flush();
  assert.equal(labels.includes("D:NORM A:ON"), false);
});

function storageDouble() {
  const records = new Map();
  return {
    async get(key) {
      const text = records.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    async set(key, value) {
      records.set(key, JSON.stringify(value));
    },
    async remove(key) {
      records.delete(key);
    },
  };
}

const catalog = {
  async list() {
    return {
      location: { directory: "/synthetic" },
      data: [
        {
          id: "small-model",
          modelID: "small-model",
          providerID: "acme",
          name: "small-model",
          package: "@opencode/ai/providers/groq",
          enabled: true,
          limit: { context: 200000, output: 32000 },
          variants: [],
        },
      ],
    };
  },
};

const REGISTERED = [
  { id: "ocv2-small", model: { providerID: "acme", id: "small-model" } },
  { id: "ocv2-advisor-1", model: { providerID: "acme", id: "small-model" } },
  { id: "ocv2-advisor-2", model: { providerID: "acme", id: "small-model" } },
];

async function configuredStore() {
  const store = new PreferenceStore(storageDouble());
  await store.saveDefaults({
    intensity: "orchestrator",
    advisorMode: "on",
    roles: {
      small: { kind: "configured", model: "acme/small-model" },
      medium: { kind: "disabled" },
      large: { kind: "disabled" },
    },
    advisors: {
      kind: "configured",
      models: ["acme/small-model", "acme/small-model"],
    },
  });
  return store;
}

test("the server state follows what the injection would attach", async () => {
  const store = await configuredStore();
  const ports = (agents) => ({
    store,
    catalog,
    agents: async () => agents,
    parentOf: async () => undefined,
  });

  assert.deepEqual(await footerState(ports(REGISTERED), undefined), {
    delegation: "ORCH",
    advisor: "ON",
  });
  // The second Advisor never reached the host: the axis is partial, as the policy is.
  assert.deepEqual(
    await footerState(ports(REGISTERED.slice(0, 2)), undefined),
    { delegation: "ORCH", advisor: "PART" },
  );
  // A session override is read for that session only.
  await store.applySession("s", { intensity: "normal" });
  assert.deepEqual(await footerState(ports(REGISTERED), "s"), {
    delegation: "NORM",
    advisor: "ON",
  });

  const unreadableAgents = {
    store,
    catalog,
    agents: async () => {
      throw new Error("host detail");
    },
    parentOf: async () => undefined,
  };
  assert.deepEqual(await footerState(unreadableAgents, undefined), {
    delegation: "ERR",
    advisor: "ERR",
  });

  const lostSession = {
    ...ports(REGISTERED),
    parentOf: async () => {
      throw new Error("host detail");
    },
  };
  assert.deepEqual(await footerState(lostSession, "s"), {
    delegation: "ERR",
    advisor: "ERR",
  });
});

test("at home the footer describes the next session, not only the defaults", async () => {
  const store = await configuredStore();
  const ports = {
    store,
    catalog,
    agents: async () => REGISTERED,
    parentOf: async () => undefined,
  };

  await store.saveNext({ intensity: "normal" });
  assert.deepEqual(await footerState(ports, undefined), {
    delegation: "NORM",
    advisor: "ON",
  });

  await store.saveNext({ intensity: "off" });
  assert.deepEqual(await footerState(ports, undefined), {
    delegation: "OFF",
    advisor: "ON",
  });
});

test("the footer is appended to the host's prompt footer, never replacing it, and released on cleanup", async () => {
  const claims = [];
  let released = 0;
  const slot = (claim) => {
    claims.push(claim);
    return () => {
      released += 1;
    };
  };
  const render = () => "view";
  const cleanup = registerFooter(
    { slot, ports: trackerPorts().ports },
    async () => ({ footerRender: () => render }),
  );
  await flush();

  assert.equal(claims.length, 1);
  assert.equal(claims[0].append, "prompt.footer.status");
  assert.equal(claims[0].replace, undefined);
  assert.equal(claims[0].render, render);
  cleanup();
  assert.equal(released, 1);
});

test("a view that cannot load, or loads after cleanup, claims nothing", async () => {
  const claims = [];
  const slot = (claim) => {
    claims.push(claim);
    return () => {};
  };
  registerFooter({ slot, ports: trackerPorts().ports }, async () => {
    throw new Error("runtime not provided");
  });
  const late = deferred();
  const cleanup = registerFooter(
    { slot, ports: trackerPorts().ports },
    () => late.promise,
  );
  cleanup();
  late.resolve({ footerRender: () => () => "view" });
  await flush();

  assert.equal(claims.length, 0);
  // A host that refuses the claim leaves no unhandled rejection behind.
  registerFooter(
    {
      slot: () => {
        throw new Error("slot refused");
      },
      ports: trackerPorts().ports,
    },
    async () => ({ footerRender: () => () => "view" }),
  );
  await flush();
  // Turned off by the plugin's options: the view is not even loaded.
  let loaded = false;
  registerFooter(
    { enabled: false, slot, ports: trackerPorts().ports },
    async () => {
      loaded = true;
      return { footerRender: () => () => "view" };
    },
  );
  await flush();
  assert.equal(loaded, false);
  // A host without slots gets a cleanup that does nothing.
  assert.equal(
    typeof registerFooter({ ports: trackerPorts().ports }),
    "function",
  );
});

test("only the footer view imports the terminal runtime, and the TUI entry loads it on demand", async () => {
  const imports = async (file) => {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    return [
      ...source.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g),
    ].map((match) => match[1]);
  };
  assert.deepEqual((await imports("../dist/footer-view.js")).sort(), [
    "./footer.js",
    "@opentui/solid/jsx-runtime",
    "solid-js",
  ]);
  for (const file of [
    "../dist/tui.js",
    "../dist/footer.js",
    "../dist/rpc.js",
  ]) {
    for (const specifier of await imports(file)) {
      assert.ok(specifier.startsWith("./"), `${file} imports ${specifier}`);
    }
  }
});
