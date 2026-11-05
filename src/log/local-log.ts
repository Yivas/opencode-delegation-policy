import { createHash, randomUUID } from "node:crypto";
import type { Plugin } from "@opencode/plugin";

import { reservedAgentIDs } from "../agents/ids.js";
import type { EffectivePreferences } from "../state/effective.js";
import { ADVISOR_MODES, INTENSITIES, PREFERENCES } from "../state/schema.js";

// Content-free observations in the plugin's own storage, never raw tool arguments. In particular,
// `model` is omitted: even a failed launch can carry arbitrary private text in that argument.
// Writes are serialized and dropped when the backlog is full. A stalled host cannot grow the queue
// indefinitely or make a log read wait forever; timeouts stop waiting, not the host's storage call.
export const LOG_PREFIX = "log/";
const MAX_ENTRIES = 500;
const PRUNE_EVERY = 25;
const MAX_PENDING = 256;
const MAX_WRITES = 64;
const READ_TIMEOUT_MS = 1_000;
const MAX_SCAN_PAGES = 20;
const RESERVED_IDS = new Set(reservedAgentIDs());

type LogStorage = Pick<Plugin.Context["storage"], "set" | "remove" | "scan">;

type Stamp = { readonly v: 2; readonly at: string; readonly host: string };
export type LogEntry = Stamp &
  (
    | {
        readonly kind: "policy";
        readonly hash: string;
        readonly intensity: EffectivePreferences["intensity"];
        readonly advisorMode: EffectivePreferences["advisorMode"];
        readonly preference: EffectivePreferences["preference"];
      }
    | {
        readonly kind: "launch";
        readonly agent: string;
        readonly background: boolean;
        readonly outcome: "completed" | "running" | "failed";
        readonly ms: number;
      }
  );

type Event = { readonly type: string; readonly data?: unknown };
export type LocalLog = {
  policy(block: string, preferences: EffectivePreferences): void;
  observe(event: Event): void;
  flush(): Promise<void>;
  recent(limit: number): Promise<readonly LogEntry[]>;
};

function field(data: unknown, name: string): unknown {
  return typeof data === "object" && data !== null
    ? (data as Record<string, unknown>)[name]
    : undefined;
}

// Stored entries can predate the privacy correction or have been changed by another writer. Rebuild
// only known fields of v2 entries; legacy v1 entries containing arbitrary model text are never shown.
function readEntry(value: unknown): LogEntry | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (
    entry.v !== 2 ||
    typeof entry.at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(entry.at) ||
    typeof entry.host !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(entry.host)
  )
    return undefined;
  const stamp: Stamp = { v: 2, at: entry.at, host: entry.host };
  if (
    entry.kind === "policy" &&
    typeof entry.hash === "string" &&
    /^[0-9a-f]{16}$/.test(entry.hash) &&
    INTENSITIES.includes(
      entry.intensity as EffectivePreferences["intensity"],
    ) &&
    ADVISOR_MODES.includes(
      entry.advisorMode as EffectivePreferences["advisorMode"],
    ) &&
    PREFERENCES.includes(entry.preference as EffectivePreferences["preference"])
  ) {
    return {
      ...stamp,
      kind: "policy",
      hash: entry.hash,
      intensity: entry.intensity as EffectivePreferences["intensity"],
      advisorMode: entry.advisorMode as EffectivePreferences["advisorMode"],
      preference: entry.preference as EffectivePreferences["preference"],
    };
  }
  if (
    entry.kind === "launch" &&
    typeof entry.agent === "string" &&
    RESERVED_IDS.has(entry.agent) &&
    typeof entry.background === "boolean" &&
    (entry.outcome === "completed" ||
      entry.outcome === "running" ||
      entry.outcome === "failed") &&
    typeof entry.ms === "number" &&
    Number.isFinite(entry.ms) &&
    entry.ms >= 0
  ) {
    return {
      ...stamp,
      kind: "launch",
      agent: entry.agent,
      background: entry.background,
      outcome: entry.outcome,
      ms: entry.ms,
    };
  }
  return undefined;
}

function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("local log read timed out")),
      READ_TIMEOUT_MS,
    );
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createLocalLog(ports: {
  readonly storage: LogStorage;
  readonly hostVersion: string;
  readonly now?: () => number;
}): LocalLog {
  const now = ports.now ?? (() => Date.now());
  let tail: Promise<void> = Promise.resolve();
  let backlog = 0;
  let writes = 0;
  let lastHash: string | undefined;
  let lastTime = 0;
  const named = new Set<string>();
  const pending = new Map<
    string,
    { agent: string; background: boolean; started: number }
  >();

  const remember = <T>(map: Map<string, T> | Set<string>) => {
    if (map.size <= MAX_PENDING) return;
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  };

  async function scan() {
    const found: { key: string; value: unknown }[] = [];
    let after: string | undefined;
    for (let pageNumber = 0; pageNumber < MAX_SCAN_PAGES; pageNumber += 1) {
      const page = await ports.storage.scan({
        prefix: LOG_PREFIX,
        limit: 200,
        ...(after === undefined ? {} : { after }),
      });
      for (const entry of page.entries) {
        if (entry.key.startsWith(LOG_PREFIX)) found.push(entry);
      }
      if (page.next === undefined)
        return {
          entries: found.sort((a, b) => a.key.localeCompare(b.key)),
          complete: true,
        };
      if (page.next === after)
        throw new Error("local log scan did not advance");
      after = page.next;
    }
    return {
      entries: found.sort((a, b) => a.key.localeCompare(b.key)),
      complete: false,
    };
  }

  const prune = async () => {
    // A bounded partial scan must still retire invalid and excess records. Otherwise an oversized
    // namespace would prevent every later cleanup from making progress.
    const { entries } = await scan();
    // Legacy records may contain private model text. Retire them rather than displaying or migrating
    // them. Only this plugin's log namespace is touched, never settings or another plugin's keys.
    const valid = [];
    for (const entry of entries) {
      if (readEntry(entry.value) === undefined)
        await ports.storage.remove(entry.key);
      else valid.push(entry);
    }
    for (const entry of valid.slice(
      0,
      Math.max(0, valid.length - MAX_ENTRIES),
    )) {
      await ports.storage.remove(entry.key);
    }
  };

  const write = (entry: LogEntry) => {
    if (backlog >= MAX_WRITES) return;
    backlog += 1;
    // UUID avoids collisions between plugin instances or restarts in the same millisecond; the
    // monotonic local timestamp keeps this writer's order even if the wall clock moves backwards.
    lastTime = Math.max(lastTime + 1, now());
    const key = `${LOG_PREFIX}${String(lastTime).padStart(15, "0")}-${randomUUID()}`;
    tail = tail.then(async () => {
      try {
        await ports.storage.set(key, entry);
        writes += 1;
        if (writes === 1 || writes % PRUNE_EVERY === 0) await prune();
      } catch {
        // Logging failure is isolated from the model request; a full queue drops later entries.
      } finally {
        backlog -= 1;
      }
    });
  };

  const stamp = (): Stamp => ({
    v: 2,
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
        case "session.tool.input.started":
          if (field(event.data, "name") === "subagent") {
            named.add(id);
            remember(named);
          }
          return;
        case "session.tool.called": {
          if (!named.delete(id)) return;
          const input = field(event.data, "input");
          const agent = field(input, "agent");
          if (typeof agent !== "string" || !RESERVED_IDS.has(agent)) return;
          pending.set(id, {
            agent,
            background: field(input, "background") === true,
            started: now(),
          });
          remember(pending);
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
      }
    },
    flush: () => bounded(tail),
    recent(limit) {
      return bounded(
        (async () => {
          await tail;
          const { entries, complete } = await scan();
          if (!complete) throw new Error("local log scan limit reached");
          return entries
            .map((entry) => readEntry(entry.value))
            .filter((entry): entry is LogEntry => entry !== undefined)
            .slice(-Math.min(MAX_ENTRIES, Math.max(1, Math.trunc(limit))));
        })(),
      );
    },
  };
}
