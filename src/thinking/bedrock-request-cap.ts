// Stateless reader for the output cap in a prepared Bedrock Converse request body. It observes one Request snapshot
// and returns a fixed result. It does not classify routes, owners or providers, does not correlate requests, and does
// not register or change anything. The caller decides which request is a Bedrock request; this function never does.
//
// The body is read from a native clone, so the original request stays readable. The clone is made with the native
// Request.prototype.clone, captured at load and called on the input directly, so an own override on the input is not
// used. Cloning tees the stream; an unread branch can buffer data, including the original while the clone is read.
// The whole JSON body is buffered and parsed. No size limit, timeout or cancellation policy is applied here: a
// stream that never closes can leave the read pending indefinitely. Integration must address these limits.
//
// The result describes the bytes read from this clone, not the final cap sent on the wire. Later callbacks or
// transport peers can change those bytes. In the pinned Bedrock path, signing precedes the HTTP callback.

export type BedrockPreparedCap =
  | { readonly kind: "known"; readonly value: number }
  | { readonly kind: "absent" };

export type BedrockCapReadCode =
  | "clone"
  | "read"
  | "parse"
  | "no-body"
  | "body-shape";

export type BedrockPreparedCapObservation =
  | {
      readonly kind: "observed";
      readonly scope: "request-snapshot";
      readonly cap: BedrockPreparedCap;
    }
  | {
      readonly kind: "malformed";
      readonly field: "inferenceConfig" | "maxTokens";
    }
  | { readonly kind: "unavailable"; readonly code: BedrockCapReadCode };

const nativeClone = Request.prototype.clone;
const nativeText = Request.prototype.text;

export async function observeBedrockPreparedCap(
  request: Request,
): Promise<BedrockPreparedCapObservation> {
  let copy: Request;
  try {
    copy = Reflect.apply(nativeClone, request, []);
  } catch {
    // A consumed or locked body, and any input that is not a native Request, fail the clone.
    return unavailable("clone");
  }
  let text: string;
  try {
    text = await Reflect.apply(nativeText, copy, []);
  } catch {
    return unavailable("read");
  }
  if (text === "") {
    return unavailable("no-body");
  }
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return unavailable("parse");
  }
  if (!isRecord(root)) {
    return unavailable("body-shape");
  }
  return observeRoot(root);
}

// Only own fields are read. A prototype cannot supply inferenceConfig or maxTokens.
function observeRoot(
  root: Record<string, unknown>,
): BedrockPreparedCapObservation {
  if (!Object.hasOwn(root, "inferenceConfig")) {
    return observed({ kind: "absent" });
  }
  const config = root.inferenceConfig;
  if (!isRecord(config)) {
    return malformed("inferenceConfig");
  }
  if (!Object.hasOwn(config, "maxTokens")) {
    return observed({ kind: "absent" });
  }
  const value = config.maxTokens;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return malformed("maxTokens");
  }
  return observed({ kind: "known", value });
}

function observed(cap: BedrockPreparedCap): BedrockPreparedCapObservation {
  return Object.freeze({
    kind: "observed",
    scope: "request-snapshot",
    cap: Object.freeze(cap),
  });
}

function malformed(
  field: "inferenceConfig" | "maxTokens",
): BedrockPreparedCapObservation {
  return Object.freeze({ kind: "malformed", field });
}

function unavailable(code: BedrockCapReadCode): BedrockPreparedCapObservation {
  return Object.freeze({ kind: "unavailable", code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
