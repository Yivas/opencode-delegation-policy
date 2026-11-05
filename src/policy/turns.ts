// Watches the host's public event stream for the end of each turn, which is what consumes a
// configuration notice. Only reading is involved: the plugin starts nothing and sends nothing.
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
  readonly signal: AbortSignal;
  // Waits between attempts. A port so a test does not wait in real time.
  readonly wait?: (milliseconds: number) => Promise<void>;
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

export function watchTurns(ports: TurnWatchPorts): {
  state(): TurnWatchState;
  done: Promise<void>;
} {
  let state: TurnWatchState = "listening";
  const wait =
    ports.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  const done = (async () => {
    let pause = FIRST_PAUSE;
    while (!ports.signal.aborted) {
      try {
        state = "listening";
        for await (const event of ports.subscribe({ signal: ports.signal })) {
          pause = FIRST_PAUSE;
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
      await wait(pause);
      pause = Math.min(pause * 2, MAX_PAUSE);
    }
    state = "stopped";
  })();

  return { state: () => state, done };
}
