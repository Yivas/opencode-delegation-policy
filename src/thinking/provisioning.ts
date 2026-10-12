import type { Plugin } from "@opencode/plugin";

import {
  anthropicEffectiveBudgets,
  isAnthropicBudgetModel,
} from "./protocols.js";

// Owned variants add the Pi budget a level needs to a catalogued Anthropic model. They are not
// user data: each id carries this prefix. Any existing variant whose id starts with the prefix blocks
// provisioning for that model, whatever its overlay and whichever preset it names, so nothing is
// adopted or replaced.
export const OWNED_VARIANT_PREFIX = "ocv2-budget-";
const ANTHROPIC_PROVIDER_ID = "anthropic";
const ANTHROPIC_PACKAGE = "@opencode/ai/providers/anthropic";

export type OwnedVariantCode =
  | "limit-invalid"
  | "limit-too-small"
  | "variant-id-collision";

// Host identifiers arrive as branded schema types. At runtime they are primitives, so every check is
// a typeof test; nothing is coerced to a string, and a non-string identity is not eligible.
export type OwnedVariantModel = {
  readonly providerID: unknown;
  readonly id: unknown;
  readonly modelID: unknown;
  readonly package?: unknown;
  readonly limit: { readonly output: unknown };
  readonly variants: readonly { readonly id: unknown }[];
};

export type OwnedVariant = {
  readonly id: string;
  readonly settings: {
    readonly thinking: {
      readonly type: "enabled";
      readonly budgetTokens: number;
    };
  };
};

export type OwnedVariantPlan =
  | { readonly ok: true; readonly variants: readonly OwnedVariant[] }
  | {
      readonly ok: false;
      readonly code: OwnedVariantCode | "model-not-eligible";
    };

// Decides, before any mutation, which owned variants a model needs. A collision on any reserved id
// blocks the whole model, so a user variant is never adopted or replaced.
export function planOwnedBudgetVariants(
  model: OwnedVariantModel,
): OwnedVariantPlan {
  if (
    model.providerID !== ANTHROPIC_PROVIDER_ID ||
    model.package !== ANTHROPIC_PACKAGE ||
    typeof model.modelID !== "string" ||
    typeof model.id !== "string" ||
    !isAnthropicBudgetModel(model.modelID)
  ) {
    return { ok: false, code: "model-not-eligible" };
  }
  const output = model.limit.output;
  if (typeof output !== "number" || !Number.isInteger(output) || output <= 0) {
    return { ok: false, code: "limit-invalid" };
  }
  const budgets = anthropicEffectiveBudgets(output);
  if (budgets.length === 0) {
    return { ok: false, code: "limit-too-small" };
  }
  const variants: OwnedVariant[] = budgets.map(({ budgetTokens }) => ({
    id: `${OWNED_VARIANT_PREFIX}${budgetTokens}`,
    settings: { thinking: { type: "enabled", budgetTokens } },
  }));
  // The whole prefix is reserved, not only the presets computed here: a user variant named with the
  // prefix may be a different budget, and the model must not be adopted or partially provisioned.
  const reserved = model.variants.some(
    (variant) =>
      typeof variant.id === "string" &&
      variant.id.startsWith(OWNED_VARIANT_PREFIX),
  );
  if (reserved) {
    return { ok: false, code: "variant-id-collision" };
  }
  return { ok: true, variants };
}

// The editor and registration shapes used by provisioning: the public ModelDomain transform surface
// (plugin model.ts, blob 55248eaf; registration.ts, blob 3c2f8048).
export type OwnedVariantEditor = {
  list(providerID?: string): readonly OwnedVariantModel[];
  update(
    providerID: string,
    modelID: string,
    update: (model: { variants: { id: unknown }[] }) => void,
  ): void;
};

export type OwnedVariantHandle = { readonly dispose: () => Promise<void> };

export type OwnedVariantTransform = (
  callback: (editor: OwnedVariantEditor) => void,
) => Promise<OwnedVariantHandle>;

// The read barrier. The host's `ctx.model.list()` (adapter.ts, blob 27b674b4) lands in
// `models.available()` (core/plugin/host.ts, blob 37fe4d80), which reads the registry and rebuilds
// any transform that changed inside a batch first (core/model.ts, blob 53563d1c). Only the ordering
// matters here: the result is discarded and never stored.
export type OwnedVariantRead = () => Promise<unknown>;

// The port the provisioner needs. It is passed as one value so tests use the same two ends the host
// exposes, and nothing else from the host is reachable from here.
export type OwnedVariantPort = {
  readonly transform: OwnedVariantTransform;
  readonly read: OwnedVariantRead;
};

// Compile-time checks that the host surfaces fit the port. Nothing runs at import time.
export function adaptHostTransform(
  transform: Plugin.Context["model"]["transform"],
): OwnedVariantTransform {
  return transform;
}

export function adaptHostRead(
  list: Plugin.Context["model"]["list"],
): OwnedVariantRead {
  return () => list();
}

export type OwnedVariantSkip = {
  readonly modelID: string;
  readonly code: "limit-invalid" | "limit-too-small" | "variant-id-collision";
};

type RegisteredResult = {
  readonly status: "registered";
  readonly provisioned: readonly {
    readonly modelID: string;
    readonly variantIDs: readonly string[];
  }[];
  readonly skipped: readonly OwnedVariantSkip[];
};

export type OwnedVariantRegistration =
  | RegisteredResult
  | { readonly status: "already-registered" };

// Opaque messages only. Host errors can carry provider or credential detail, so none are copied.
const REGISTRATION_FAILED = "owned variant registration failed";
const READ_FAILED = "owned variant read failed";
const TRANSFORM_NOT_RUN = "owned variant transform did not run";
const TRANSFORM_FAILED = "owned variant transform failed";
const CLEANUP_FAILED = "owned variant cleanup failed";

// One attempt to register. `result` is written only by the callback and is published by the
// provisioner only after the read barrier has confirmed it. The callback stops writing once retired.
type Attempt = {
  handle: OwnedVariantHandle | undefined;
  ran: boolean;
  failed: boolean;
  retired: boolean;
  result: RegisteredResult | undefined;
};

// Owns one registration at a time. Three pieces of state:
// - `current`: a registration whose callback result the read barrier validated (or a reload kept).
// - `latest`: that result, published only while `current` is valid.
// - `cleanup`: a handle whose disposal failed; the only thing kept, and retried before anything else.
// Register and dispose run one at a time, so no two transforms overlap and no attempt is judged
// while another one is still unresolved.
export function createOwnedBudgetVariantProvisioner(port: OwnedVariantPort) {
  let current: Attempt | undefined;
  let cleanup: OwnedVariantHandle | undefined;
  let latest: RegisteredResult | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation);
    queue = run.catch(() => undefined);
    return run;
  }

  // The only writer of an attempt's result. An unexpected fault clears `latest` and throws an opaque
  // error, so a host that rejects the candidate publishes nothing partial. The failure is also recorded
  // on the attempt, because a host that swallows the error would otherwise look successful. A callback
  // retired by then changes nothing.
  function callbackFor(attempt: Attempt): (editor: OwnedVariantEditor) => void {
    return (editor) => {
      if (attempt.retired) {
        return;
      }
      attempt.ran = true;
      let result: RegisteredResult;
      try {
        result = provisionEligibleModels(editor);
      } catch {
        // The original error is dropped on purpose: it can carry host detail.
        attempt.result = undefined;
        attempt.failed = true;
        if (attempt === current) {
          latest = undefined;
        }
        throw new Error(TRANSFORM_FAILED);
      }
      attempt.result = result;
      attempt.failed = false;
      if (attempt === current) {
        latest = result;
      }
    };
  }

  async function drainCleanup(): Promise<void> {
    if (cleanup === undefined) {
      return;
    }
    try {
      await cleanup.dispose();
    } catch {
      throw new Error(CLEANUP_FAILED);
    }
    cleanup = undefined;
  }

  // Invalidates before the host disposes, so no success stays published while disposal is pending.
  // A failed disposal keeps only the handle, as a cleanup obligation.
  async function retire(attempt: Attempt): Promise<void> {
    attempt.retired = true;
    if (attempt === current) {
      current = undefined;
      latest = undefined;
    }
    const handle = attempt.handle;
    attempt.handle = undefined;
    if (handle === undefined) {
      return;
    }
    try {
      await handle.dispose();
    } catch {
      cleanup = handle;
      throw new Error(CLEANUP_FAILED);
    }
  }

  async function abandon(attempt: Attempt, reason: string): Promise<never> {
    await retire(attempt);
    throw new Error(reason);
  }

  async function registerOnce(): Promise<OwnedVariantRegistration> {
    await drainCleanup();
    if (current?.failed === true) {
      await retire(current);
    }
    if (current !== undefined) {
      return { status: "already-registered" };
    }

    const attempt: Attempt = {
      handle: undefined,
      ran: false,
      failed: false,
      retired: false,
      result: undefined,
    };
    let handle: unknown;
    try {
      handle = await port.transform(callbackFor(attempt));
    } catch {
      // A transform that rejects after running its callback has no handle to dispose. Nothing is
      // published, and the retired flag keeps any later callback from changing state.
      attempt.retired = true;
      throw new Error(REGISTRATION_FAILED);
    }
    if (!isHandle(handle)) {
      attempt.retired = true;
      throw new Error(REGISTRATION_FAILED);
    }
    attempt.handle = handle;

    // A callback that already produced a valid result needs no barrier. Otherwise the read activates
    // a transform that is still deferred inside a host batch, and only then is the result judged.
    const immediate =
      attempt.ran && !attempt.failed && attempt.result !== undefined;
    if (!immediate) {
      try {
        await port.read();
      } catch {
        await abandon(attempt, READ_FAILED);
      }
    }

    if (attempt.ran && !attempt.failed && attempt.result !== undefined) {
      current = attempt;
      latest = attempt.result;
      return attempt.result;
    }
    await abandon(attempt, attempt.ran ? TRANSFORM_FAILED : TRANSFORM_NOT_RUN);
    throw new Error(TRANSFORM_NOT_RUN);
  }

  return {
    register: () => serialize(registerOnce),

    dispose: () =>
      serialize(async () => {
        await drainCleanup();
        if (current !== undefined) {
          await retire(current);
        }
      }),

    // The most recent validated result. A reload that reruns the callback replaces it; a failed
    // rerun clears it.
    latestResult: (): OwnedVariantRegistration | undefined => latest,
  };
}

function isHandle(value: unknown): value is OwnedVariantHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { dispose?: unknown }).dispose === "function"
  );
}

// Two phases. Planning reads every model and decides, per model, between a skip and a set of variants,
// without touching the editor; only a complete plan is written. Expected per-model rejections (a
// collision, an invalid limit, a limit too small) are skips, and the other models still provision.
// An unexpected fault while planning throws before the first edit, so nothing is partly written. An
// unexpected fault in an edit throws too, and the caller turns it into a rejected candidate.
function provisionEligibleModels(editor: OwnedVariantEditor): RegisteredResult {
  const planned: { modelID: string; variants: readonly OwnedVariant[] }[] = [];
  const skipped: OwnedVariantSkip[] = [];
  for (const model of editor.list(ANTHROPIC_PROVIDER_ID)) {
    if (typeof model.id !== "string") {
      continue;
    }
    const modelID = model.id;
    const plan = planOwnedBudgetVariants(model);
    if (!plan.ok) {
      if (plan.code !== "model-not-eligible") {
        skipped.push({ modelID, code: plan.code });
      }
      continue;
    }
    planned.push({ modelID, variants: plan.variants });
  }
  for (const { modelID, variants } of planned) {
    editor.update(ANTHROPIC_PROVIDER_ID, modelID, (draft) => {
      // A new array keeps the user's variant array untouched when the host copies the draft.
      draft.variants = [...draft.variants, ...variants];
    });
  }
  return {
    status: "registered",
    provisioned: planned.map(({ modelID, variants }) => ({
      modelID,
      variantIDs: variants.map((variant) => variant.id),
    })),
    skipped,
  };
}
