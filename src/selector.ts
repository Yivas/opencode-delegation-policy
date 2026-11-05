// The interactive way into `/delegate`: a few host dialogs that build the same line a person could
// type, then hand it to the same server path. It adds discoverability, not a second implementation:
// the grammar, validation and storage stay where they are, and cancelling any dialog changes nothing.
// It uses only the host's promise dialogs, so it needs no UI library at runtime.

export type SelectOption<Value> = {
  readonly title: string;
  readonly value: Value;
  readonly description?: string;
};

export type SelectorDialogs = {
  readonly select: <Value>(options: {
    title: string;
    options: readonly SelectOption<Value>[];
  }) => Promise<Value | undefined>;
  readonly prompt: (options: {
    title: string;
    description?: string;
    placeholder?: string;
  }) => Promise<string | undefined>;
};

const INTENSITIES = ["off", "normal", "aggressive", "orchestrator"] as const;
const ADVISOR_MODES = ["off", "on", "with-delegation"] as const;
const PREFERENCES = ["efficient", "standard", "intensive"] as const;
const ROLES = ["small", "medium", "large", "visual-design"] as const;

type Action =
  | "status"
  | "session-intensity"
  | "session-advisor"
  | "session-preference"
  | "session-reset"
  | "session-clear"
  | "defaults-intensity"
  | "defaults-advisor"
  | "defaults-preference"
  | "defaults-role"
  | "defaults-thinking"
  | "defaults-advisors"
  | "log";

function choices<T extends string>(values: readonly T[]): SelectOption<T>[] {
  return values.map((value) => ({ title: value, value }));
}

// One word of free text, as the grammar splits on spaces. Empty or cancelled means no change.
function word(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" || /\s/.test(trimmed)
    ? undefined
    : trimmed;
}

// Returns the `/delegate` arguments to run, or undefined when the person cancelled.
export async function chooseDelegateLine(
  dialogs: SelectorDialogs,
  sessionOpen: boolean,
): Promise<string | undefined> {
  const sessionActions: SelectOption<Action>[] = sessionOpen
    ? [
        { title: "This session: intensity", value: "session-intensity" },
        { title: "This session: Advisor mode", value: "session-advisor" },
        {
          title: "This session: model preference",
          value: "session-preference",
        },
        {
          title: "This session: reset",
          value: "session-reset",
          description: "Turn this session's delegation and Advisor off.",
        },
        {
          title: "This session: clear",
          value: "session-clear",
          description: "Drop this session's changes and follow the defaults.",
        },
      ]
    : [];
  const action = await dialogs.select<Action>({
    title: "Delegation",
    options: [
      { title: "Show status", value: "status" },
      ...sessionActions,
      { title: "Defaults: intensity", value: "defaults-intensity" },
      { title: "Defaults: Advisor mode", value: "defaults-advisor" },
      { title: "Defaults: model preference", value: "defaults-preference" },
      { title: "Defaults: role model", value: "defaults-role" },
      { title: "Defaults: role thinking", value: "defaults-thinking" },
      { title: "Defaults: Advisors", value: "defaults-advisors" },
      { title: "Show the local log", value: "log" },
    ],
  });

  switch (action) {
    case undefined:
      return undefined;
    case "status":
      return "status";
    case "log":
      return "log";
    case "session-reset":
      return "reset";
    case "session-clear":
      return "clear";
    case "session-intensity": {
      const value = await dialogs.select({
        title: "Intensity for this session",
        options: choices(INTENSITIES),
      });
      return value;
    }
    case "session-advisor": {
      const value = await dialogs.select({
        title: "Advisor mode for this session",
        options: choices(ADVISOR_MODES),
      });
      return value === undefined ? undefined : `advisor ${value}`;
    }
    case "session-preference": {
      const value = await dialogs.select({
        title: "Model preference for this session",
        options: choices(PREFERENCES),
      });
      return value === undefined ? undefined : `preference ${value}`;
    }
    case "defaults-intensity": {
      const value = await dialogs.select({
        title: "Default intensity",
        options: choices(INTENSITIES),
      });
      return value === undefined ? undefined : `defaults intensity ${value}`;
    }
    case "defaults-advisor": {
      const value = await dialogs.select({
        title: "Default Advisor mode",
        options: choices(ADVISOR_MODES),
      });
      return value === undefined ? undefined : `defaults advisor-mode ${value}`;
    }
    case "defaults-preference": {
      const value = await dialogs.select({
        title: "Default model preference",
        options: choices(PREFERENCES),
      });
      return value === undefined ? undefined : `defaults preference ${value}`;
    }
    case "defaults-role": {
      const role = await dialogs.select({
        title: "Role",
        options: choices(ROLES),
      });
      if (role === undefined) return undefined;
      const model = word(
        await dialogs.prompt({
          title: `Model for ${role}`,
          description: "provider/model, optionally #variant; or off, or unset.",
          placeholder: "provider/model",
        }),
      );
      return model === undefined ? undefined : `defaults role ${role} ${model}`;
    }
    case "defaults-thinking": {
      const role = await dialogs.select({
        title: "Role",
        options: choices(ROLES),
      });
      if (role === undefined) return undefined;
      const level = word(
        await dialogs.prompt({
          title: `Thinking for ${role}`,
          description:
            "A level such as high, a range such as low..high, or unset.",
          placeholder: "high",
        }),
      );
      return level === undefined
        ? undefined
        : `defaults thinking ${role} ${level}`;
    }
    case "defaults-advisors": {
      const value = await dialogs.prompt({
        title: "Advisors",
        description:
          "Up to three provider/model references separated by spaces; or off, or unset.",
        placeholder: "provider/model",
      });
      const models = value?.trim();
      return models === undefined || models === ""
        ? undefined
        : `defaults advisors ${models}`;
    }
  }
}
