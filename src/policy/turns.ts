// Watches the host's public event stream for the end of each turn, which is what consumes a
// configuration notice, and for new sessions, which is the earliest moment a setting saved for the
// next session can be given to one. Only reading is involved: the plugin starts nothing and sends
// nothing.
//
// A stream that ends or fails is opened again after a pause that grows up to a ceiling, until the
// plugin stops. While it is down, turns are not seen to end, so a pending notice keeps repeating
// and a new change waits; the status says so instead of looking healthy.

export type TurnWatchState = "listening" | "reconnecting" | "stopped";

type TurnEvent = {
  readonly type: string;
  readonly data?: unknown;
};

export type TurnWatchPorts = {
  readonly subscribe: (options: {
    readonly signal: AbortSignal;
  }) => AsyncIterable<TurnEvent>;
  readonly ended: (sessionID: string, succeeded: boolean) => void;
  // A session the host has just created, with its parent when it has one. It must not throw and is
  // not awaited: the stream must keep reading while the caller decides what to do.
  readonly created?: (sessionID: string, parentID: string | undefined) => void;
  // Sees every event, for the local log. It must not throw.
  readonly observe?: (event: TurnEvent) => void;
  readonly signal: AbortSignal;
  // Waits between attempts and must settle early when the signal aborts. A port so a test does not
  // wait in real time.
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

const ENDINGS: Readonly<Record<string, boolean>> = {
  "session.execution.succeeded": true,
  "session.execution.failed": false,
  "session.execution.interrupted": false,
};

const FIRST_PAUSE = 1_000;
const MAX_PAUSE = 30_000;

function sessionOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const sessionID = (data as { sessionID?: unknown }).sessionID;
  return typeof sessionID === "string" ? sessionID : undefined;
}

function parentOf(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const parentID = (data as { parentID?: unknown }).parentID;
  return typeof parentID === "string" ? parentID : undefined;
}

export function watchTurns(ports: TurnWatchPorts): {
  state(): TurnWatchState;
  done: Promise<void>;
} {
  let state: TurnWatchState = "listening";
  // Stopping the plugin cancels the pause, so no timer outlives it.
  const wait =
    ports.wait ??
    ((milliseconds: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(done, milliseconds);
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
        signal.addEventListener("abort", done, { once: true });
      }));

  const done = (async () => {
    let pause = FIRST_PAUSE;
    while (!ports.signal.aborted) {
      try {
        state = "listening";
        for await (const event of ports.subscribe({ signal: ports.signal })) {
          pause = FIRST_PAUSE;
          ports.observe?.(event);
          if (event.type === "session.created") {
            const sessionID = sessionOf(event.data);
            if (sessionID !== undefined) {
              ports.created?.(sessionID, parentOf(event.data));
            }
            continue;
          }
          const succeeded = ENDINGS[event.type];
          if (succeeded === undefined) continue;
          const sessionID = sessionOf(event.data);
          if (sessionID !== undefined) ports.ended(sessionID, succeeded);
        }
      } catch {
        // The reason is the host's; it is not shown. The loop below decides what happens next.
      }
      if (ports.signal.aborted) break;
      state = "reconnecting";
      await wait(pause, ports.signal).catch(() => undefined);
      pause = Math.min(pause * 2, MAX_PAUSE);
    }
    state = "stopped";
  })();

  return { state: () => state, done };
}
