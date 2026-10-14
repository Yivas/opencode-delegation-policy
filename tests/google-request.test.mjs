import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGoogleOwnedRequestHook as createGoogleOwnedRequestHookImpl,
  GoogleOwnedRequestError,
} from "../dist/thinking/google-request.js";

// Synthetic fixtures only. Expected controls come from the Pi recipe values in google.ts, not from the component.
// Requests are local Request objects. The ownership port is a double. No SDK, host, session, network or inference runs.

const GENAI = "@opencode/ai/providers/google";
const VERTEX = "@opencode/ai/providers/google-vertex";
const URL_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse";
const KEY = "synthetic-key-value";
const MARKER = "synthetic-secret-marker-7f3a";
const CONTENTS = [{ role: "user", parts: [{ text: "synthetic prompt" }] }];
const PRO_HIGH = { includeThoughts: true, thinkingBudget: 32768 };

const PRO_MODEL = {
  providerID: "google",
  id: "gemini-2.5-pro",
  variant: "owned-high",
};
// Test-only read limits, passed explicitly to every hook. They are not a production default.
const TEST_READ_POLICY = Object.freeze({ maxBytes: 1 << 20, timeoutMs: 5000 });
const TEST_WAIT_POLICY = Object.freeze({ timeoutMs: 5000 });

function createGoogleOwnedRequestHook(...args) {
  if (args.length === 1) {
    return createGoogleOwnedRequestHookImpl(
      args[0],
      TEST_READ_POLICY,
      TEST_WAIT_POLICY,
    );
  }
  if (args.length === 2) {
    return createGoogleOwnedRequestHookImpl(args[0], args[1], TEST_WAIT_POLICY);
  }
  return createGoogleOwnedRequestHookImpl(...args);
}

const BINDING = {
  registrationToken: "token-1",
  epoch: 3,
  roleAgentID: "ocv2-small",
  sessionID: "child-1",
  parentSessionID: "parent-1",
  model: PRO_MODEL,
  packageName: GENAI,
  protocolModelID: "gemini-2.5-pro",
  level: "high",
  authBodyIndependent: true,
  authEvidence: "synthetic fixture: Auth.header x-goog-api-key",
};

function packet(generationConfig, extra = {}) {
  return {
    contents: structuredClone(CONTENTS),
    ...(generationConfig === undefined ? {} : { generationConfig }),
    ...extra,
  };
}

function requestFor(
  value,
  { method = "POST", headers, signal, url = URL_BASE } = {},
) {
  const init = {
    method,
    headers: headers ?? {
      "content-type": "application/json",
      "x-goog-api-key": KEY,
    },
    signal,
  };
  if (method !== "GET") {
    init.body = typeof value === "string" ? value : JSON.stringify(value);
  }
  return new Request(url, init);
}

function eventFor(request, overrides = {}) {
  return {
    sessionID: "child-1",
    agent: "ocv2-small",
    kind: "primary",
    model: { ...PRO_MODEL },
    request,
    ...overrides,
  };
}

async function bodyOf(request) {
  return JSON.parse(await request.clone().text());
}

function countClones(request) {
  const counter = { calls: 0 };
  const original = request.clone.bind(request);
  Object.defineProperty(request, "clone", {
    value: () => {
      counter.calls += 1;
      return original();
    },
  });
  return counter;
}

// Ownership double. `results` is a classification, or an array returned in call order.
function ownershipOf(results, state = { current: true }) {
  const queue = Array.isArray(results) ? [...results] : undefined;
  const counters = { classify: 0 };
  return {
    counters,
    state,
    classify: async () => {
      counters.classify += 1;
      return queue === undefined ? results : queue.shift();
    },
    isCurrent: () => state.current,
  };
}

const owned = (binding) => ({ kind: "owned", binding });
const UNOWNED = { kind: "unowned" };
const hookFor = (binding, state) =>
  createGoogleOwnedRequestHook(
    ownershipOf(owned(binding), state),
    TEST_READ_POLICY,
  );

// Host-shaped dispatch: hooks run and await in order. A throw stops the trigger before the request handler.
async function trigger(event, hooks, handler) {
  for (const hook of hooks) {
    await hook(event);
  }
  return handler(event.request);
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GoogleOwnedRequestError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

test("the planned Pi budget replaces the native fit, and the output cap is kept as it is", async () => {
  const event = eventFor(
    requestFor(
      packet({
        maxOutputTokens: 40000,
        thinkingConfig: { includeThoughts: true, thinkingBudget: 20000 },
      }),
    ),
  );
  await hookFor(BINDING)(event);

  assert.deepEqual(
    await bodyOf(event.request),
    packet({ maxOutputTokens: 40000, thinkingConfig: PRO_HIGH }),
  );
});

test("an inherited thinkingLevel is removed, since the whole thinkingConfig subtree is replaced", async () => {
  const event = eventFor(
    requestFor(
      packet({
        maxOutputTokens: 4096,
        thinkingConfig: { includeThoughts: true, thinkingLevel: "LOW" },
      }),
    ),
  );
  await hookFor(BINDING)(event);

  const thinking = (await bodyOf(event.request)).generationConfig
    .thinkingConfig;
  assert.deepEqual(thinking, PRO_HIGH);
  assert.equal(Object.hasOwn(thinking, "thinkingLevel"), false);
});

test("off writes exactly {thinkingBudget: 0} and deletes an inherited includeThoughts", async () => {
  const event = eventFor(
    requestFor(
      packet({
        thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
      }),
    ),
  );
  await hookFor({ ...BINDING, level: "off" })(event);

  assert.deepEqual(
    (await bodyOf(event.request)).generationConfig.thinkingConfig,
    { thinkingBudget: 0 },
  );
});

test("the discrete wire is exact for flash minimal on genai and vertex, and for pro minimal budget 128", async () => {
  const flash = {
    ...BINDING,
    protocolModelID: "gemini-3-flash-preview",
    model: { ...PRO_MODEL, id: "gemini-3-flash-preview" },
    level: "minimal",
  };
  const genai = eventFor(requestFor(packet({ thinkingConfig: {} })), {
    model: flash.model,
  });
  await hookFor(flash)(genai);
  assert.deepEqual(
    (await bodyOf(genai.request)).generationConfig.thinkingConfig,
    { includeThoughts: true, thinkingLevel: "MINIMAL" },
  );

  const vertexModel = {
    providerID: "google-vertex",
    id: "gemini-3-flash-preview",
    variant: "owned-high",
  };
  const vertex = eventFor(requestFor(packet({ thinkingConfig: {} })), {
    model: vertexModel,
  });
  await hookFor({ ...flash, model: vertexModel, packageName: VERTEX })(vertex);
  assert.deepEqual(
    (await bodyOf(vertex.request)).generationConfig.thinkingConfig,
    { includeThoughts: true, thinkingLevel: "MINIMAL" },
  );

  const minimalPro = eventFor(requestFor(packet({})));
  await hookFor({ ...BINDING, level: "minimal" })(minimalPro);
  assert.deepEqual(
    (await bodyOf(minimalPro.request)).generationConfig.thinkingConfig,
    { includeThoughts: true, thinkingBudget: 128 },
  );
});

test("a dynamic model writes the automatic budget -1 for a positive level", async () => {
  const model = {
    providerID: "google",
    id: "gemini-2.5-computer-use-preview-10-2025",
    variant: "owned-high",
  };
  const binding = {
    ...BINDING,
    model,
    protocolModelID: model.id,
    level: "low",
  };
  const event = eventFor(requestFor(packet({})), { model });
  await hookFor(binding)(event);

  assert.deepEqual(
    (await bodyOf(event.request)).generationConfig.thinkingConfig,
    { includeThoughts: true, thinkingBudget: -1 },
  );
});

test("a level with a null or unsupported Pi entry is refused before any body is read", async () => {
  const cases = [
    { protocolModelID: "gemini-3.1-pro-preview", level: "minimal" },
    { protocolModelID: "gemma-4-31b-it", level: "low" },
    { protocolModelID: "gemini-2.5-pro", level: "xhigh" },
    { protocolModelID: "gemini-2.5-pro", level: "max" },
  ];
  for (const { protocolModelID, level } of cases) {
    const request = requestFor(packet({}));
    const clones = countClones(request);
    const model = { ...PRO_MODEL, id: protocolModelID };
    const event = eventFor(request, { model });
    await rejectsWith(
      hookFor({ ...BINDING, model, protocolModelID, level })(event),
      "binding-unsupported",
    );
    assert.equal(clones.calls, 0, `${protocolModelID} ${level}`);
    assert.equal(event.request, request);
  }
});

test("an unowned request keeps its identity and its body is never read, even when malformed", async () => {
  const request = requestFor("{");
  const clones = countClones(request);
  const event = eventFor(request);
  await createGoogleOwnedRequestHook(
    ownershipOf(UNOWNED),
    TEST_READ_POLICY,
  )(event);

  assert.equal(event.request, request);
  assert.equal(clones.calls, 0);
});

test("a native inline override outside an owned selection is not rewritten", async () => {
  const native = packet({
    thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" },
  });
  const request = requestFor(native);
  const event = eventFor(request, {
    model: { ...PRO_MODEL, variant: "user-inline" },
  });
  await createGoogleOwnedRequestHook(
    ownershipOf(UNOWNED),
    TEST_READ_POLICY,
  )(event);

  assert.equal(event.request, request);
  assert.deepEqual(await bodyOf(request), native);
});

test("a stale binding fails sanitized, keeps the request and blocks the handler through the trigger", async () => {
  const request = requestFor(packet({}));
  const event = eventFor(request);
  const hook = hookFor(BINDING, { current: false });
  const handled = [];

  await rejectsWith(
    trigger(event, [hook], (r) => handled.push(r)),
    "binding-stale",
  );
  assert.equal(event.request, request);
  assert.equal(handled.length, 0);
});

test("each inconsistent binding field is a mismatch and never assigns the request", async () => {
  const cases = [
    { name: "agent", event: { agent: "other-agent" } },
    { name: "session", event: { sessionID: "other-child" } },
    { name: "parent empty", binding: { parentSessionID: "" } },
    { name: "parent equals child", binding: { parentSessionID: "child-1" } },
    { name: "variant", event: { model: { ...PRO_MODEL, variant: "other" } } },
    {
      name: "provider",
      event: { model: { ...PRO_MODEL, providerID: "google-vertex" } },
    },
    {
      name: "model id",
      event: { model: { ...PRO_MODEL, id: "gemini-2.5-flash" } },
    },
  ];
  for (const { name, event: overrides = {}, binding = {} } of cases) {
    const request = requestFor(packet({}));
    const event = eventFor(request, overrides);
    await rejectsWith(
      hookFor({ ...BINDING, ...binding })(event),
      "binding-mismatch",
    );
    assert.equal(event.request, request, name);
  }
});

test("a package outside the Google pair or an empty registration token is refused before the body is read", async () => {
  const request = requestFor(packet({}));
  const clones = countClones(request);
  const event = eventFor(request);
  await rejectsWith(
    hookFor({ ...BINDING, packageName: "@opencode/ai/providers/anthropic" })(
      event,
    ),
    "binding-unsupported",
  );
  await rejectsWith(
    hookFor({ ...BINDING, registrationToken: "" })(event),
    "binding-stale",
  );
  assert.equal(clones.calls, 0);
  assert.equal(event.request, request);
});

test("a body-bound or unverified auth is refused before the body is read", async () => {
  const request = requestFor(packet({}));
  const clones = countClones(request);
  const event = eventFor(request);
  await rejectsWith(
    hookFor({ ...BINDING, authBodyIndependent: false })(event),
    "auth-unverified",
  );
  await rejectsWith(
    hookFor({ ...BINDING, authEvidence: "" })(event),
    "auth-unverified",
  );
  assert.equal(clones.calls, 0);
  assert.equal(event.request, request);
});

test("a present content-length is refused as stale, and GET or non-JSON requests are shape rejections", async () => {
  const withLength = requestFor(packet({}), {
    headers: { "content-type": "application/json", "content-length": "12" },
  });
  const lengthEvent = eventFor(withLength);
  await rejectsWith(hookFor(BINDING)(lengthEvent), "stale-content-length");
  assert.equal(lengthEvent.request, withLength);

  const get = requestFor(undefined, { method: "GET" });
  const getEvent = eventFor(get);
  await rejectsWith(hookFor(BINDING)(getEvent), "shape-rejected");
  assert.equal(getEvent.request, get);

  const text = requestFor(packet({}), {
    headers: { "content-type": "text/plain" },
  });
  const textEvent = eventFor(text);
  await rejectsWith(hookFor(BINDING)(textEvent), "shape-rejected");
  assert.equal(textEvent.request, text);
});

test("a present output cap that is not a finite JSON number is refused, and an absent one stays absent", async () => {
  for (const maxOutputTokens of [null, "4096", true, [1], { value: 1 }]) {
    const request = requestFor(packet({ maxOutputTokens }));
    const event = eventFor(request);
    await rejectsWith(hookFor(BINDING)(event), "cap-invalid");
    assert.equal(event.request, request);
  }

  const absent = eventFor(requestFor(packet({ temperature: 0.2 })));
  await hookFor(BINDING)(absent);
  const generationConfig = (await bodyOf(absent.request)).generationConfig;
  assert.equal(Object.hasOwn(generationConfig, "maxOutputTokens"), false);
  assert.equal(generationConfig.temperature, 0.2);
});

test("a finite output cap is copied exactly, including zero and negative values", async () => {
  for (const maxOutputTokens of [0, -10, 40000]) {
    const event = eventFor(requestFor(packet({ maxOutputTokens })));
    await hookFor(BINDING)(event);
    const generationConfig = (await bodyOf(event.request)).generationConfig;
    assert.equal(generationConfig.maxOutputTokens, maxOutputTokens);
    assert.deepEqual(generationConfig.thinkingConfig, PRO_HIGH);
  }
});

test("a body that cannot be read or parsed fails with a sanitized error and keeps the request", async () => {
  const unreadable = requestFor(packet({}));
  Object.defineProperty(unreadable, "clone", {
    value: () => {
      throw new TypeError(MARKER);
    },
  });
  const unreadableEvent = eventFor(unreadable);
  await assert.rejects(hookFor(BINDING)(unreadableEvent), (error) => {
    assert.equal(error.code, "read-failed");
    assert.equal(error.message.includes(MARKER), false);
    return true;
  });
  assert.equal(unreadableEvent.request, unreadable);

  const malformed = requestFor(`not-json-${MARKER}`);
  const malformedEvent = eventFor(malformed);
  await assert.rejects(hookFor(BINDING)(malformedEvent), (error) => {
    assert.equal(error.code, "parse-failed");
    assert.equal(error.message.includes(MARKER), false);
    return true;
  });
  assert.equal(malformedEvent.request, malformed);
});

test("a packet outside the native shape is a shape rejection", async () => {
  for (const value of [[], { generationConfig: {} }, packet([])]) {
    const request = requestFor(value);
    const event = eventFor(request);
    await rejectsWith(hookFor(BINDING)(event), "shape-rejected");
    assert.equal(event.request, request);
  }
});

test("every non-thinking field survives the rewrite, including media, signatures, tools and system", async () => {
  const native = packet(
    {
      maxOutputTokens: 40000,
      temperature: 0.4,
      thinkingConfig: { includeThoughts: true, thinkingBudget: 20000 },
    },
    {
      systemInstruction: { parts: [{ text: "synthetic system" }] },
      tools: [
        {
          functionDeclarations: [
            { name: "lookup", parametersJsonSchema: { type: "object" } },
          ],
        },
      ],
      labels: { purpose: "synthetic" },
    },
  );
  native.contents = [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/png", data: "AAAA" } },
        { text: "with signature", thoughtSignature: "synthetic-signature" },
      ],
    },
  ];
  const event = eventFor(requestFor(native));
  await hookFor(BINDING)(event);

  const expected = structuredClone(native);
  expected.generationConfig.thinkingConfig = PRO_HIGH;
  assert.deepEqual(await bodyOf(event.request), expected);
});

test("the method, URL and headers, including the API key header, are rebuilt exactly", async () => {
  const event = eventFor(requestFor(packet({})));
  const before = event.request;
  await hookFor(BINDING)(event);

  assert.notEqual(event.request, before);
  assert.equal(event.request.method, "POST");
  assert.equal(event.request.url, before.url);
  assert.deepEqual(
    [...event.request.headers.entries()],
    [...before.headers.entries()],
  );
  assert.equal(event.request.headers.get("x-goog-api-key"), KEY);
});

test("the rebuilt request follows the original abort signal through its own signal object", async () => {
  const controller = new AbortController();
  const event = eventFor(requestFor(packet({}), { signal: controller.signal }));
  await hookFor(BINDING)(event);

  assert.notEqual(event.request.signal, controller.signal);
  assert.equal(event.request.signal.aborted, false);
  controller.abort(new Error("synthetic"));
  assert.equal(event.request.signal.aborted, true);
});

test("a repeated invocation on the rewritten request keeps its identity and its exact control", async () => {
  const event = eventFor(
    requestFor(
      packet({
        thinkingConfig: { includeThoughts: true, thinkingBudget: 20000 },
      }),
    ),
  );
  const hook = hookFor(BINDING);

  await hook(event);
  const once = event.request;
  await hook(event);

  assert.equal(event.request, once);
  assert.deepEqual(
    (await bodyOf(event.request)).generationConfig.thinkingConfig,
    PRO_HIGH,
  );
});

test("a later peer that resets the budget after the callback leaves a mismatch against Pi, which is a residual", async () => {
  const event = eventFor(requestFor(packet({ maxOutputTokens: 40000 })));
  const peer = async (input) => {
    const body = await bodyOf(input.request);
    body.generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: 20000,
    };
    input.request = new Request(input.request.url, {
      method: input.request.method,
      headers: new Headers(input.request.headers),
      body: JSON.stringify(body),
    });
  };
  const handled = [];

  await trigger(event, [hookFor(BINDING), peer], (r) => {
    handled.push(r);
    return r;
  });

  const wire = (await bodyOf(handled[0])).generationConfig.thinkingConfig;
  assert.deepEqual(wire, { includeThoughts: true, thinkingBudget: 20000 });
  assert.notDeepEqual(wire, PRO_HIGH);
});

test("a disposal while the body read is pending blocks the assignment, and a fresh retry succeeds", async () => {
  const state = { current: true };
  const ownership = ownershipOf(owned(BINDING), state);
  const hook = createGoogleOwnedRequestHook(ownership, TEST_READ_POLICY);
  const native = JSON.stringify(packet({ maxOutputTokens: 40000 }));

  let cloneCalls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = {
    method: "POST",
    url: URL_BASE,
    headers: new Headers({
      "content-type": "application/json",
      "x-goog-api-key": KEY,
    }),
    signal: new AbortController().signal,
    clone: () => {
      cloneCalls += 1;
      return {
        body: new ReadableStream({
          pull: async (controller) => {
            await gate;
            controller.enqueue(new TextEncoder().encode(native));
            controller.close();
          },
        }),
      };
    },
  };
  const event = eventFor(pending);
  const running = hook(event);
  while (cloneCalls === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  state.current = false;
  release();

  await rejectsWith(running, "binding-stale");
  assert.equal(event.request, pending);

  state.current = true;
  const retry = eventFor(requestFor(packet({ maxOutputTokens: 40000 })));
  await hook(retry);
  assert.deepEqual(
    (await bodyOf(retry.request)).generationConfig.thinkingConfig,
    PRO_HIGH,
  );
  assert.ok(ownership.counters.classify >= 4, "every call classifies afresh");
});

test("a binding whose token changes while the body is read is a mismatch, and nothing is assigned", async () => {
  const drifted = { ...BINDING, registrationToken: "token-2" };
  const event = eventFor(requestFor(packet({})));
  await rejectsWith(
    createGoogleOwnedRequestHook(
      ownershipOf([owned(BINDING), owned(drifted)]),
      TEST_READ_POLICY,
    )(event),
    "binding-mismatch",
  );
  assert.deepEqual(await bodyOf(event.request), packet({}));
});

test("creating the hook registers nothing and classifies nothing", () => {
  const ownership = ownershipOf(owned(BINDING));
  createGoogleOwnedRequestHook(ownership, TEST_READ_POLICY, TEST_WAIT_POLICY);
  assert.equal(ownership.counters.classify, 0);
});

test("the explicit wait policy is validated and captured without invoking getters", async () => {
  let reads = 0;
  const accessor = { timeoutMs: 10 };
  Object.defineProperty(accessor, "timeoutMs", {
    get() {
      reads += 1;
      return 10;
    },
  });
  const invalid = [
    null,
    [],
    {},
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: 1.5 },
    { timeoutMs: Number.NaN },
    { timeoutMs: 2147483648 },
    Object.create({ timeoutMs: 10 }),
    accessor,
  ];
  assert.throws(
    () =>
      createGoogleOwnedRequestHookImpl(ownershipOf(UNOWNED), TEST_READ_POLICY),
    (error) => error.code === "wait-policy-invalid",
  );
  for (const waitPolicy of invalid) {
    assert.throws(
      () =>
        createGoogleOwnedRequestHook(
          ownershipOf(UNOWNED),
          TEST_READ_POLICY,
          waitPolicy,
        ),
      (error) => error.code === "wait-policy-invalid",
    );
  }
  assert.equal(reads, 0);

  const waitPolicy = { timeoutMs: 100 };
  const hook = createGoogleOwnedRequestHook(
    ownershipOf(UNOWNED),
    TEST_READ_POLICY,
    waitPolicy,
  );
  waitPolicy.timeoutMs = 1;
  const request = requestFor("not-json");
  await hook(eventFor(request));
  assert.equal(request.bodyUsed, false);
});

test("the wait timer uses only the deadline remaining after setup", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  let scheduledDelay;
  let expire;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    expire = callback;
    scheduledDelay = delay;
    return 1;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});

  const request = requestFor(packet({}));
  const signal = request.signal;
  Object.defineProperty(request, "signal", {
    get() {
      now = 5;
      return signal;
    },
  });
  const event = eventFor(request);
  let classifyCalls = 0;
  const hook = createGoogleOwnedRequestHook(
    {
      classify: () => {
        classifyCalls += 1;
        return new Promise(() => {});
      },
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    { timeoutMs: 10 },
  );
  const running = hook(event);

  assert.equal(scheduledDelay, 5);
  assert.equal(classifyCalls, 1);
  now = 10;
  expire();
  await rejectsWith(running, "wait-timeout");
  assert.equal(event.request, request);

  now = 0;
  scheduledDelay = undefined;
  const expiredRequest = requestFor(packet({}));
  const expiredSignal = expiredRequest.signal;
  Object.defineProperty(expiredRequest, "signal", {
    get() {
      now = 11;
      return expiredSignal;
    },
  });
  const expiredEvent = eventFor(expiredRequest);
  const expiredHeaders = [...expiredRequest.headers.entries()];
  const alreadyExpired = hook(expiredEvent);
  assert.equal(scheduledDelay, undefined);
  await rejectsWith(alreadyExpired, "wait-timeout");
  assert.equal(classifyCalls, 1);
  assert.equal(expiredEvent.request, expiredRequest);
  assert.equal(expiredRequest.bodyUsed, false);
  assert.deepEqual([...expiredRequest.headers.entries()], expiredHeaders);
  assert.deepEqual(await bodyOf(expiredRequest), packet({}));
});

test("an already-aborted request skips ownership classification", async () => {
  const controller = new AbortController();
  controller.abort();
  const request = requestFor(packet({}), { signal: controller.signal });
  const clones = countClones(request);
  const headers = [...request.headers.entries()];
  const event = eventFor(request);
  let classifyCalls = 0;
  const hook = createGoogleOwnedRequestHook(
    {
      classify: () => {
        classifyCalls += 1;
        return UNOWNED;
      },
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    TEST_WAIT_POLICY,
  );

  await rejectsWith(hook(event), "wait-aborted");
  assert.equal(classifyCalls, 0);
  assert.equal(clones.calls, 0);
  assert.equal(event.request, request);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual([...request.headers.entries()], headers);
  assert.deepEqual(await bodyOf(request), packet({}));
});

test("an expired binding snapshot skips the ownership lifetime callback", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const request = requestFor(packet({}));
  const headers = [...request.headers.entries()];
  const event = eventFor(request);
  let currentCalls = 0;
  const binding = { ...BINDING };
  Object.defineProperty(binding, "registrationToken", {
    get() {
      now = 11;
      return BINDING.registrationToken;
    },
  });
  const hook = createGoogleOwnedRequestHook(
    {
      classify: () => owned(binding),
      isCurrent: () => {
        currentCalls += 1;
        return true;
      },
    },
    TEST_READ_POLICY,
    { timeoutMs: 10 },
  );

  await rejectsWith(hook(event), "wait-timeout");
  assert.equal(currentCalls, 0);
  assert.equal(event.request, request);
  assert.equal(request.bodyUsed, false);
  assert.deepEqual([...request.headers.entries()], headers);
  assert.deepEqual(await bodyOf(request), packet({}));
});

test("fractional remaining time is rounded up when scheduling the wait deadline", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  let scheduledDelay;
  t.mock.method(globalThis, "setTimeout", (_callback, delay) => {
    scheduledDelay = delay;
    return 1;
  });
  t.mock.method(globalThis, "clearTimeout", () => {});

  const request = requestFor(packet({}));
  const signal = request.signal;
  Object.defineProperty(request, "signal", {
    get() {
      now = 5.5;
      return signal;
    },
  });
  const event = eventFor(request);
  let classifyCalls = 0;
  const hook = createGoogleOwnedRequestHook(
    {
      classify: () => {
        classifyCalls += 1;
        return UNOWNED;
      },
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    { timeoutMs: 10 },
  );

  await hook(event);
  assert.equal(classifyCalls, 1);
  assert.equal(scheduledDelay, 5);
  assert.equal(event.request, request);
  assert.equal(request.bodyUsed, false);
});

test("a never-settling first classification is retired before any body read", async () => {
  const request = requestFor(packet({}));
  const clones = countClones(request);
  const event = eventFor(request);
  const hook = createGoogleOwnedRequestHook(
    { classify: () => new Promise(() => {}), isCurrent: () => true },
    TEST_READ_POLICY,
    { timeoutMs: 20 },
  );
  await rejectsWith(hook(event), "wait-timeout");
  assert.equal(clones.calls, 0);
  assert.equal(event.request, request);
});

test("a never-settling second classification is retired without assigning a request", async () => {
  let calls = 0;
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  const hook = createGoogleOwnedRequestHook(
    {
      classify: () => {
        calls += 1;
        return calls === 1 ? owned(BINDING) : new Promise(() => {});
      },
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    { timeoutMs: 30 },
  );
  await rejectsWith(hook(event), "wait-timeout");
  assert.equal(calls, 2);
  assert.equal(event.request, request);
});

test("the whole-hook timeout stops a pending body read without replacing the caller signal", async () => {
  let cancelCalls = 0;
  const request = streamingRequest(
    lazyStream({
      cancel: () => {
        cancelCalls += 1;
      },
    }),
  );
  const event = eventFor(request);
  const hook = createGoogleOwnedRequestHook(
    ownershipOf(owned(BINDING)),
    { maxBytes: 1024, timeoutMs: 5000 },
    { timeoutMs: 20 },
  );
  await rejectsWith(hook(event), "wait-timeout");
  await sleep(0);
  assert.equal(cancelCalls, 1);
  assert.equal(event.request, request);
  assert.equal(request.signal.aborted, false);
});

test("one invocation timing out does not retire a parallel invocation using the same hook", async () => {
  const hook = createGoogleOwnedRequestHook(
    {
      classify: (event) =>
        event.sessionID === "slow" ? new Promise(() => {}) : UNOWNED,
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    { timeoutMs: 20 },
  );
  const slowRequest = requestFor(packet({}));
  const fastRequest = requestFor("not-json");
  const slowEvent = eventFor(slowRequest, { sessionID: "slow" });
  const fastEvent = eventFor(fastRequest, { sessionID: "fast" });

  const slow = rejectsWith(hook(slowEvent), "wait-timeout");
  await hook(fastEvent);
  await slow;
  assert.equal(slowEvent.request, slowRequest);
  assert.equal(fastEvent.request, fastRequest);
});

test("the hook shares one deadline across classification and reading", async () => {
  let calls = 0;
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  const hook = createGoogleOwnedRequestHook(
    {
      classify: async () => {
        calls += 1;
        if (calls === 1) await sleep(25);
        if (calls === 2) await sleep(25);
        return owned(BINDING);
      },
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    { timeoutMs: 40 },
  );
  await rejectsWith(hook(event), "wait-timeout");
  assert.equal(calls, 2);
  assert.equal(event.request, request);
});

test("abort during either ownership wait retires the invocation", async () => {
  for (const abortAt of [1, 2]) {
    const controller = new AbortController();
    const request = requestFor(packet({}), { signal: controller.signal });
    const event = eventFor(request);
    let calls = 0;
    const hook = createGoogleOwnedRequestHook(
      {
        classify: () => {
          calls += 1;
          if (calls === abortAt) {
            setImmediate(() => controller.abort());
            return new Promise(() => {});
          }
          return owned(BINDING);
        },
        isCurrent: () => true,
      },
      TEST_READ_POLICY,
      { timeoutMs: 1000 },
    );
    await rejectsWith(hook(event), "wait-aborted");
    assert.equal(calls, abortAt);
    assert.equal(event.request, request);
  }
});

test("late classification resolution or rejection after timeout cannot write or become unhandled", async () => {
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", listener);
  try {
    for (const rejectLate of [false, true]) {
      let settle;
      const request = requestFor(packet({}));
      const event = eventFor(request);
      const hook = createGoogleOwnedRequestHook(
        {
          classify: () =>
            new Promise((resolve, reject) => {
              settle = rejectLate ? reject : resolve;
            }),
          isCurrent: () => true,
        },
        TEST_READ_POLICY,
        { timeoutMs: 10 },
      );
      await rejectsWith(hook(event), "wait-timeout");
      if (rejectLate) settle(new Error(SYNTHETIC));
      else settle(owned(BINDING));
      await sleep(10);
      assert.equal(event.request, request);
    }
    assert.equal(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("a replaced request remains current when classification times out", async () => {
  let settle;
  const request = requestFor(packet({}));
  const replacement = requestFor(packet({ maxOutputTokens: 1234 }));
  const event = eventFor(request);
  const hook = createGoogleOwnedRequestHook(
    {
      classify: () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    { timeoutMs: 10 },
  );
  await rejectsWith(hook(event), "wait-timeout");
  event.request = replacement;
  settle(owned(BINDING));
  await sleep(10);
  assert.equal(event.request, replacement);
});

test("a synchronous classifier that advances past the deadline cannot proceed to body access", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const request = requestFor(packet({}));
  const clones = countClones(request);
  const hook = createGoogleOwnedRequestHook(
    {
      classify: () => {
        now = 11;
        return owned(BINDING);
      },
      isCurrent: () => true,
    },
    TEST_READ_POLICY,
    { timeoutMs: 10 },
  );
  await rejectsWith(hook(eventFor(request)), "wait-timeout");
  assert.equal(clones.calls, 0);
});

test("a thrown owned error stops the trigger, so the request handler is never reached", async () => {
  const request = requestFor(packet({}));
  const event = eventFor(request);
  const handled = [];
  await rejectsWith(
    trigger(event, [hookFor({ ...BINDING, authBodyIndependent: false })], (r) =>
      handled.push(r),
    ),
    "auth-unverified",
  );
  assert.equal(handled.length, 0);
});

// A port that returns one mutable binding object, and changes it in place on every call after the first.
function sharedBindingOwnership(mutate) {
  const shared = { ...BINDING, model: { ...BINDING.model } };
  let calls = 0;
  return {
    classify: async () => {
      calls += 1;
      if (calls > 1) {
        mutate(shared);
      }
      return owned(shared);
    },
    isCurrent: () => true,
  };
}

// Runs `mutate` after the body text is requested from the clone, so the change lands inside the await.
function mutateDuringRead(request, mutate) {
  Object.defineProperty(request, "clone", {
    value: () => {
      const copy = Request.prototype.clone.call(request);
      const source = copy.body.getReader();
      let mutated = false;
      return {
        body: new ReadableStream({
          pull: async (controller) => {
            if (!mutated) {
              mutated = true;
              mutate();
            }
            const { done, value } = await source.read();
            if (done) {
              controller.close();
            } else {
              controller.enqueue(value);
            }
          },
        }),
      };
    },
  });
}

function describeRequest(request) {
  return {
    method: request.method,
    url: request.url,
    redirect: request.redirect,
    credentials: request.credentials,
    cache: request.cache,
    mode: request.mode,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    destination: request.destination,
    headers: [...request.headers.entries()],
  };
}

const SYNTHETIC = "SYNTHETIC_SECRET_MUST_NOT_ESCAPE";

async function assertOpaqueOwnershipFailure(promise) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GoogleOwnedRequestError, String(error));
    assert.equal(error.code, "ownership-failed");
    assert.equal(error.cause, undefined);
    assert.equal(String(error.message).includes(SYNTHETIC), false);
    assert.equal(String(error.stack).includes(SYNTHETIC), false);
    return true;
  });
}

test("a port that mutates its binding object in place between classifications is a mismatch, and nothing is assigned", async () => {
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  const port = sharedBindingOwnership((shared) => {
    shared.level = "low";
  });
  await rejectsWith(
    createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
    "binding-mismatch",
  );
  assert.equal(event.request, request);
  assert.deepEqual(await bodyOf(request), packet({ maxOutputTokens: 40000 }));
});

test("in-place changes of token, epoch, model and level during the read are each a mismatch", async () => {
  const changes = [
    (s) => {
      s.registrationToken = "token-2";
    },
    (s) => {
      s.epoch = 4;
    },
    (s) => {
      s.model.id = "gemini-2.5-flash";
    },
    (s) => {
      s.model.variant = "other";
    },
    (s) => {
      s.level = "low";
    },
  ];
  for (const change of changes) {
    const request = requestFor(packet({}));
    const event = eventFor(request);
    await rejectsWith(
      createGoogleOwnedRequestHook(
        sharedBindingOwnership(change),
        TEST_READ_POLICY,
      )(event),
      "binding-mismatch",
    );
    assert.equal(event.request, request);
  }
});

test("after an in-place mismatch, a fresh stable binding writes its own control", async () => {
  const mismatch = eventFor(requestFor(packet({})));
  await rejectsWith(
    createGoogleOwnedRequestHook(
      sharedBindingOwnership((s) => {
        s.level = "low";
      }),
      TEST_READ_POLICY,
    )(mismatch),
    "binding-mismatch",
  );

  const retry = eventFor(requestFor(packet({})));
  await hookFor({ ...BINDING, level: "low" })(retry);
  assert.deepEqual(
    (await bodyOf(retry.request)).generationConfig.thinkingConfig,
    { includeThoughts: true, thinkingBudget: 2048 },
  );
});

test("the rebuilt request keeps every public Request property and changes only the body", async () => {
  const original = new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": KEY },
    body: JSON.stringify(packet({ maxOutputTokens: 40000 })),
    redirect: "error",
    credentials: "include",
    cache: "no-store",
    mode: "same-origin",
    referrer: "",
    referrerPolicy: "no-referrer",
    keepalive: true,
  });
  const before = describeRequest(original);
  const event = eventFor(original);
  await hookFor(BINDING)(event);

  assert.notEqual(event.request, original);
  assert.deepEqual(describeRequest(event.request), before);
  assert.deepEqual(
    (await bodyOf(event.request)).generationConfig.thinkingConfig,
    PRO_HIGH,
  );
  assert.equal(original.bodyUsed, false);
  assert.deepEqual(await original.json(), packet({ maxOutputTokens: 40000 }));
});

test("a classify that throws or rejects with a raw secret fails with an opaque ownership error", async () => {
  const throwing = {
    classify: () => {
      throw new Error(SYNTHETIC);
    },
    isCurrent: () => true,
  };
  const rejecting = {
    classify: async () => {
      throw new Error(SYNTHETIC);
    },
    isCurrent: () => true,
  };
  for (const port of [throwing, rejecting]) {
    const request = requestFor(packet({}));
    const clones = countClones(request);
    const event = eventFor(request);
    await assertOpaqueOwnershipFailure(
      createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
    );
    assert.equal(clones.calls, 0);
    assert.equal(event.request, request);
  }
});

test("async classifier rejections cannot impersonate this or a prior hook retirement", async () => {
  let priorHookError;
  const priorRequest = requestFor(packet({}));
  await assert.rejects(
    createGoogleOwnedRequestHook(
      { classify: () => new Promise(() => {}), isCurrent: () => true },
      TEST_READ_POLICY,
      { timeoutMs: 5 },
    )(eventFor(priorRequest)),
    (error) => {
      priorHookError = error;
      assert.ok(error instanceof GoogleOwnedRequestError);
      assert.equal(error.code, "wait-timeout");
      return true;
    },
  );

  const rejections = [
    undefined,
    null,
    false,
    0,
    "",
    SYNTHETIC,
    { secret: SYNTHETIC },
    new Error(SYNTHETIC),
    new GoogleOwnedRequestError("wait-timeout"),
    priorHookError,
  ];
  for (const rejection of rejections) {
    const request = requestFor(packet({}));
    const clones = countClones(request);
    const event = eventFor(request);
    await assertOpaqueOwnershipFailure(
      createGoogleOwnedRequestHook(
        {
          classify: async () => Promise.reject(rejection),
          isCurrent: () => true,
        },
        TEST_READ_POLICY,
        TEST_WAIT_POLICY,
      )(event),
    );
    assert.equal(clones.calls, 0);
    assert.equal(event.request, request);
    assert.deepEqual(await bodyOf(request), packet({}));
  }
});

test("a second classify that throws or rejects is opaque and blocks the assignment", async () => {
  let calls = 0;
  const port = {
    classify: async () => {
      calls += 1;
      if (calls === 2) {
        throw new Error(SYNTHETIC);
      }
      return owned(BINDING);
    },
    isCurrent: () => true,
  };
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  await assertOpaqueOwnershipFailure(
    createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
  );
  assert.equal(event.request, request);
});

test("an isCurrent that throws is opaque on the first and on the second check, and assigns nothing", async () => {
  for (const throwOn of [1, 2]) {
    let calls = 0;
    const port = {
      classify: async () => owned(BINDING),
      isCurrent: () => {
        calls += 1;
        if (calls === throwOn) {
          throw new Error(SYNTHETIC);
        }
        return true;
      },
    };
    const request = requestFor(packet({ maxOutputTokens: 40000 }));
    const event = eventFor(request);
    await assertOpaqueOwnershipFailure(
      createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
    );
    assert.equal(event.request, request);
  }
});

test("a malformed classification is an ownership failure, never a pass-through or a wrong wire", async () => {
  const malformed = [
    null,
    undefined,
    { kind: "maybe" },
    { kind: "owned" },
    { kind: "owned", binding: null },
  ];
  for (const value of malformed) {
    const request = requestFor(packet({}));
    const clones = countClones(request);
    const event = eventFor(request);
    await rejectsWith(
      createGoogleOwnedRequestHook(ownershipOf(value), TEST_READ_POLICY)(event),
      "ownership-failed",
    );
    assert.equal(clones.calls, 0);
    assert.equal(event.request, request);
  }

  const throwingBinding = {
    kind: "owned",
    get binding() {
      throw new Error(SYNTHETIC);
    },
  };
  const request = requestFor(packet({}));
  const event = eventFor(request);
  await assertOpaqueOwnershipFailure(
    createGoogleOwnedRequestHook(
      ownershipOf(throwingBinding),
      TEST_READ_POLICY,
    )(event),
  );
  assert.equal(event.request, request);
});

test("a request replaced while the port is consulted is rejected, and the old body is never assigned over it", async () => {
  const replacement = requestFor(packet({ maxOutputTokens: 1234 }));
  const event = eventFor(requestFor(packet({ maxOutputTokens: 40000 })));
  let calls = 0;
  const port = {
    classify: async () => {
      calls += 1;
      if (calls === 2) {
        event.request = replacement;
      }
      return owned(BINDING);
    },
    isCurrent: () => true,
  };
  const handled = [];
  await rejectsWith(
    trigger(
      event,
      [createGoogleOwnedRequestHook(port, TEST_READ_POLICY)],
      (r) => handled.push(r),
    ),
    "request-changed",
  );
  assert.equal(event.request, replacement);
  assert.deepEqual(
    await bodyOf(replacement),
    packet({ maxOutputTokens: 1234 }),
  );
  assert.equal(handled.length, 0);
});

test("a request replaced during the body read is rejected before any assignment", async () => {
  const original = requestFor(packet({ maxOutputTokens: 40000 }));
  const replacement = requestFor(packet({ maxOutputTokens: 1234 }));
  const event = eventFor(original);
  mutateDuringRead(original, () => {
    event.request = replacement;
  });
  await rejectsWith(hookFor(BINDING)(event), "request-changed");
  assert.equal(event.request, replacement);
  assert.deepEqual(
    await bodyOf(replacement),
    packet({ maxOutputTokens: 1234 }),
  );
});

test("a header changed on the original during the body read is rejected, and newer auth is not restored over", async () => {
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  mutateDuringRead(request, () =>
    request.headers.set("x-goog-api-key", "rotated-key"),
  );
  const event = eventFor(request);
  await rejectsWith(hookFor(BINDING)(event), "request-changed");
  assert.equal(event.request, request);
  assert.equal(request.headers.get("x-goog-api-key"), "rotated-key");
});

test("a header changed on the original during the second classify is rejected at the commit boundary", async () => {
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  let calls = 0;
  const port = {
    classify: async () => {
      calls += 1;
      if (calls === 2) {
        request.headers.set("x-goog-api-key", "rotated-key");
      }
      return owned(BINDING);
    },
    isCurrent: () => true,
  };
  await rejectsWith(
    createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
    "request-changed",
  );
  assert.equal(event.request, request);
  assert.equal(request.headers.get("x-goog-api-key"), "rotated-key");
});

// A caching port: it keeps the snapshot that isCurrent receives, then changes that retained object on a later
// classification and returns it. A port may retain its argument, so the module must not compare against it.
function retainingOwnership(mutateRetained) {
  let retained;
  let calls = 0;
  return {
    classify: async () => {
      calls += 1;
      if (calls === 1) {
        return owned(BINDING);
      }
      if (retained !== undefined) {
        mutateRetained(retained);
        return owned(retained);
      }
      return owned(BINDING);
    },
    isCurrent: (snapshot) => {
      retained ??= snapshot;
      return true;
    },
  };
}

test("a port that retains the isCurrent snapshot and changes its level is an ownership failure, and nothing is assigned", async () => {
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  const port = retainingOwnership((retained) => {
    retained.level = "low";
  });
  await rejectsWith(
    createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
    "ownership-failed",
  );
  assert.equal(event.request, request);
  assert.deepEqual(await bodyOf(request), packet({ maxOutputTokens: 40000 }));
});

test("a port that retains the isCurrent snapshot and changes its nested model is an ownership failure, and nothing is assigned", async () => {
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  const port = retainingOwnership((retained) => {
    retained.model.id = "gemini-2.5-flash";
  });
  await rejectsWith(
    createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
    "ownership-failed",
  );
  assert.equal(event.request, request);
  assert.deepEqual(await bodyOf(request), packet({ maxOutputTokens: 40000 }));
});

test("a port that returns a fresh record with a different level is a binding mismatch, and nothing is assigned", async () => {
  const request = requestFor(packet({ maxOutputTokens: 40000 }));
  const event = eventFor(request);
  let calls = 0;
  const port = {
    classify: async () => {
      calls += 1;
      return owned(calls === 1 ? BINDING : { ...BINDING, level: "low" });
    },
    isCurrent: () => true,
  };
  await rejectsWith(
    createGoogleOwnedRequestHook(port, TEST_READ_POLICY)(event),
    "binding-mismatch",
  );
  assert.equal(event.request, request);
});

// ----- Read policy and the bounded cloned-body reader -----

const JSON_BODY = JSON.stringify(packet({ maxOutputTokens: 40000 }));
const encoder = new TextEncoder();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A lazy stream: pull runs only when the hook reads, not at construction, so an abort inside pull lands mid-read.
const lazyStream = (source) => new ReadableStream(source, { highWaterMark: 0 });

// A fake original with a chosen body stream, for failures a real Request cannot stage. The clone hands out the stream.
function streamingRequest(body, signal = new AbortController().signal) {
  return {
    method: "POST",
    url: URL_BASE,
    headers: new Headers({
      "content-type": "application/json",
      "x-goog-api-key": KEY,
    }),
    signal,
    clone: () => ({ body }),
  };
}

// A real Request whose body is a stream, so its clone is teed like a native request.
function streamRequest(stream, signal) {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": KEY },
    body: stream,
    duplex: "half",
    signal,
  });
}

function policyHook(policy, port = ownershipOf(owned(BINDING))) {
  return createGoogleOwnedRequestHook(port, policy);
}

test("a valid read policy is copied at creation, so a later change to the caller's object has no effect", async () => {
  const policy = { maxBytes: 100000, timeoutMs: 5000 };
  const hook = policyHook(policy);
  assert.equal(Object.isFrozen(policy), false);
  policy.maxBytes = 1;
  policy.timeoutMs = 1;

  const event = eventFor(requestFor(packet({ maxOutputTokens: 40000 })));
  await hook(event);
  assert.deepEqual(
    (await bodyOf(event.request)).generationConfig.thinkingConfig,
    PRO_HIGH,
  );
});

test("a missing, malformed, inherited, accessor or revoked read policy is refused at creation, and no getter runs", () => {
  let reads = 0;
  const accessor = {};
  Object.defineProperty(accessor, "maxBytes", {
    enumerable: true,
    get() {
      reads += 1;
      return 10;
    },
  });
  accessor.timeoutMs = 10;
  const inherited = Object.create({ maxBytes: 10, timeoutMs: 10 });
  const revoked = Proxy.revocable({ maxBytes: 10, timeoutMs: 10 }, {});
  revoked.revoke();
  const trapping = new Proxy(
    { maxBytes: 10, timeoutMs: 10 },
    {
      getOwnPropertyDescriptor() {
        throw new Error(SYNTHETIC);
      },
    },
  );
  const malformed = [
    undefined,
    null,
    [],
    Object.assign([], { maxBytes: 10, timeoutMs: 10 }),
    "policy",
    {},
    { maxBytes: 10 },
    { timeoutMs: 10 },
    { maxBytes: 0, timeoutMs: 10 },
    { maxBytes: -1, timeoutMs: 10 },
    { maxBytes: 1.5, timeoutMs: 10 },
    { maxBytes: Number.NaN, timeoutMs: 10 },
    { maxBytes: Number.POSITIVE_INFINITY, timeoutMs: 10 },
    { maxBytes: 2 ** 53, timeoutMs: 10 },
    { maxBytes: "10", timeoutMs: 10 },
    { maxBytes: 10, timeoutMs: 0 },
    { maxBytes: 10, timeoutMs: 2147483648 },
    { maxBytes: 10, timeoutMs: Number.NaN },
    { maxBytes: 10, timeoutMs: Number.POSITIVE_INFINITY },
    inherited,
    accessor,
    revoked.proxy,
    trapping,
  ];
  for (const policy of malformed) {
    assert.throws(
      () => policyHook(policy),
      (error) => {
        assert.ok(error instanceof GoogleOwnedRequestError, String(error));
        assert.equal(error.code, "policy-invalid");
        assert.equal(String(error.message).includes(SYNTHETIC), false);
        return true;
      },
    );
  }
  assert.equal(reads, 0);
});

test("the largest safe byte limit and the largest timer delay are accepted at creation", () => {
  assert.doesNotThrow(() =>
    policyHook({ maxBytes: Number.MAX_SAFE_INTEGER, timeoutMs: 2147483647 }),
  );
  assert.doesNotThrow(() => policyHook({ maxBytes: 1, timeoutMs: 1 }));
});

test("a body of exactly the byte limit is accepted, and one byte over is refused before any JSON parse", async () => {
  const size = encoder.encode(JSON_BODY).byteLength;
  const exact = eventFor(requestFor(JSON_BODY));
  await policyHook({ maxBytes: size, timeoutMs: 5000 })(exact);
  assert.deepEqual(
    (await bodyOf(exact.request)).generationConfig.thinkingConfig,
    PRO_HIGH,
  );

  // Not valid JSON: a parse would fail, so the size error proves the count runs before parsing.
  const over = requestFor("x".repeat(size + 1));
  const event = eventFor(over);
  await rejectsWith(
    policyHook({ maxBytes: size, timeoutMs: 5000 })(event),
    "body-too-large",
  );
  assert.equal(event.request, over);
});

test("one chunk larger than the limit is refused and is not kept", async () => {
  const request = new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": KEY },
    body: new Uint8Array(4096),
  });
  const event = eventFor(request);
  await rejectsWith(
    policyHook({ maxBytes: 1024, timeoutMs: 5000 })(event),
    "body-too-large",
  );
  assert.equal(event.request, request);
});

test("real Request streams count intrinsic chunk bytes instead of shadow byteLength properties", async () => {
  const bytes = encoder.encode(JSON_BODY);
  let getterReads = 0;
  Object.defineProperty(bytes, "byteLength", {
    configurable: true,
    get() {
      getterReads += 1;
      throw new Error(SYNTHETIC);
    },
  });
  const tooLarge = streamRequest(
    lazyStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  );
  const tooLargeEvent = eventFor(tooLarge);
  await rejectsWith(
    policyHook({
      maxBytes: encoder.encode(JSON_BODY).byteLength - 1,
      timeoutMs: 5000,
    })(tooLargeEvent),
    "body-too-large",
  );
  assert.equal(getterReads, 0);
  assert.equal(tooLargeEvent.request, tooLarge);
  assert.equal(tooLarge.bodyUsed, false);
  const originalReader = tooLarge.body.getReader();
  try {
    const originalChunk = await originalReader.read();
    const typedArrayByteLength = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      "byteLength",
    ).get;
    const originalByteLength = typedArrayByteLength.call(originalChunk.value);
    const originalBytes = new Uint8Array(originalByteLength);
    for (let index = 0; index < originalByteLength; index += 1) {
      originalBytes[index] = originalChunk.value[index];
    }
    assert.equal(new TextDecoder().decode(originalBytes), JSON_BODY);
    assert.equal((await originalReader.read()).done, true);
  } finally {
    originalReader.releaseLock();
  }

  const underLimitBytes = encoder.encode(JSON_BODY);
  Object.defineProperty(underLimitBytes, "byteLength", { value: 0 });
  const underLimit = streamRequest(
    lazyStream({
      start(controller) {
        controller.enqueue(underLimitBytes);
        controller.close();
      },
    }),
  );
  const underLimitEvent = eventFor(underLimit);
  await policyHook({
    maxBytes: encoder.encode(JSON_BODY).byteLength,
    timeoutMs: 5000,
  })(underLimitEvent);
  assert.deepEqual(
    (await bodyOf(underLimitEvent.request)).generationConfig.thinkingConfig,
    PRO_HIGH,
  );
  assert.equal(underLimit.bodyUsed, false);
});

test("zero-byte chunks cannot defer a monotonic read deadline", async (t) => {
  let now = 0;
  let pulled = 0;
  t.mock.method(performance, "now", () => now++);
  const pending = streamingRequest(
    lazyStream({
      pull(stream) {
        pulled += 1;
        stream.enqueue(new Uint8Array());
        if (pulled === 8) {
          stream.close();
        }
      },
    }),
  );
  const event = eventFor(pending);
  await rejectsWith(
    policyHook({ maxBytes: 8, timeoutMs: 2 })(event),
    "read-timeout",
  );
  assert.ok(
    pulled < 8,
    `deadline stopped the source after ${pulled} empty chunks`,
  );
  assert.equal(event.request, pending);
});

test("many one-byte chunks stop at the first chunk past the limit, without pulling the source to its end", async () => {
  let pulled = 0;
  const source = lazyStream({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array([0x20]));
      if (pulled === 1000) {
        controller.close();
      }
    },
  });
  const request = streamRequest(source);
  const event = eventFor(request);
  await rejectsWith(
    policyHook({ maxBytes: 10, timeoutMs: 5000 })(event),
    "body-too-large",
  );
  assert.ok(pulled <= 20, `source pulled ${pulled} times`);
  assert.equal(event.request, request);
});

test("multibyte characters split across chunks decode as text() would, a BOM is stripped, and invalid bytes become U+FFFD", async () => {
  const text = "é€😀";
  const bytes = encoder.encode(
    JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }] }),
  );
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes]);
  const split = lazyStream({
    start(controller) {
      for (const byte of withBom) {
        controller.enqueue(new Uint8Array([byte]));
      }
      controller.close();
    },
  });
  const first = eventFor(streamRequest(split));
  await policyHook(TEST_READ_POLICY)(first);
  assert.equal((await bodyOf(first.request)).contents[0].parts[0].text, text);

  // Invalid UTF-8 inside a JSON string. The oracle is the platform text() decoder on the same bytes.
  const invalid = new Uint8Array([
    ...encoder.encode('{"contents":[{"role":"user","parts":[{"text":"a'),
    0xff,
    ...encoder.encode('b"}]}]}'),
  ]);
  const oracle = JSON.parse(await new Response(invalid).text());
  const second = eventFor(
    streamRequest(
      lazyStream({
        start(controller) {
          controller.enqueue(invalid);
          controller.close();
        },
      }),
    ),
  );
  await policyHook(TEST_READ_POLICY)(second);
  const decoded = (await bodyOf(second.request)).contents[0].parts[0].text;
  assert.equal(decoded, oracle.contents[0].parts[0].text);
  assert.equal(decoded, "a\uFFFDb");
});

test("a read whose cloned stream never settles is refused at its deadline, even when its cancel never settles", async () => {
  const pending = streamingRequest(
    lazyStream({ cancel: () => new Promise(() => {}) }),
  );
  const event = eventFor(pending);
  const started = Date.now();
  await rejectsWith(
    policyHook({ maxBytes: 1024, timeoutMs: 20 })(event),
    "read-timeout",
  );
  assert.ok(Date.now() - started < 2000, "the deadline bounded the read");
  assert.equal(event.request, pending);
});

test("a cancel that rejects is never awaited and surfaces no unhandled rejection", async () => {
  const unhandled = [];
  const listener = (reason) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", listener);
  try {
    const pending = streamingRequest(
      lazyStream({
        pull: () => new Promise(() => {}),
        cancel: () => Promise.reject(new Error(SYNTHETIC)),
      }),
    );
    await rejectsWith(
      policyHook({ maxBytes: 1024, timeoutMs: 20 })(eventFor(pending)),
      "read-timeout",
    );
    await sleep(30);
    assert.equal(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", listener);
  }
});

test("after an oversize refusal the original is unread and its body can still be read in full", async () => {
  const original = requestFor(JSON_BODY);
  const event = eventFor(original);
  await rejectsWith(
    policyHook({ maxBytes: 10, timeoutMs: 5000 })(event),
    "body-too-large",
  );
  assert.equal(original.bodyUsed, false);
  assert.equal(await original.text(), JSON_BODY);
});

test("after a deadline refusal the original is unread and its body can still be read in full", async () => {
  const bytes = encoder.encode(JSON_BODY);
  const pieces = [bytes.slice(0, 20), bytes.slice(20, 40), bytes.slice(40)];
  const source = lazyStream({
    async pull(controller) {
      await sleep(15);
      const piece = pieces.shift();
      if (piece === undefined) {
        controller.close();
      } else {
        controller.enqueue(piece);
      }
    },
  });
  const original = streamRequest(source);
  const event = eventFor(original);
  await rejectsWith(
    policyHook({ maxBytes: 1 << 20, timeoutMs: 10 })(event),
    "read-timeout",
  );
  assert.equal(original.bodyUsed, false);
  assert.equal(await original.text(), JSON_BODY);
});

test("an original already aborted is refused before any clone or read", async () => {
  const controller = new AbortController();
  controller.abort(new Error(SYNTHETIC));
  const request = requestFor(JSON_BODY, { signal: controller.signal });
  const clones = countClones(request);
  const event = eventFor(request);
  await rejectsWith(policyHook(TEST_READ_POLICY)(event), "wait-aborted");
  assert.equal(clones.calls, 0);
  assert.equal(event.request, request);
});

test("an abort during the pending read rejects with an opaque abort code, and the request is kept", async () => {
  const controller = new AbortController();
  const pending = streamingRequest(
    lazyStream({
      pull: () => {
        controller.abort(new Error(SYNTHETIC));
        return new Promise(() => {});
      },
    }),
    controller.signal,
  );
  const event = eventFor(pending);
  await assert.rejects(policyHook(TEST_READ_POLICY)(event), (error) => {
    assert.ok(error instanceof GoogleOwnedRequestError);
    assert.equal(error.code, "read-aborted");
    assert.equal(error.cause, undefined);
    assert.equal(String(error.message).includes(SYNTHETIC), false);
    return true;
  });
  assert.equal(event.request, pending);
});

test("an abort landing just before the final chunk and the close is still refused", async () => {
  const controller = new AbortController();
  const bytes = encoder.encode(JSON_BODY);
  const pending = streamingRequest(
    lazyStream({
      pull(stream) {
        controller.abort(new Error(SYNTHETIC));
        stream.enqueue(bytes);
        stream.close();
      },
    }),
    controller.signal,
  );
  await rejectsWith(
    policyHook(TEST_READ_POLICY)(eventFor(pending)),
    "read-aborted",
  );
});

test("an abort that lands inside the clone is not missed and refuses the read", async () => {
  const controller = new AbortController();
  const request = requestFor(JSON_BODY, { signal: controller.signal });
  Object.defineProperty(request, "clone", {
    value: () => {
      controller.abort(new Error(SYNTHETIC));
      return Request.prototype.clone.call(request);
    },
  });
  const event = eventFor(request);
  await rejectsWith(policyHook(TEST_READ_POLICY)(event), "read-aborted");
  assert.equal(event.request, request);
});

test("signal, clone body and reader initialization failures use the opaque read error", async () => {
  const cases = [
    {
      name: "signal getter",
      request: {
        method: "POST",
        headers: new Headers({ "content-type": "application/json" }),
        get signal() {
          throw new Error(SYNTHETIC);
        },
        clone() {
          throw new Error("must not clone");
        },
      },
    },
    {
      name: "body getter",
      request: {
        method: "POST",
        headers: new Headers({ "content-type": "application/json" }),
        signal: new AbortController().signal,
        clone() {
          return {
            get body() {
              throw new Error(SYNTHETIC);
            },
          };
        },
      },
    },
    {
      name: "missing reader method",
      request: streamingRequest({}),
    },
    {
      name: "reader method throws",
      request: streamingRequest({
        getReader() {
          throw new Error(SYNTHETIC);
        },
      }),
    },
    {
      name: "forged public reader error",
      request: streamingRequest({
        getReader() {
          const error = new GoogleOwnedRequestError("body-too-large");
          error.message = SYNTHETIC;
          throw error;
        },
      }),
    },
  ];

  const lockedBody = lazyStream({});
  lockedBody.getReader();
  cases.push({ name: "locked reader", request: streamingRequest(lockedBody) });

  for (const { name, request } of cases) {
    const event = eventFor(request);
    await assert.rejects(policyHook(TEST_READ_POLICY)(event), (error) => {
      assert.ok(error instanceof GoogleOwnedRequestError, name);
      assert.equal(error.code, "read-failed", name);
      assert.equal(error.cause, undefined, name);
      assert.equal(String(error.message).includes(SYNTHETIC), false, name);
      assert.equal(String(error.stack).includes(SYNTHETIC), false, name);
      return true;
    });
    assert.equal(event.request, request, name);
  }
});

test("a reader failure or a chunk that is not bytes is an opaque read failure that keeps the request", async () => {
  const failing = streamingRequest(
    lazyStream({
      pull() {
        throw new Error(SYNTHETIC);
      },
    }),
  );
  const failingEvent = eventFor(failing);
  await assert.rejects(policyHook(TEST_READ_POLICY)(failingEvent), (error) => {
    assert.ok(error instanceof GoogleOwnedRequestError);
    assert.equal(error.code, "read-failed");
    assert.equal(error.cause, undefined);
    assert.equal(String(error.message).includes(SYNTHETIC), false);
    return true;
  });
  assert.equal(failingEvent.request, failing);

  const text = streamingRequest(
    lazyStream({
      start(controller) {
        controller.enqueue("not bytes");
        controller.close();
      },
    }),
  );
  await rejectsWith(
    policyHook(TEST_READ_POLICY)(eventFor(text)),
    "read-failed",
  );
});

test("the deadline timer and request signal listener are released on success, read failures and partial setup", async (t) => {
  const created = [];
  const cleared = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let failTimer = false;
  let timersBeforeFailure = 0;
  let failClear = false;
  t.mock.method(globalThis, "setTimeout", (...args) => {
    if (failTimer && timersBeforeFailure > 0) {
      timersBeforeFailure -= 1;
    } else if (failTimer) {
      failTimer = false;
      throw new Error(SYNTHETIC);
    }
    const handle = realSetTimeout(...args);
    created.push(handle);
    return handle;
  });
  t.mock.method(globalThis, "clearTimeout", (handle) => {
    cleared.push(handle);
    const result = realClearTimeout(handle);
    if (failClear) {
      failClear = false;
      throw new Error(SYNTHETIC);
    }
    return result;
  });

  let partialSetupCancelCalls = 0;
  let timerSetupBody;
  let partialSetupBody;
  const scenarios = [
    {
      name: "success",
      code: null,
      policy: TEST_READ_POLICY,
      make: (controller) =>
        requestFor(JSON_BODY, { signal: controller.signal }),
      copyBody: () =>
        lazyStream({
          start(stream) {
            stream.enqueue(encoder.encode(JSON_BODY));
            stream.close();
          },
        }),
    },
    {
      name: "oversize",
      code: "body-too-large",
      policy: { maxBytes: 10, timeoutMs: 5000 },
      make: (controller) =>
        requestFor(JSON_BODY, { signal: controller.signal }),
      copyBody: () =>
        lazyStream({
          start(stream) {
            stream.enqueue(encoder.encode(JSON_BODY));
            stream.close();
          },
        }),
    },
    {
      name: "deadline",
      code: "read-timeout",
      policy: { maxBytes: 1024, timeoutMs: 10 },
      make: (controller) => streamRequest(lazyStream({}), controller.signal),
      copyBody: () => lazyStream({}),
    },
    {
      name: "abort",
      code: "read-aborted",
      policy: TEST_READ_POLICY,
      make: (controller) =>
        streamRequest(
          lazyStream({
            pull: () => {
              controller.abort(new Error(SYNTHETIC));
              return new Promise(() => {});
            },
          }),
          controller.signal,
        ),
      nativeClone: true,
      copyBody: (controller) =>
        lazyStream({
          pull: () => {
            setImmediate(() => controller.abort(new Error(SYNTHETIC)));
            return new Promise(() => {});
          },
        }),
    },
    {
      name: "reader failure",
      code: "read-failed",
      policy: TEST_READ_POLICY,
      make: (controller) =>
        streamRequest(
          lazyStream({
            pull() {
              throw new Error(SYNTHETIC);
            },
          }),
          controller.signal,
        ),
      copyBody: () =>
        lazyStream({
          pull() {
            throw new Error(SYNTHETIC);
          },
        }),
    },
    {
      name: "timer setup failure",
      code: "read-failed",
      policy: TEST_READ_POLICY,
      make: (controller) => streamRequest(lazyStream({}), controller.signal),
      copyBody: () => {
        timerSetupBody = lazyStream({});
        return timerSetupBody;
      },
      before: () => {
        failTimer = true;
        timersBeforeFailure = 1;
      },
    },
    {
      name: "listener setup failure after registration",
      code: "read-failed",
      policy: TEST_READ_POLICY,
      make: (controller) =>
        streamRequest(
          lazyStream({
            cancel: () => {
              partialSetupCancelCalls += 1;
            },
          }),
          controller.signal,
        ),
      copyBody: () => {
        partialSetupBody = lazyStream({
          cancel: () => {
            partialSetupCancelCalls += 1;
          },
        });
        return partialSetupBody;
      },
      throwAfterAdd: true,
    },
    {
      name: "listener cleanup failure",
      code: "read-failed",
      policy: TEST_READ_POLICY,
      make: (controller) =>
        requestFor(JSON_BODY, { signal: controller.signal }),
      copyBody: () =>
        lazyStream({
          start(stream) {
            stream.enqueue(encoder.encode(JSON_BODY));
            stream.close();
          },
        }),
      throwOnRemove: true,
    },
    {
      name: "timer cleanup failure",
      code: "read-failed",
      policy: TEST_READ_POLICY,
      make: (controller) =>
        requestFor(JSON_BODY, { signal: controller.signal }),
      copyBody: () =>
        lazyStream({
          start(stream) {
            stream.enqueue(encoder.encode(JSON_BODY));
            stream.close();
          },
        }),
      before: () => {
        failClear = true;
      },
    },
  ];

  for (const scenario of scenarios) {
    const controller = new AbortController();
    const request =
      scenario.name === "success"
        ? scenario.make(controller)
        : {
            method: "POST",
            url: URL_BASE,
            headers: new Headers({
              "content-type": "application/json",
              "x-goog-api-key": KEY,
            }),
            signal: controller.signal,
            clone: () => ({ body: scenario.copyBody(controller) }),
          };
    const event = eventFor(request);
    // Observe the exact signal read from the Request, not the controller's source signal. Rebuilding a Request can
    // register a separate linked listener after the hook has removed its own listener.
    const pendingAbortListeners = new Set();
    const addedAbortListeners = [];
    const removedAbortListeners = new Set();
    const signal = request.signal;
    assert.equal(signal, request.signal);
    const addListener = signal.addEventListener.bind(signal);
    const removeListener = signal.removeEventListener.bind(signal);
    let addCalls = 0;
    let removeCalls = 0;
    signal.addEventListener = (type, listener, options) => {
      if (type === "abort") {
        addCalls += 1;
        addedAbortListeners.push(listener);
        pendingAbortListeners.add(listener);
      }
      const result = addListener(type, listener, options);
      if (scenario.throwAfterAdd && type === "abort" && addCalls === 2) {
        throw new Error(SYNTHETIC);
      }
      return result;
    };
    signal.removeEventListener = (type, listener, options) => {
      if (type === "abort") {
        removeCalls += 1;
        removedAbortListeners.add(listener);
        pendingAbortListeners.delete(listener);
      }
      const result = removeListener(type, listener, options);
      if (scenario.throwOnRemove && type === "abort" && removeCalls === 2) {
        throw new Error(SYNTHETIC);
      }
      return result;
    };
    const createdBefore = created.length;
    let code = null;
    scenario.before?.();
    try {
      await policyHook(scenario.policy)(event);
    } catch (error) {
      assert.ok(error instanceof GoogleOwnedRequestError, scenario.name);
      assert.equal(error.message.includes(SYNTHETIC), false, scenario.name);
      code = error.code;
    }
    assert.equal(code, scenario.code, scenario.name);
    const ours = created.slice(createdBefore);
    if (scenario.name !== "timer setup failure") {
      assert.ok(ours.length >= 1, `${scenario.name} armed a deadline`);
    }
    for (const handle of ours) {
      assert.ok(
        cleared.includes(handle),
        `${scenario.name} released its timer`,
      );
    }
    if (scenario.name === "timer setup failure") {
      assert.equal(ours.length, 1, "only the hook deadline timer was created");
      assert.equal(timerSetupBody.locked, false);
    }
    if (scenario.name === "listener setup failure after registration") {
      assert.equal(partialSetupBody.locked, false);
    }
    const expectedListenerCalls =
      scenario.name === "success"
        ? 4
        : scenario.name === "abort" || scenario.name === "timer setup failure"
          ? 2
          : scenario.name === "timer setup failure" ||
              scenario.name === "oversize" ||
              scenario.name === "deadline" ||
              scenario.name === "reader failure" ||
              scenario.name === "listener setup failure after registration" ||
              scenario.name === "listener cleanup failure" ||
              scenario.name === "timer cleanup failure"
            ? 3
            : 0;
    assert.equal(
      addCalls,
      expectedListenerCalls,
      `${scenario.name} added listeners`,
    );
    const expectedListenerRemovals = scenario.name === "success" ? 3 : addCalls;
    assert.equal(
      removeCalls,
      expectedListenerRemovals,
      `${scenario.name} removed hook and reader listeners`,
    );
    for (const listener of removedAbortListeners) {
      assert.ok(
        addedAbortListeners.includes(listener),
        `${scenario.name} removed a listener it registered`,
      );
    }
    if (scenario.code !== null) {
      assert.equal(
        event.request,
        request,
        `${scenario.name} kept the original request`,
      );
    }
  }
  assert.equal(partialSetupCancelCalls, 1);
});
