import { isDeepStrictEqual } from "node:util";

import type { SessionHttpRequest } from "@opencode/plugin/promise/session";

import {
  type GoogleControl,
  googleApiForPackage,
  planGoogleLevel,
} from "./google.js";
import type { ThinkingLevel } from "./policies.js";

// Inert request writer for an owned Google thinking binding. It is a function a future integration may register
// as a session `http.request` callback. This module registers nothing, reads no session, configuration,
// environment or credential, and sends nothing.
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

export type GoogleRequestErrorCode =
  | "ownership-failed"
  | "binding-stale"
  | "binding-mismatch"
  | "binding-unsupported"
  | "auth-unverified"
  | "stale-content-length"
  | "shape-rejected"
  | "cap-invalid"
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

export function createGoogleOwnedRequestHook(
  ownership: GoogleRequestOwnership,
): GoogleOwnedRequestHook {
  return async (event) => {
    const first = await classifyOwnership(ownership, event);
    if (first === undefined) {
      // Foreign, inline and unknown requests keep their identity, and their body is not read.
      return;
    }
    const control = controlFor(event, first, ownership);

    const original = event.request;
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

    const parsed = parsePacket(await readText(original));
    const next = withThinkingConfig(parsed, control);

    // The ownership, the lifetime, the request object and the headers are checked again after the await, and before
    // the synchronous assignment. A change in any of them rejects the write instead of restoring older state.
    const second = await classifyOwnership(ownership, event);
    if (second === undefined) {
      throw fail("binding-stale");
    }
    if (!isDeepStrictEqual(second, first)) {
      throw fail("binding-mismatch");
    }
    controlFor(event, second, ownership);
    if (
      event.request !== original ||
      !isDeepStrictEqual(headerEntries(original), headersBefore)
    ) {
      throw fail("request-changed");
    }

    // A packet that already carries the planned subtree keeps its request object, so repetition is an identity no-op.
    if (isDeepStrictEqual(parsed, next)) {
      return;
    }
    event.request = rebuildRequest(original, next);
  };
}

function fail(code: GoogleRequestErrorCode): GoogleOwnedRequestError {
  return new GoogleOwnedRequestError(code);
}

// The port may throw or reject with arbitrary values, including secrets. Each port failure becomes the fixed
// ownership error, so no message, cause or stack from the port reaches the caller. Ownership is never inferred
// from a failure: it stops the write.
async function classifyOwnership(
  ownership: GoogleRequestOwnership,
  event: SessionHttpRequest,
): Promise<GoogleOwnedBinding | undefined> {
  let classification: GoogleRequestClassification;
  try {
    classification = await ownership.classify(event);
  } catch {
    throw fail("ownership-failed");
  }
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

// Reads from a clone, so the original request stays readable for the caller.
async function readText(request: Request): Promise<string> {
  try {
    return await request.clone().text();
  } catch {
    throw fail("read-failed");
  }
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
