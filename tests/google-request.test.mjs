import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createGoogleOwnedRequestHook,
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
  createGoogleOwnedRequestHook(ownershipOf(owned(binding), state));

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
  await createGoogleOwnedRequestHook(ownershipOf(UNOWNED))(event);

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
  await createGoogleOwnedRequestHook(ownershipOf(UNOWNED))(event);

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
  const hook = createGoogleOwnedRequestHook(ownership);
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
        text: async () => {
          await gate;
          return native;
        },
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
    createGoogleOwnedRequestHook(ownershipOf([owned(BINDING), owned(drifted)]))(
      event,
    ),
    "binding-mismatch",
  );
  assert.deepEqual(await bodyOf(event.request), packet({}));
});

test("creating the hook registers nothing and classifies nothing", () => {
  const ownership = ownershipOf(owned(BINDING));
  createGoogleOwnedRequestHook(ownership);
  assert.equal(ownership.counters.classify, 0);
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
      return {
        text: async () => {
          mutate();
          return copy.text();
        },
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
    createGoogleOwnedRequestHook(port)(event),
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
      createGoogleOwnedRequestHook(sharedBindingOwnership(change))(event),
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
      createGoogleOwnedRequestHook(port)(event),
    );
    assert.equal(clones.calls, 0);
    assert.equal(event.request, request);
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
  await assertOpaqueOwnershipFailure(createGoogleOwnedRequestHook(port)(event));
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
      createGoogleOwnedRequestHook(port)(event),
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
      createGoogleOwnedRequestHook(ownershipOf(value))(event),
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
    createGoogleOwnedRequestHook(ownershipOf(throwingBinding))(event),
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
    trigger(event, [createGoogleOwnedRequestHook(port)], (r) =>
      handled.push(r),
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
    createGoogleOwnedRequestHook(port)(event),
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
    createGoogleOwnedRequestHook(port)(event),
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
    createGoogleOwnedRequestHook(port)(event),
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
    createGoogleOwnedRequestHook(port)(event),
    "binding-mismatch",
  );
  assert.equal(event.request, request);
});
