const UNREADABLE = Symbol("unreadable");

export function declaredBodyModelMatches(
  model: unknown,
  variant: unknown,
  expectedWireModelID: string,
): boolean {
  if (expectedWireModelID.length === 0) return false;

  try {
    const modelBody = bodyModel(model);
    const variantBody = bodyModel(variant);
    if (modelBody === UNREADABLE || variantBody === UNREADABLE) return false;

    const effectiveModel = variantBody ?? modelBody;
    return (
      effectiveModel === undefined ||
      (typeof effectiveModel === "string" &&
        effectiveModel === expectedWireModelID)
    );
  } catch {
    return false;
  }
}

function bodyModel(owner: unknown): string | undefined | typeof UNREADABLE {
  const body = ownData(owner, "body");
  if (body === UNREADABLE) return UNREADABLE;
  if (body === undefined) return undefined;
  if (!isPlainRecord(body)) return UNREADABLE;

  const model = ownData(body, "model");
  if (model === UNREADABLE) return UNREADABLE;
  if (model === undefined) return undefined;
  return typeof model === "string" ? model : UNREADABLE;
}

function ownData(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return UNREADABLE;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  return "value" in descriptor ? descriptor.value : UNREADABLE;
}

function isPlainRecord(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
