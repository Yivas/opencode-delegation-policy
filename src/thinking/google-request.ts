import { isDeepStrictEqual } from "node:util";

import type { SessionHttpRequest } from "@opencode/plugin/promise/session";

import {
  type GoogleControl,
  googleApiForPackage,
  planGoogleLevel,
} from "./google.js";
import type { ThinkingLevel } from "./policies.js";

// Inert request writer for an owned Google thinking binding. It is a function a future integration may register
// as a session `http.request` callback. This module registers nothing, loads no session, configuration or environment,
// and sends nothing. Supplied request headers can contain credentials; the integrity checks read and preserve them.
//
// Position (opencode 8a8bd622): the `http.request` trigger receives the request after native body encoding and
// auth. Callbacks run one after another in registration order without a catch, so a throw stops the trigger and
// the request handler is not reached. This writer is correct only at its own callback position: it replaces
// `generationConfig.thinkingConfig` with the planned Pi control and keeps the output cap as it is at that point.
// A later callback can rewrite either subtree or the cap, and nothing here detects that.
//
// Ownership is decided by an injected port, never by this module. The port classifies each request. This module
// copies the binding it returns, checks that copy, and compares a fresh copy after the body read. It never chooses
// a level, never replaces a variant and never reapplies or raises the output cap.
//
// The body is read through an explicit read policy supplied by the caller. It has no default. The policy bounds the
// bytes collected from the cloned body and the time that collection may take. A separate explicit wait policy starts
// at hook entry and bounds cooperative waits for ownership classification and body reading together. Expiring it
// retires this invocation and stops its cloned reader; it cannot cancel an ownership callback or preempt synchronous
// CPU work. This is not a total memory bound: the request tee and original branch, stream internals, parsed JSON and
// rebuilt body can retain additional data.

export type GoogleRequestErrorCode =
  | "ownership-failed"
  | "binding-stale"
  | "binding-mismatch"
  | "binding-unsupported"
  | "auth-unverified"
  | "stale-content-length"
  | "shape-rejected"
  | "cap-invalid"
  | "policy-invalid"
  | "body-too-large"
  | "read-timeout"
  | "read-aborted"
  | "wait-policy-invalid"
  | "wait-timeout"
  | "wait-aborted"
  | "wait-failed"
  | "read-failed"
  | "parse-failed"
  | "request-changed"
  | "construction-failed";

// Fixed messages. A host, body, URL, header, credential or port error value is never copied into an error.
const MESSAGES: Readonly<Record<GoogleRequestErrorCode, string>> =
  Object.freeze({
    "ownership-failed": "owned Google request ownership could not be verified",
    "binding-stale": "owned Google request binding is not current",
    "binding-mismatch": "owned Google request does not match its binding",
    "binding-unsupported":
      "owned Google request has no supported Google control",
    "auth-unverified":
      "owned Google request has no verified body-independent auth",
    "stale-content-length":
      "owned Google request carries a content-length that would be stale",
    "shape-rejected": "owned Google request is not a supported JSON packet",
    "cap-invalid": "owned Google request output cap is not a finite number",
    "policy-invalid": "owned Google request read policy is not a valid bound",
    "body-too-large": "owned Google request body exceeds the read limit",
    "read-timeout": "owned Google request body read exceeded its deadline",
    "read-aborted": "owned Google request was aborted before its body was read",
    "wait-policy-invalid":
      "owned Google request wait policy is not a valid bound",
    "wait-timeout": "owned Google request exceeded its total wait deadline",
    "wait-aborted": "owned Google request was aborted while waiting",
    "wait-failed": "owned Google request wait could not be bounded",
    "read-failed": "owned Google request body could not be read",
    "parse-failed": "owned Google request body is not valid JSON",
    "request-changed":
      "owned Google request was replaced or changed while it was being read",
    "construction-failed": "owned Google request could not be rebuilt",
  });

export class GoogleOwnedRequestError extends Error {
  readonly code: GoogleRequestErrorCode;

  constructor(code: GoogleRequestErrorCode) {
    super(MESSAGES[code]);
    this.name = "GoogleOwnedRequestError";
    this.code = code;
  }
}

// The exact binding of one owned operation. `registrationToken` and `epoch` identify the current registration.
// A prefix of an ID is never proof of ownership.
export type GoogleOwnedBinding = {
  readonly registrationToken: string;
  readonly epoch: number;
  readonly roleAgentID: string;
  readonly sessionID: string;
  readonly parentSessionID: string;
  // The host's Model.Ref. Its `id` is the host identity and may differ from the protocol model id.
  readonly model: {
    readonly providerID: string;
    readonly id: string;
    readonly variant: string;
  };
  // The provider package. googleApiForPackage maps it to the Google API.
  readonly packageName: string;
  // The SDK model id the Pi table is keyed by.
  readonly protocolModelID: string;
  // The canonical level the caller explicitly selected. Never inferred from a range.
  readonly level: ThinkingLevel;
  // True only when the port has verified that the auth definition does not read the request body.
  readonly authBodyIndependent: boolean;
  readonly authEvidence: string;
};

export type GoogleRequestClassification =
  | { readonly kind: "unowned" }
  | { readonly kind: "owned"; readonly binding: GoogleOwnedBinding };

// `classify` is the authority for ownership and is consulted again after the body is read. `isCurrent` answers for
// the registration lifetime and must be synchronous.
export type GoogleRequestOwnership = {
  readonly classify: (
    event: SessionHttpRequest,
  ) => GoogleRequestClassification | Promise<GoogleRequestClassification>;
  readonly isCurrent: (binding: GoogleOwnedBinding) => boolean;
};

export type GoogleOwnedRequestHook = (
  event: SessionHttpRequest,
) => Promise<void>;

// The explicit bound for the complete cooperative wait. A caller supplies it; there is no production default.
export type GoogleRequestWaitPolicy = {
  readonly timeoutMs: number;
};

// The explicit bound for the body read. A caller supplies it; the module provides no default.
export type GoogleRequestReadPolicy = {
  readonly maxBytes: number;
  readonly timeoutMs: number;
};

type GoogleRequestReadBounds = {
  readonly maxBytes: number;
  readonly timeoutMs: number;
};

type GoogleRequestWaitBounds = { readonly timeoutMs: number };
type GoogleRequestWait = {
  readonly signal: AbortSignal;
  readonly initialRequest: Request;
  readonly initialSignal: AbortSignal;
  isInterruption(error: unknown): boolean;
  run<T>(operation: PromiseLike<T> | T): Promise<T>;
  pauseOriginalAbort(): void;
  resumeOriginalAbort(): void;
  check(): void;
  cleanup(): void;
};

// Node clamps larger timer delays, so a longer deadline would fire at once.
const MAX_TIMER_DELAY_MS = 2147483647;
const UNREADABLE = Symbol("unreadable");

// The policy is validated and copied when the hook is created, before any request is classified or read.
export function createGoogleOwnedRequestHook(
  ownership: GoogleRequestOwnership,
  readPolicy: GoogleRequestReadPolicy,
  waitPolicy: GoogleRequestWaitPolicy,
): GoogleOwnedRequestHook {
  const readBounds = readBoundsOf(readPolicy);
  const waitBounds = waitBoundsOf(waitPolicy);
  return async (event) => {
    const wait = createRequestWait(event, waitBounds);
    try {
      const first = await classifyOwnership(ownership, event, wait);
      if (first === undefined) {
        wait.check();
        return;
      }
      const control = controlFor(event, first, ownership, wait);
      wait.check();

      const original = wait.initialRequest;
      const headersBefore = headerEntries(original);
      if (original.headers.has("content-length")) {
        throw fail("stale-content-length");
      }
      if (
        original.method !== "POST" ||
        !isJsonContentType(original.headers.get("content-type"))
      ) {
        throw fail("shape-rejected");
      }
      if (event.request !== original) {
        throw fail("request-changed");
      }
      wait.check();

      wait.pauseOriginalAbort();
      let body: string;
      try {
        body = await wait.run(
          readBoundedText(original, readBounds, wait.signal),
        );
      } finally {
        wait.resumeOriginalAbort();
      }
      if (wait.initialSignal.aborted) throw fail("read-aborted");
      const parsed = parsePacket(body);
      wait.check();
      const next = withThinkingConfig(parsed, control);
      wait.check();

      const second = await classifyOwnership(ownership, event, wait);
      if (second === undefined) {
        throw fail("binding-stale");
      }
      if (!isDeepStrictEqual(second, first)) {
        throw fail("binding-mismatch");
      }
      controlFor(event, second, ownership, wait);
      wait.check();
      if (
        event.request !== original ||
        !isDeepStrictEqual(headerEntries(original), headersBefore)
      ) {
        throw fail("request-changed");
      }

      if (isDeepStrictEqual(parsed, next)) {
        wait.check();
        return;
      }
      const rebuilt = rebuildRequest(original, next);
      wait.cleanup();
      wait.check();
      if (wait.initialSignal.aborted) throw fail("read-aborted");
      if (event.request !== original) {
        throw fail("request-changed");
      }
      event.request = rebuilt;
    } finally {
      wait.cleanup();
    }
  };
}

function fail(code: GoogleRequestErrorCode): GoogleOwnedRequestError {
  return new GoogleOwnedRequestError(code);
}

const READER_ERRORS = new WeakSet<GoogleOwnedRequestError>();

function readerError(code: GoogleRequestErrorCode): GoogleOwnedRequestError {
  const error = fail(code);
  READER_ERRORS.add(error);
  return error;
}

// The port may throw or reject with arbitrary values, including secrets. Each port failure becomes the fixed
// ownership error, so no message, cause or stack from the port reaches the caller. Ownership is never inferred
// from a failure: it stops the write.
async function classifyOwnership(
  ownership: GoogleRequestOwnership,
  event: SessionHttpRequest,
  wait: GoogleRequestWait,
): Promise<GoogleOwnedBinding | undefined> {
  let result:
    | GoogleRequestClassification
    | Promise<GoogleRequestClassification>;
  wait.check();
  try {
    result = ownership.classify(event);
  } catch {
    wait.check();
    throw fail("ownership-failed");
  }
  let classification: GoogleRequestClassification;
  try {
    classification = await wait.run(result);
  } catch (error) {
    if (wait.isInterruption(error)) {
      throw error;
    }
    throw fail("ownership-failed");
  }
  wait.check();
  return ownedBindingOf(classification);
}

// Returns an owned binding copied into this module. The port may return one mutable object and change it in place
// later, so the copy is the only value compared and used for the planned control.
function ownedBindingOf(
  classification: GoogleRequestClassification,
): GoogleOwnedBinding | undefined {
  try {
    if (classification.kind === "unowned") {
      return undefined;
    }
    if (classification.kind === "owned") {
      return snapshotBinding(classification.binding);
    }
  } catch {
    throw fail("ownership-failed");
  }
  throw fail("ownership-failed");
}

// The copy is frozen at runtime. A port may retain the snapshot passed to isCurrent, so a later in-place change by
// the port must not alter the record this module compares or plans from. The external port object is never frozen.
function snapshotBinding(binding: GoogleOwnedBinding): GoogleOwnedBinding {
  return Object.freeze({
    registrationToken: binding.registrationToken,
    epoch: binding.epoch,
    roleAgentID: binding.roleAgentID,
    sessionID: binding.sessionID,
    parentSessionID: binding.parentSessionID,
    model: Object.freeze({
      providerID: binding.model.providerID,
      id: binding.model.id,
      variant: binding.model.variant,
    }),
    packageName: binding.packageName,
    protocolModelID: binding.protocolModelID,
    level: binding.level,
    authBodyIndependent: binding.authBodyIndependent,
    authEvidence: binding.authEvidence,
  });
}

function lifetimeIsCurrent(
  ownership: GoogleRequestOwnership,
  binding: GoogleOwnedBinding,
): boolean {
  let current: unknown;
  try {
    current = ownership.isCurrent(binding);
  } catch {
    throw fail("ownership-failed");
  }
  if (typeof current !== "boolean") {
    throw fail("ownership-failed");
  }
  return current;
}

// Checks every fact of the binding before the body is read, and returns the planned Pi control for the level.
function controlFor(
  event: SessionHttpRequest,
  binding: GoogleOwnedBinding,
  ownership: GoogleRequestOwnership,
  wait: GoogleRequestWait,
): GoogleControl {
  if (
    binding.registrationToken === "" ||
    !Number.isSafeInteger(binding.epoch) ||
    binding.epoch < 0
  ) {
    throw fail("binding-stale");
  }
  if (
    binding.roleAgentID === "" ||
    binding.sessionID === "" ||
    binding.parentSessionID === "" ||
    binding.parentSessionID === binding.sessionID ||
    event.agent !== binding.roleAgentID ||
    event.sessionID !== binding.sessionID
  ) {
    throw fail("binding-mismatch");
  }
  if (!sameModelRef(event.model, binding.model)) {
    throw fail("binding-mismatch");
  }
  const api = googleApiForPackage(binding.packageName);
  if (api === undefined || binding.protocolModelID === "") {
    throw fail("binding-unsupported");
  }
  if (!binding.authBodyIndependent || binding.authEvidence === "") {
    throw fail("auth-unverified");
  }
  const plan = planGoogleLevel(api, binding.protocolModelID, binding.level);
  if (plan.kind === "incompatible") {
    throw fail("binding-unsupported");
  }
  wait.check();
  if (!lifetimeIsCurrent(ownership, binding)) {
    throw fail("binding-stale");
  }
  return { ...plan.control };
}

function sameModelRef(
  ref: SessionHttpRequest["model"],
  expected: GoogleOwnedBinding["model"],
): boolean {
  return (
    expected.providerID !== "" &&
    expected.id !== "" &&
    expected.variant !== "" &&
    ref.providerID === expected.providerID &&
    ref.id === expected.id &&
    ref.variant === expected.variant
  );
}

function isJsonContentType(value: string | null): boolean {
  return value !== null && /^application\/json(?:\s*;|$)/i.test(value.trim());
}

function headerEntries(request: Request): Array<[string, string]> {
  return [...request.headers.entries()];
}

function waitBoundsOf(policy: unknown): GoogleRequestWaitBounds {
  let isArray: boolean;
  try {
    isArray = Array.isArray(policy);
  } catch {
    throw fail("wait-policy-invalid");
  }
  if (typeof policy !== "object" || policy === null || isArray) {
    throw fail("wait-policy-invalid");
  }
  const timeoutMs = ownValue(policy, "timeoutMs");
  if (!isBoundedInteger(timeoutMs, MAX_TIMER_DELAY_MS)) {
    throw fail("wait-policy-invalid");
  }
  return Object.freeze({ timeoutMs });
}

function createRequestWait(
  event: SessionHttpRequest,
  bounds: GoogleRequestWaitBounds,
): GoogleRequestWait {
  const startedAt = performance.now();
  let initialRequest: Request;
  let initialSignal: AbortSignal;
  try {
    initialRequest = event.request;
    initialSignal = initialRequest.signal;
  } catch {
    throw fail("read-failed");
  }

  const controller = new AbortController();
  const deadline = startedAt + bounds.timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retiredError: GoogleOwnedRequestError | undefined;
  let cleaned = false;
  let rejectInterruption: (reason: unknown) => void = () => undefined;
  const interruption = new Promise<never>((_, reject) => {
    rejectInterruption = reject;
  });
  interruption.catch(() => undefined);
  const retire = (code: "wait-timeout" | "wait-aborted"): void => {
    if (retiredError !== undefined) return;
    retiredError = fail(code);
    try {
      controller.abort();
    } catch {
      // The internal controller is local; a failure still retires this invocation.
    }
    rejectInterruption(retiredError);
  };
  const onAbort = (): void => retire("wait-aborted");
  let listeningForAbort = false;
  try {
    if (initialSignal.aborted) {
      retire("wait-aborted");
    } else {
      initialSignal.addEventListener("abort", onAbort, { once: true });
      listeningForAbort = true;
    }
    if (retiredError === undefined) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        retire("wait-timeout");
      } else {
        timer = setTimeout(() => retire("wait-timeout"), Math.ceil(remaining));
      }
    }
  } catch {
    if (timer !== undefined) {
      try {
        clearTimeout(timer);
      } catch {
        // Preserve the sanitized setup failure if timer cleanup also fails.
      }
    }
    try {
      initialSignal.removeEventListener("abort", onAbort);
    } catch {
      // No external request mutation is performed during cleanup.
    }
    throw fail("wait-failed");
  }

  const check = (): void => {
    if (retiredError !== undefined) throw retiredError;
    if (performance.now() >= deadline) {
      retire("wait-timeout");
      throw retiredError;
    }
  };
  return {
    signal: controller.signal,
    initialRequest,
    initialSignal,
    isInterruption: (error) =>
      retiredError !== undefined && error === retiredError,
    pauseOriginalAbort(): void {
      if (!listeningForAbort) return;
      try {
        initialSignal.removeEventListener("abort", onAbort);
        listeningForAbort = false;
      } catch {
        throw fail("wait-failed");
      }
    },
    resumeOriginalAbort(): void {
      if (listeningForAbort || initialSignal.aborted) return;
      try {
        initialSignal.addEventListener("abort", onAbort, { once: true });
        listeningForAbort = true;
      } catch {
        throw fail("wait-failed");
      }
    },
    async run<T>(operation: PromiseLike<T> | T): Promise<T> {
      const pending = Promise.resolve(operation);
      pending.catch(() => undefined);
      check();
      let value: T;
      try {
        value = await Promise.race([pending, interruption]);
      } catch (error) {
        check();
        throw error;
      }
      check();
      return value;
    },
    check,
    cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      let succeeded = true;
      if (timer !== undefined) {
        try {
          clearTimeout(timer);
        } catch {
          succeeded = false;
        }
      }
      if (listeningForAbort) {
        try {
          initialSignal.removeEventListener("abort", onAbort);
          listeningForAbort = false;
        } catch {
          succeeded = false;
        }
      }
      if (!succeeded) throw fail("wait-failed");
    },
  };
}

function readBoundsOf(policy: unknown): GoogleRequestReadBounds {
  let isArray: boolean;
  try {
    isArray = Array.isArray(policy);
  } catch {
    throw fail("policy-invalid");
  }
  if (typeof policy !== "object" || policy === null || isArray) {
    throw fail("policy-invalid");
  }
  const maxBytes = ownValue(policy, "maxBytes");
  const timeoutMs = ownValue(policy, "timeoutMs");
  if (
    !isBoundedInteger(maxBytes, Number.MAX_SAFE_INTEGER) ||
    !isBoundedInteger(timeoutMs, MAX_TIMER_DELAY_MS)
  ) {
    throw fail("policy-invalid");
  }
  return Object.freeze({ maxBytes, timeoutMs });
}

// Reads one own data property. Missing and inherited keys, accessors and throwing descriptor traps all yield
// UNREADABLE. A proxy trap can run code, so a throwing trap is caught here rather than assumed not to run.
function ownValue(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      return UNREADABLE;
    }
    return descriptor.value;
  } catch {
    return UNREADABLE;
  }
}

function isBoundedInteger(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= max
  );
}

// Reads the cloned body incrementally. The original request is never read, cancelled or consumed. Bytes are counted
// with the intrinsic TypedArray byteLength getter before any chunk is retained or decoded. Every setup step is inside
// the opaque error boundary, and acquired resources are released on every outcome.
async function readBoundedText(
  original: Request,
  bounds: GoogleRequestReadBounds,
  waitSignal: AbortSignal,
): Promise<string> {
  let signal: AbortSignal | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners: Array<[AbortSignal, () => void]> = [];
  let abandon = false;
  let failure: GoogleOwnedRequestError | undefined;
  let text: string | undefined;

  try {
    signal = original.signal;
    if (signal.aborted || waitSignal.aborted) {
      throw readerError("read-aborted");
    }

    const copy = original.clone();
    if (signal.aborted || waitSignal.aborted) {
      throw readerError("read-aborted");
    }
    const body = copy.body;
    if (signal.aborted || waitSignal.aborted) {
      throw readerError("read-aborted");
    }
    if (body === null) {
      text = "";
    } else {
      reader = body.getReader();
      const deadline = performance.now() + bounds.timeoutMs;
      let rejectInterruption: (reason: unknown) => void = () => undefined;
      const interruption = new Promise<never>((_, rejectPromise) => {
        rejectInterruption = rejectPromise;
      });
      interruption.catch(() => undefined);
      const abortListener = (): void =>
        rejectInterruption(readerError("read-aborted"));

      timer = setTimeout(
        () => rejectInterruption(readerError("read-timeout")),
        bounds.timeoutMs,
      );
      for (const readSignal of [signal, waitSignal]) {
        listeners.push([readSignal, abortListener]);
        readSignal.addEventListener("abort", abortListener, { once: true });
      }

      const decoder = new TextDecoder("utf-8");
      const pieces: string[] = [];
      let received = 0;
      for (;;) {
        if (signal.aborted || waitSignal.aborted) {
          throw readerError("read-aborted");
        }
        if (performance.now() >= deadline) {
          throw readerError("read-timeout");
        }
        const step = await Promise.race([interruption, reader.read()]);
        if (performance.now() >= deadline) {
          throw readerError("read-timeout");
        }
        if (signal.aborted || waitSignal.aborted) {
          throw readerError("read-aborted");
        }
        if (step.done) {
          break;
        }
        if (!(step.value instanceof Uint8Array)) {
          throw readerError("read-failed");
        }
        let chunkBytes: number;
        try {
          if (typeof TYPED_ARRAY_BYTE_LENGTH !== "function") {
            throw new TypeError();
          }
          chunkBytes = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, step.value, []);
        } catch {
          throw readerError("read-failed");
        }
        if (chunkBytes > bounds.maxBytes - received) {
          throw readerError("body-too-large");
        }
        received += chunkBytes;
        const piece = decoder.decode(step.value, { stream: true });
        if (piece !== "") {
          pieces.push(piece);
        }
      }
      const finalPiece = decoder.decode();
      if (finalPiece !== "") {
        pieces.push(finalPiece);
      }
      text = pieces.join("");
    }
  } catch (error) {
    abandon = true;
    failure =
      error instanceof GoogleOwnedRequestError && READER_ERRORS.has(error)
        ? error
        : fail("read-failed");
  } finally {
    let cleanupSucceeded = true;
    if (timer !== undefined) {
      try {
        clearTimeout(timer);
      } catch {
        cleanupSucceeded = false;
      }
    }
    for (const [readSignal, listener] of listeners) {
      try {
        readSignal.removeEventListener("abort", listener);
      } catch {
        cleanupSucceeded = false;
      }
    }
    if (reader !== undefined) {
      cleanupSucceeded = releaseReader(reader, abandon) && cleanupSucceeded;
    }
    if (!cleanupSucceeded && failure === undefined) {
      failure = fail("read-failed");
    }
  }

  if (failure !== undefined) {
    throw failure;
  }
  if (text === undefined) {
    throw fail("read-failed");
  }
  return text;
}

const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;

// Releases only the cloned reader. Cancellation is observed but never awaited: a tee branch can wait for the original
// branch, and a source may never settle. A pending read may keep the clone locked until the host settles it.
function releaseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  abandon: boolean,
): boolean {
  let succeeded = true;
  if (abandon) {
    try {
      const cancellation = reader.cancel();
      cancellation.catch(() => undefined);
    } catch {
      succeeded = false;
    }
  }
  try {
    reader.releaseLock();
  } catch {
    succeeded = false;
  }
  return succeeded;
}

type Packet = Record<string, unknown> & { readonly contents: unknown[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Accepts the packet shape the native Gemini protocol produces: an object root with a contents array, and an
// optional generationConfig object. A present output cap must be a finite JSON number and is kept as it is,
// including zero and negative values, because the native body schema only requires a number.
function parsePacket(text: string): Packet {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw fail("parse-failed");
  }
  if (!isPlainObject(value) || !Array.isArray(value.contents)) {
    throw fail("shape-rejected");
  }
  const generationConfig = value.generationConfig;
  if (generationConfig === undefined) {
    return value as Packet;
  }
  if (!isPlainObject(generationConfig)) {
    throw fail("shape-rejected");
  }
  if (
    Object.hasOwn(generationConfig, "maxOutputTokens") &&
    !(
      typeof generationConfig.maxOutputTokens === "number" &&
      Number.isFinite(generationConfig.maxOutputTokens)
    )
  ) {
    throw fail("cap-invalid");
  }
  return value as Packet;
}

// Replaces only generationConfig.thinkingConfig with the planned control, so inherited fields such as
// includeThoughts or thinkingLevel are removed. Every other key, including the cap, is carried unchanged. A missing
// generationConfig is created only to hold the thinking control.
function withThinkingConfig(packet: Packet, control: GoogleControl): Packet {
  const generationConfig = isPlainObject(packet.generationConfig)
    ? packet.generationConfig
    : {};
  return {
    ...packet,
    generationConfig: { ...generationConfig, thinkingConfig: { ...control } },
  };
}

// The native copy keeps the method, URL, headers, redirect, credentials, cache, mode, keepalive, integrity and the
// abort link (its signal follows the original's). Node 24.9 does not carry referrer and referrerPolicy from the input,
// so both are passed back from the original's own values. Only the body is new.
function rebuildRequest(original: Request, packet: Packet): Request {
  try {
    return new Request(original, {
      body: JSON.stringify(packet),
      referrer: original.referrer,
      referrerPolicy: original.referrerPolicy,
    });
  } catch {
    throw fail("construction-failed");
  }
}
