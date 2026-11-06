import type { JSX } from "@opentui/solid";
import { jsx } from "@opentui/solid/jsx-runtime";
import { createEffect, createSignal, onCleanup } from "solid-js";

import {
  createFooterTracker,
  type FooterPorts,
  UNKNOWN_LABEL,
} from "./footer.js";

// The footer view. It imports the terminal runtime, so it is loaded only inside the host: there,
// OpenCode rewrites these imports to its own copies of Solid and OpenTUI, which keeps one reactive
// runtime for the host and its plugins. It is plain calls, not JSX, so no build step is needed.
//
// Unverified against a real host: that the rewrite applies to this file, that the slot renders it
// and that it fits beside the host's own footer content.

export function footerRender(
  ports: FooterPorts,
): (input: { readonly sessionID?: string | undefined }) => JSX.Element {
  return (input) => {
    const [label, setLabel] = createSignal(UNKNOWN_LABEL);
    const tracker = createFooterTracker(ports, (next) => setLabel(next));
    // The slot input is reactive: a new session id reads the state for that session.
    createEffect(() => tracker.watch(input.sessionID));
    onCleanup(() => tracker.dispose());
    return jsx("text", {
      get children() {
        return label();
      },
    });
  };
}
