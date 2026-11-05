import type { Plugin } from "@opencode/plugin/tui";

import { delegateRpc } from "./rpc.js";
import { chooseDelegateLine, type SelectorDialogs } from "./selector.js";

// The TUI side of the minimal `/delegate` command. The server owns the preferences, so this only
// forwards the line over RPC and shows the answer in a dialog: a dialog is something the person
// running the command is certain to see, which a message added to the session was not.
//
// Unverified against a real host: that the package's `./tui` entry is loaded, that the slash command
// reaches `run` with the raw line, and that the RPC call connects. Types are checked against the
// published host packages; behavior is not.

const TITLE = "Delegation";

// A request the server never ran. The RPC layer only reports these before the handler is reached.
const NOT_APPLIED = new Set([
  "rpc.unavailable",
  "rpc.method_not_found",
  "rpc.invalid_input",
]);

// The RPC client rejects with a plain `{ type, message }` object. Whatever else was thrown is not
// something this entry can classify, so it is treated as an unconfirmed result.
export function describeRpcFailure(error: unknown): string {
  const type =
    typeof error === "object" && error !== null && "type" in error
      ? (error as { type: unknown }).type
      : undefined;

  if (typeof type === "string" && NOT_APPLIED.has(type)) {
    return [
      "The delegation plugin did not answer, so nothing was changed.",
      "Its server side may not have loaded yet or may not be enabled. Try again in a moment.",
    ].join("\n");
  }
  // The handler may have run before the failure, so neither "saved" nor "not saved" is true to say.
  return [
    "The result could not be confirmed, so the settings it touched may or may not have changed.",
    "Run /delegate status in this session to see the session, or from the home screen to see the defaults.",
  ].join("\n");
}

// A JSON-schema output reaches the client as `unknown`, so the reply is checked where it arrives.
type DelegateRpc = (definition: typeof delegateRpc) => {
  readonly run: (input: {
    line: string;
    sessionID?: string;
  }) => Promise<unknown>;
};

function replyText(answer: unknown): string | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const text = (answer as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}

export type DelegateTuiPorts = {
  readonly rpc: DelegateRpc;
  // The session the person is looking at, if any. Session commands act on it; without one, they are
  // refused by the server and only the defaults can change.
  readonly sessionID: () => string | undefined;
  readonly alert: (options: {
    title: string;
    message: string;
  }) => Promise<void>;
  // The host's dialogs for the interactive selector. Without them a bare `/delegate` shows the
  // status, as typed commands always can.
  readonly dialogs?: SelectorDialogs;
};

// What `/delegate` does in the TUI, separated from the host context so it can be exercised alone. A
// bare `/delegate` opens the selector, which builds the same line a person could type.
export async function runDelegateInTui(
  input: string | undefined,
  ports: DelegateTuiPorts,
): Promise<void> {
  let line = (input ?? "").trim();
  if (line === "/delegate") line = "";
  if (line === "" && ports.dialogs !== undefined) {
    let chosen: string | undefined;
    let openedSession: string | undefined;
    try {
      openedSession = ports.sessionID();
      chosen = await chooseDelegateLine(
        ports.dialogs,
        openedSession !== undefined,
      );
      // Cancelling the selector is not a request: nothing is sent and nothing is shown.
      if (chosen === undefined) return;
      if (ports.sessionID() !== openedSession) {
        await ports.alert({
          title: TITLE,
          message:
            "The open session changed while the selector was open. Nothing was sent. Run /delegate again in the session you want to change.",
        });
        return;
      }
    } catch {
      await ports.alert({
        title: TITLE,
        message:
          "The delegation selector could not finish. Nothing was sent. Try again, or type /delegate status to check the settings.",
      });
      return;
    }
    line = chosen;
  }

  let message: string;
  try {
    const sessionID = ports.sessionID();
    const answer = await ports.rpc(delegateRpc).run({
      line,
      ...(sessionID === undefined ? {} : { sessionID }),
    });
    // A reply without text would otherwise show an empty dialog that looks like a success.
    message =
      replyText(answer) ?? describeRpcFailure({ type: "rpc.invalid_output" });
  } catch (error) {
    message = describeRpcFailure(error);
  }
  await ports.alert({ title: TITLE, message });
}

const plugin: Plugin.Definition = {
  id: "opencode-delegation-policy",
  setup(context) {
    context.keymap.layer(() => ({
      commands: [
        {
          id: "opencode-delegation-policy.delegate",
          title: "Delegation settings",
          group: "Delegation",
          // Keeps the typed line in the prompt and hands it to `run` raw.
          slash: { name: "delegate", arguments: true },
          run: (input) =>
            runDelegateInTui(input, {
              rpc: (definition) => context.client.rpc(definition),
              alert: (options) => context.ui.dialog.alert(options),
              dialogs: {
                select: (options) => context.ui.dialog.select(options),
                prompt: (options) => context.ui.dialog.prompt(options),
              },
              sessionID: () => {
                const route = context.ui.router.current();
                return route.type === "session" ? route.sessionID : undefined;
              },
            }),
        },
      ],
    }));
  },
};

export default plugin;
