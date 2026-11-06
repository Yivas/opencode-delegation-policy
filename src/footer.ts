// The D/A status shown beside the host's prompt footer. This module holds only the parts that need
// no terminal runtime: the tokens, the label, the reply check and the refresh logic. The view that
// renders it lives in footer-view.ts and is loaded only inside the host.

export const DELEGATION_TOKENS = ["OFF", "NORM", "AGG", "ORCH", "ERR"] as const;
export const ADVISOR_TOKENS = ["OFF", "ON", "PART", "ERR"] as const;

export type DelegationToken = (typeof DELEGATION_TOKENS)[number];
export type AdvisorToken = (typeof ADVISOR_TOKENS)[number];

export type FooterState = {
  readonly delegation: DelegationToken;
  readonly advisor: AdvisorToken;
};

// Shown while the state is being read and whenever it cannot be confirmed. It never repeats an
// older answer: a stale state that looks confirmed is worse than saying it is not known.
export const UNKNOWN_LABEL = "D:? A:?";

// How often the label is read again, in case a change event was missed. Events are live only and
// the host does not replay them after a disconnect.
export const FOOTER_REFRESH_MS = 30_000;

// How long a read may take before the label stops claiming anything. A periodic read keeps the
// confirmed label while it runs, so this bounds how old a label on screen can be: one period plus this.
export const FOOTER_READ_TIMEOUT_MS = 10_000;

export function footerLabel(state: FooterState | undefined): string {
  return state === undefined
    ? UNKNOWN_LABEL
    : `D:${state.delegation} A:${state.advisor}`;
}

// The server's reply reaches the client as `unknown`; anything outside the contract is unknown.
export function parseFooterState(value: unknown): FooterState | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { delegation, advisor } = value as {
    delegation?: unknown;
    advisor?: unknown;
  };
  const isDelegation = (token: unknown): token is DelegationToken =>
    typeof token === "string" &&
    (DELEGATION_TOKENS as readonly string[]).includes(token);
  const isAdvisor = (token: unknown): token is AdvisorToken =>
    typeof token === "string" &&
    (ADVISOR_TOKENS as readonly string[]).includes(token);
  return isDelegation(delegation) && isAdvisor(advisor)
    ? { delegation, advisor }
    : undefined;
}

export type FooterPorts = {
  // Reads the state for the open session, or the defaults when there is none.
  readonly read: (sessionID: string | undefined) => Promise<unknown>;
  // Calls the handler whenever the server says the settings changed. Returns the unsubscribe.
  readonly changed: (handler: () => void) => () => void;
  // Calls the handler on a fixed period. Returns the cancel.
  readonly every: (milliseconds: number, handler: () => void) => () => void;
  // Calls the handler once after the delay. Returns the cancel.
  readonly after: (milliseconds: number, handler: () => void) => () => void;
};

export type FooterTracker = {
  watch(sessionID: string | undefined): void;
  refresh(): void;
  dispose(): void;
};

// Keeps one label current for one footer. Only the newest read may update it, so a slow answer for
// the previous session can never overwrite the session now open.
export function createFooterTracker(
  ports: FooterPorts,
  update: (label: string) => void,
): FooterTracker {
  let started = false;
  let disposed = false;
  let sessionID: string | undefined;
  let sequence = 0;
  const cleanups: (() => void)[] = [];

  const refresh = () => {
    if (disposed) return;
    sequence += 1;
    const mine = sequence;
    let pending: Promise<unknown>;
    try {
      pending = ports.read(sessionID);
    } catch {
      update(UNKNOWN_LABEL);
      return;
    }
    // A read that never answers must not leave an older label looking confirmed, and an answer that
    // arrives after its deadline describes a moment too old to show: it is dropped, and the label
    // stays unknown until the next read.
    let expired = false;
    const settle = () => {
      cancelDeadline();
      const index = cleanups.indexOf(cancelDeadline);
      if (index !== -1) cleanups.splice(index, 1);
    };
    const cancelDeadline = ports.after(FOOTER_READ_TIMEOUT_MS, () => {
      expired = true;
      settle();
      if (!disposed && mine === sequence) update(UNKNOWN_LABEL);
    });
    cleanups.push(cancelDeadline);
    pending.then(
      (value) => {
        settle();
        if (!expired && !disposed && mine === sequence)
          update(footerLabel(parseFooterState(value)));
      },
      () => {
        settle();
        if (!expired && !disposed && mine === sequence) update(UNKNOWN_LABEL);
      },
    );
  };

  // A change event means the shown state is known to be out of date, so it is not kept on screen
  // while the new one is read. A periodic read only confirms, so the current label stays meanwhile.
  const changedRefresh = () => {
    if (disposed) return;
    update(UNKNOWN_LABEL);
    refresh();
  };

  return {
    watch(next) {
      if (disposed) return;
      if (started && next === sessionID) return;
      sessionID = next;
      if (!started) {
        started = true;
        cleanups.push(ports.changed(changedRefresh));
        cleanups.push(ports.every(FOOTER_REFRESH_MS, refresh));
      }
      update(UNKNOWN_LABEL);
      refresh();
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0)) {
        try {
          cleanup();
        } catch {
          // A host that refuses to unsubscribe must not stop the other cleanups.
        }
      }
    },
  };
}
