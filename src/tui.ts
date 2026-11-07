import type { Plugin } from "@opencode/plugin/tui";
import type { JSX } from "@opentui/solid";

import type {
  EditorClient,
  EditorDialogs,
  SelectorDialogs,
} from "./editor/client.js";
import type { FooterPorts } from "./footer.js";
import { delegateRpc } from "./rpc.js";
import { runDelegatePanel } from "./selector.js";

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
  // The host's dialogs for the settings panel. Without them a bare `/delegate` shows the status, as
  // typed commands always can.
  readonly dialogs?: SelectorDialogs & Partial<Pick<EditorDialogs, "confirm">>;
  readonly editor?: EditorClient;
};

// Runs one typed line through the server and returns what the person should see. A reply without
// text would otherwise show an empty dialog that looks like a success.
async function runLine(
  line: string,
  ports: DelegateTuiPorts,
  sessionID: string | undefined,
): Promise<string> {
  try {
    const answer = await ports.rpc(delegateRpc).run({
      line,
      ...(sessionID === undefined ? {} : { sessionID }),
    });
    return (
      replyText(answer) ?? describeRpcFailure({ type: "rpc.invalid_output" })
    );
  } catch (error) {
    return describeRpcFailure(error);
  }
}

// What `/delegate` does in the TUI, separated from the host context so it can be exercised alone. A
// bare `/delegate` and the `edit` aliases open the settings panel; every other line is a typed
// command and travels unchanged through the existing command RPC.
export async function runDelegateInTui(
  input: string | undefined,
  ports: DelegateTuiPorts,
): Promise<void> {
  let line = (input ?? "").trim();
  if (line === "/delegate") line = "";
  // Normalize only command words for interception. Other lines, including model references, travel
  // unchanged through the existing command RPC.
  const words = line.split(/\s+/).filter(Boolean);
  if (words[0]?.toLowerCase() === "/delegate") words.shift();
  const alias = words.map((word) => word.toLowerCase()).join(" ");
  const opensPanel =
    line === "" ||
    alias === "edit" ||
    alias === "edit session" ||
    alias === "edit defaults";
  if (opensPanel) {
    const sessionID = ports.sessionID();
    // `edit defaults` never takes the open session; without one, every alias works on the defaults.
    const scope: "session" | "defaults" =
      alias === "edit defaults" || sessionID === undefined
        ? "defaults"
        : "session";
    const confirm = ports.dialogs?.confirm;
    if (
      ports.editor !== undefined &&
      ports.dialogs !== undefined &&
      confirm !== undefined
    ) {
      const dialogs = ports.dialogs;
      await runDelegatePanel(
        scope === "session" && sessionID !== undefined
          ? { scope, sessionID }
          : { scope: "defaults" },
        {
          client: ports.editor,
          sessionID: ports.sessionID,
          dialogs: {
            select: (options) => dialogs.select(options),
            prompt: (options) => dialogs.prompt(options),
            confirm: (options) => confirm.call(dialogs, options),
            alert: ports.alert,
          },
          run: (command, scope) =>
            runLine(
              command,
              ports,
              scope.scope === "session" ? scope.sessionID : undefined,
            ),
        },
      );
      return;
    }
    if (line !== "") {
      await ports.alert({
        title: TITLE,
        message:
          "The settings panel is unavailable here. Use the typed /delegate commands.",
      });
      return;
    }
  }

  await ports.alert({
    title: TITLE,
    message: await runLine(line, ports, ports.sessionID()),
  });
}

type FooterRender = (
  ports: FooterPorts,
) => (input: { readonly sessionID?: string | undefined }) => JSX.Element;

type FooterHost = {
  // `false` turns the footer off from the plugin's options; anything else leaves it on.
  readonly enabled?: boolean;
  readonly slot?: Plugin.Context["ui"]["slot"];
  readonly ports: FooterPorts;
};

// Adds the D/A status beside the host's prompt footer, without replacing it. The view is loaded
// after setup so that a host where it cannot load keeps every other part of the plugin working; the
// failure leaves the footer as the host drew it. Returns the cleanup, which also stops a load still
// in flight from claiming the slot.
export function registerFooter(
  host: FooterHost,
  load: () => Promise<{ readonly footerRender: FooterRender }> = () =>
    import("./footer-view.js"),
): () => void {
  const slot = host.slot;
  if (host.enabled === false || typeof slot !== "function") return () => {};
  let disposed = false;
  let release: (() => void) | undefined;
  load().then(
    ({ footerRender }) => {
      if (disposed) return;
      try {
        release = slot({
          append: "prompt.footer.status",
          render: footerRender(host.ports),
        });
      } catch {
        // A host that refuses the claim keeps its own footer; nothing else depends on it.
      }
    },
    () => {
      // Nothing to show: the host's own footer stays as it is.
    },
  );
  return () => {
    disposed = true;
    release?.();
    release = undefined;
  };
}

const plugin: Plugin.Definition = {
  id: "opencode-delegation-policy",
  setup(context) {
    registerDelegateCommand(context);
    // The footer is the only part that loads the host's terminal runtime. It is loaded on its own,
    // after `/delegate` is registered, so a failure there cannot take the command with it, and the
    // option `"footer": false` turns it off entirely.
    return registerFooter({
      enabled: context.options?.footer !== false,
      slot: context.ui?.slot?.bind(context.ui),
      ports: {
        read: (sessionID) =>
          context.client
            .rpc(delegateRpc)
            .footer(sessionID === undefined ? {} : { sessionID }),
        changed: (handler) =>
          context.client.rpc(delegateRpc).events.on("changed", () => handler()),
        every: (milliseconds, handler) => {
          const timer = setInterval(handler, milliseconds);
          // A status refresh must never be what keeps the terminal process alive.
          (timer as { unref?: () => void }).unref?.();
          return () => clearInterval(timer);
        },
        after: (milliseconds, handler) => {
          const timer = setTimeout(handler, milliseconds);
          (timer as { unref?: () => void }).unref?.();
          return () => clearTimeout(timer);
        },
      },
    });
  },
};

function registerDelegateCommand(context: Plugin.Context): void {
  context.keymap.layer(() => ({
    // The slash list only offers commands reachable in the current input mode, and typing `/` opens
    // it in the `autocomplete` mode. A layer left in the default `base` mode drops out of its own
    // suggestions, so this follows the host's `/cd` and stays reachable in every mode. It binds no key.
    mode: "global",
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
              select: (options) => {
                const chosen = context.ui.dialog.select(options);
                // The select is already showing once the call returns. The default width cuts the
                // panel's "label  model" rows, so widen this dialog only; the next one starts over.
                context.ui.dialog.set({ size: "large" });
                return chosen;
              },
              prompt: (options) => context.ui.dialog.prompt(options),
              confirm: (options) => context.ui.dialog.confirm(options),
            },
            editor: {
              read: (input) =>
                context.client.rpc(delegateRpc).editorRead(input),
              preview: (input) =>
                context.client.rpc(delegateRpc).editorPreview(input),
              apply: (input) =>
                context.client.rpc(delegateRpc).editorApply(input),
            },
            sessionID: () => {
              const route = context.ui.router.current();
              return route.type === "session" ? route.sessionID : undefined;
            },
          }),
      },
    ],
  }));
}

export default plugin;
