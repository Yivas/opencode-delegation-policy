import { createHash } from "node:crypto";

import { reservedAgentIDs } from "../agents/ids.js";
import type { EffectivePreferences } from "../state/effective.js";

// Pi 0.21's local log, adapted: what the plugin did, never what anyone said. Each entry is one value
// in the plugin's own storage under `log/`, so nothing leaves the machine and nothing is appended to
// a shared file. Entries carry no prompt, brief, answer, conversation, session id, path or host
// error: only times, the host version, a hash of the policy block when it changes, the modes in
// force, and, for each launch of one of the plugin's agents, its id, model string, whether it ran in
// the background, how it ended and how long it took. Writing never blocks or breaks a request; a
// failed write is dropped. Old entries are removed past a fixed count.

export const LOG_PREFIX = "log/";
const MAX_ENTRIES = 500;
const PRUNE_EVERY = 25;
const MAX_PENDING = 256;

export type LogStorage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: never): Promise<void>;
  remove(key: string): Promise<void>;
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    readonly entries: readonly {
      readonly key: string;
      readonly value?: unknown;
    }[];
    readonly next?: string;
  }>;
};

export type LogEntry =
  | {
      readonly v: 1;
      readonly at: string;
      readonly kind: "policy";
      readonly host: string;
      readonly hash: string;
      readonly intensity: string;
      readonly advisorMode: string;
      readonly preference: string;
    }
  | {
      readonly v: 1;
      readonly at: string;
      readonly kind: "launch";
      readonly host: string;
      readonly agent: string;
      readonly model?: string;
      readonly background: boolean;
      readonly outcome: "completed" | "running" | "failed";
      readonly ms: number;
    };

type Event = { readonly type: string; readonly data?: unknown };

export type LocalLog = {
  policy(block: string, preferences: EffectivePreferences): void;
  observe(event: Event): void;
  // Settles once every queued write has been tried. For tests and orderly shutdown.
  flush(): Promise<void>;
  // The newest entries, oldest first. Shown by `/delegate log`.
  recent(limit: number): Promise<readonly LogEntry[]>;
};

function field(data: unknown, name: string): unknown {
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[name]
    : undefined;
}

export function createLocalLog(ports: {
  readonly storage: LogStorage;
  readonly hostVersion: string;
  readonly now?: () => number;
}): LocalLog {
  const now = ports.now ?? (() => Date.now());
  const reserved = new Set(reservedAgentIDs());
  let tail: Promise<void> = Promise.resolve();
  let sequence = 0;
  let writes = 0;
  let lastHash: string | undefined;
  // Tool calls named `subagent`, by call id, until their input arrives.
  const named = new Set<string>();
  // Launches of the plugin's agents, by call id, until they end.
  const pending = new Map<
    string,
    { agent: string; model?: string; background: boolean; started: number }
  >();

  const remember = <T>(map: Map<string, T> | Set<string>, key: string) => {
    if (map.size <= MAX_PENDING) return;
    const oldest = map.keys().next().value;
    if (oldest !== undefined && oldest !== key) map.delete(oldest);
  };

  const prune = async () => {
    const keys: string[] = [];
    let after: string | undefined;
    do {
      const page = await ports.storage.scan({
        prefix: LOG_PREFIX,
        limit: 200,
        ...(after === undefined ? {} : { after }),
      });
      for (const entry of page.entries) keys.push(entry.key);
      after = page.next;
    } while (after !== undefined);
    keys.sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
      await ports.storage.remove(key);
    }
  };

  const write = (entry: LogEntry) => {
    const at = now();
    sequence = (sequence + 1) % 1_000_000;
    // Keys sort by time, then by order within the same millisecond.
    const key = `${LOG_PREFIX}${String(at).padStart(15, "0")}-${String(sequence).padStart(6, "0")}`;
    tail = tail
      .then(async () => {
        await ports.storage.set(key, entry as never);
        writes += 1;
        if (writes % PRUNE_EVERY === 0) await prune();
      })
      .catch(() => {
        // A log that cannot be written is not worth a broken request; the entry is dropped.
      });
  };

  const stamp = () => ({
    v: 1 as const,
    at: new Date(now()).toISOString(),
    host: ports.hostVersion,
  });

  return {
    policy(block, preferences) {
      const hash = createHash("sha256")
        .update(block)
        .digest("hex")
        .slice(0, 16);
      if (hash === lastHash) return;
      lastHash = hash;
      write({
        ...stamp(),
        kind: "policy",
        hash,
        intensity: preferences.intensity,
        advisorMode: preferences.advisorMode,
        preference: preferences.preference,
      });
    },

    observe(event) {
      const id = field(event.data, "id");
      if (typeof id !== "string") return;
      switch (event.type) {
        case "session.tool.input.started": {
          if (field(event.data, "name") === "subagent") {
            named.add(id);
            remember(named, id);
          }
          return;
        }
        case "session.tool.called": {
          if (!named.delete(id)) return;
          const input = field(event.data, "input");
          const agent = field(input, "agent");
          if (typeof agent !== "string" || !reserved.has(agent)) return;
          const model = field(input, "model");
          pending.set(id, {
            agent,
            ...(typeof model === "string" ? { model } : {}),
            background: field(input, "background") === true,
            started: now(),
          });
          remember(pending, id);
          return;
        }
        case "session.tool.success":
        case "session.tool.failed": {
          const launch = pending.get(id);
          if (launch === undefined) return;
          pending.delete(id);
          const status = field(field(event.data, "metadata"), "status");
          write({
            ...stamp(),
            kind: "launch",
            agent: launch.agent,
            ...(launch.model === undefined ? {} : { model: launch.model }),
            background: launch.background,
            outcome:
              event.type === "session.tool.failed"
                ? "failed"
                : status === "running"
                  ? "running"
                  : "completed",
            ms: Math.max(0, now() - launch.started),
          });
          return;
        }
        default:
          return;
      }
    },

    flush: () => tail,

    async recent(limit) {
      await tail;
      const found: LogEntry[] = [];
      let after: string | undefined;
      do {
        const page = await ports.storage.scan({
          prefix: LOG_PREFIX,
          limit: 200,
          ...(after === undefined ? {} : { after }),
        });
        for (const entry of page.entries) {
          const value = (entry as { value?: unknown }).value;
          if (isEntry(value)) found.push(value);
        }
        after = page.next;
      } while (after !== undefined);
      return found.slice(-limit);
    },
  };
}

// Stored values come back from the host; only entries of this shape are shown.
function isEntry(value: unknown): value is LogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { v?: unknown }).v === 1 &&
    ((value as { kind?: unknown }).kind === "policy" ||
      (value as { kind?: unknown }).kind === "launch")
  );
}
