import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { observeBedrockPreparedCap } from "../dist/thinking/bedrock-request-cap.js";

// Fixtures are local Request objects only. No SDK, host, provider, environment, network or session is used. The secret
// marker proves that error results never echo a body, a header or a URL.
const URL_CONVERSE =
  "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-sonnet-4-6/converse-stream";
const SECRET = "SYNTH_SECRET_MARKER_r4c7";
const AUTH = "Bearer synthetic-bearer-value";

function bodyRequest(text, headers = {}) {
  return new Request(URL_CONVERSE, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: text,
  });
}

function withCap(value) {
  return JSON.stringify({
    messages: [],
    inferenceConfig: { maxTokens: value, temperature: 0.2 },
  });
}

function observedKnown(value) {
  return {
    kind: "observed",
    scope: "request-snapshot",
    cap: { kind: "known", value },
  };
}

const ABSENT = {
  kind: "observed",
  scope: "request-snapshot",
  cap: { kind: "absent" },
};

// ----- Known numeric caps -----

test("finite numeric caps are observed as known with their exact value", async () => {
  for (const value of [40000, 0, -5, 0.5, 1e21]) {
    assert.deepEqual(
      await observeBedrockPreparedCap(bodyRequest(withCap(value))),
      observedKnown(value),
      String(value),
    );
  }
});

test("a negative zero cap is known and keeps its sign", async () => {
  const result = await observeBedrockPreparedCap(
    bodyRequest('{"inferenceConfig":{"maxTokens":-0}}'),
  );
  assert.equal(result.kind, "observed");
  assert.equal(result.cap.kind, "known");
  assert.equal(Object.is(result.cap.value, -0), true);
});

test("a cap that overflows JSON parsing to Infinity is malformed, not known", async () => {
  assert.deepEqual(
    await observeBedrockPreparedCap(
      bodyRequest('{"inferenceConfig":{"maxTokens":1e400}}'),
    ),
    {
      kind: "malformed",
      field: "maxTokens",
    },
  );
});

// ----- Known absence -----

test("a body without inferenceConfig, or without its own maxTokens, is known absence", async () => {
  for (const text of [
    "{}",
    '{"inferenceConfig":{}}',
    '{"inferenceConfig":{"temperature":0.2}}',
    '{"messages":[],"maxTokens":900}',
  ]) {
    assert.deepEqual(
      await observeBedrockPreparedCap(bodyRequest(text)),
      ABSENT,
      text,
    );
  }
});

test("an own __proto__ key does not create an inherited inferenceConfig, so the cap stays absent", async () => {
  assert.deepEqual(
    await observeBedrockPreparedCap(
      bodyRequest('{"__proto__":{"inferenceConfig":{"maxTokens":9}}}'),
    ),
    ABSENT,
  );
});

test("inherited cap fields are ignored in an isolated process", () => {
  const moduleURL = new URL(
    "../dist/thinking/bedrock-request-cap.js",
    import.meta.url,
  ).href;
  const script = `
    import assert from "node:assert/strict";
    import { observeBedrockPreparedCap } from ${JSON.stringify(moduleURL)};
    const absent = {kind:"observed",scope:"request-snapshot",cap:{kind:"absent"}};
    const request = (body) => new Request("https://example.invalid/", {method:"POST",body});
    Object.defineProperty(Object.prototype, "inferenceConfig", {
      value:{maxTokens:999}, configurable:true
    });
    try {
      assert.deepEqual(await observeBedrockPreparedCap(request("{}")), absent);
    } finally {
      delete Object.prototype.inferenceConfig;
    }
    Object.defineProperty(Object.prototype, "maxTokens", {value:999, configurable:true});
    try {
      assert.deepEqual(await observeBedrockPreparedCap(request('{"inferenceConfig":{}}')), absent);
    } finally {
      delete Object.prototype.maxTokens;
    }
  `;
  // Only this local compiled module runs; no inherited environment or SDK is loaded.
  const child = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      encoding: "utf8",
      env: {},
      timeout: 10000,
    },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
});

// ----- Malformed present fields -----

test("a present inferenceConfig that is not a plain object is malformed", async () => {
  for (const config of ["null", '"x"', "[]", "5", "true"]) {
    assert.deepEqual(
      await observeBedrockPreparedCap(
        bodyRequest(`{"inferenceConfig":${config}}`),
      ),
      { kind: "malformed", field: "inferenceConfig" },
      config,
    );
  }
});

test("a present maxTokens that is not a finite JSON number is malformed, never absent or zero", async () => {
  for (const value of ["null", '"1"', "true", "[]", "{}"]) {
    assert.deepEqual(
      await observeBedrockPreparedCap(
        bodyRequest(`{"inferenceConfig":{"maxTokens":${value}}}`),
      ),
      { kind: "malformed", field: "maxTokens" },
      value,
    );
  }
});

// ----- Unavailable evidence, with fixed codes -----

test("a JSON root that is not an object is unavailable with the body-shape code", async () => {
  for (const text of ["[]", "null", "1", '"x"', "true"]) {
    assert.deepEqual(
      await observeBedrockPreparedCap(bodyRequest(text)),
      { kind: "unavailable", code: "body-shape" },
      text,
    );
  }
});

test("invalid JSON is unavailable with the parse code, and the body is never echoed", async () => {
  const result = await observeBedrockPreparedCap(
    bodyRequest(`not json ${SECRET}`),
  );
  assert.deepEqual(result, { kind: "unavailable", code: "parse" });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("a request without a body, or with an empty body, is unavailable with the no-body code", async () => {
  assert.deepEqual(
    await observeBedrockPreparedCap(
      new Request(URL_CONVERSE, { method: "GET" }),
    ),
    { kind: "unavailable", code: "no-body" },
  );
  assert.deepEqual(await observeBedrockPreparedCap(bodyRequest("")), {
    kind: "unavailable",
    code: "no-body",
  });
});

test("a body stream that errors while being read is unavailable with the read code, and the error is not surfaced", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.error(new Error(SECRET));
    },
  });
  const request = new Request(URL_CONVERSE, {
    method: "POST",
    body: stream,
    duplex: "half",
  });
  const result = await observeBedrockPreparedCap(request);
  assert.deepEqual(result, { kind: "unavailable", code: "read" });
  assert.equal(JSON.stringify(result).includes(SECRET), false);
});

test("a complete JSON chunk is not observed until its stream closes", async () => {
  let source;
  const text = withCap(42);
  const stream = new ReadableStream({
    start(controller) {
      source = controller;
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
  const request = new Request(URL_CONVERSE, {
    method: "POST",
    body: stream,
    duplex: "half",
  });
  let settled = false;
  const observation = observeBedrockPreparedCap(request).then((result) => {
    settled = true;
    return result;
  });
  try {
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(request.bodyUsed, false);
  } finally {
    source.close();
  }
  assert.deepEqual(await observation, observedKnown(42));
  assert.equal(await request.text(), text);
});

test("a body already consumed by the caller is unavailable with the clone code, never known absence", async () => {
  const request = bodyRequest(withCap(40000));
  await request.text();
  assert.deepEqual(await observeBedrockPreparedCap(request), {
    kind: "unavailable",
    code: "clone",
  });
});

test("a body locked by a reader is unavailable with the clone code, never known absence", async () => {
  const request = bodyRequest(withCap(40000));
  const reader = request.body.getReader();
  try {
    assert.deepEqual(await observeBedrockPreparedCap(request), {
      kind: "unavailable",
      code: "clone",
    });
  } finally {
    reader.releaseLock();
  }
});

test("inputs that are not native Request objects are unavailable with the clone code and never invoke their methods", async () => {
  let invoked = 0;
  const forged = {
    clone() {
      invoked += 1;
      return bodyRequest(withCap(1));
    },
  };
  assert.deepEqual(await observeBedrockPreparedCap(forged), {
    kind: "unavailable",
    code: "clone",
  });
  assert.deepEqual(await observeBedrockPreparedCap(undefined), {
    kind: "unavailable",
    code: "clone",
  });
  assert.deepEqual(await observeBedrockPreparedCap(null), {
    kind: "unavailable",
    code: "clone",
  });
  assert.equal(invoked, 0);
});

test("an own clone override on a native Request is never invoked, and the real body is observed", async () => {
  let invoked = 0;
  const request = bodyRequest(withCap(40000));
  request.clone = () => {
    invoked += 1;
    return bodyRequest(withCap(1));
  };
  assert.deepEqual(
    await observeBedrockPreparedCap(request),
    observedKnown(40000),
  );
  assert.equal(invoked, 0);
});

// ----- Non-consuming reads and snapshot fields -----

test("observing a request leaves its url, method, headers, options, signal and body readable and identical", async () => {
  const controller = new AbortController();
  const request = new Request(URL_CONVERSE, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: AUTH },
    body: withCap(40000),
    signal: controller.signal,
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    mode: "cors",
    keepalive: false,
  });
  const signal = request.signal;
  const before = snapshotOf(request);

  assert.deepEqual(
    await observeBedrockPreparedCap(request),
    observedKnown(40000),
  );

  assert.deepEqual(snapshotOf(request), before);
  assert.equal(request.signal, signal);
  assert.equal(request.bodyUsed, false);
  assert.equal(await request.text(), withCap(40000));
});

test("repeated observations of the same request agree, and each call returns a fresh frozen result", async () => {
  const request = bodyRequest(withCap(12345));
  const first = await observeBedrockPreparedCap(request);
  const second = await observeBedrockPreparedCap(request);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.cap), true);
});

test("concurrent observations of different requests stay independent, with no shared state", async () => {
  const [a, b, c] = await Promise.all([
    observeBedrockPreparedCap(bodyRequest(withCap(100))),
    observeBedrockPreparedCap(bodyRequest("{}")),
    observeBedrockPreparedCap(bodyRequest(withCap(-2))),
  ]);
  assert.deepEqual(a, observedKnown(100));
  assert.deepEqual(b, ABSENT);
  assert.deepEqual(c, observedKnown(-2));
});

test("an observed result carries only the fixed scope and cap fields, with no url, header or body", async () => {
  const result = await observeBedrockPreparedCap(
    bodyRequest(withCap(7), { authorization: AUTH }),
  );
  assert.deepEqual(Object.keys(result).sort(), ["cap", "kind", "scope"]);
  assert.deepEqual(Object.keys(result.cap).sort(), ["kind", "value"]);
  const text = JSON.stringify(result);
  assert.equal(text.includes("amazonaws"), false);
  assert.equal(text.includes("synthetic-bearer-value"), false);
});

function snapshotOf(request) {
  return {
    url: request.url,
    method: request.method,
    headers: [...request.headers.entries()],
    redirect: request.redirect,
    credentials: request.credentials,
    cache: request.cache,
    mode: request.mode,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive,
    bodyUsed: request.bodyUsed,
    aborted: request.signal.aborted,
  };
}
