# Security

## Supported versions

| Line | Support |
| --- | --- |
| Development source | Reports welcome; not yet run inside OpenCode |
| Software releases | None published or supported |

## What the plugin can touch

The plugin runs inside the OpenCode server and terminal interface with the access OpenCode gives
plugins. It registers agents under the reserved ids `ocv2-small`, `ocv2-medium`, `ocv2-large`,
`ocv2-visual-design` and `ocv2-advisor-1` to `ocv2-advisor-3`, adds `ocv2-budget-*` variants to
some Anthropic catalogue entries, adds a block to the system instructions of the main agent's
requests, and reads and writes its own keys in the plugin storage OpenCode provides. It makes no
network calls of its own, starts no processes, and does not change the main agent's model, tools,
messages or permissions.

Advisor agents carry a deny-everything permission list. OpenCode applies user configuration after
the plugin, and an `allow` there can reopen an action; `/delegate status` reports an Advisor whose
actions are no longer all denied. The policy text is guidance for the main agent, not an
enforcement boundary.

A user agent with one of the reserved ids is overwritten by registration. The plugin reports, and
does not delete, reserved agents its current configuration no longer defines.

The local log keeps no prompt, brief, answer, session id, path or host error; see the README for
the fields it keeps. Settings and log entries are stored by OpenCode, not encrypted by the plugin.
Do not put credentials in model references.

Use `npm ci --ignore-scripts` for development dependencies. The pinned development tree has
[open dependency security alerts](https://github.com/Yivas/opencode-delegation-policy/security/dependabot),
including a critical Seroval deserialization advisory. Disabling install scripts does not resolve
those advisories. The emitted plugin does not import these development packages, but the development
environment still needs assessment before handling untrusted input. The unit suite runs against
doubles of the host API and is not a tested runtime security boundary.

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/Yivas/opencode-delegation-policy/security/advisories/new)
for sensitive findings involving this repository. Do not publish exploit details or private data
in issues or pull requests. If the private form is unavailable, open an issue asking for a private
contact without disclosing the finding.

Include the affected commit or file, environment, minimal sanitized reproduction, impact and any
workaround. Remove tokens, credentials, personal information, conversations, private endpoints and
configuration. Do not attach complete session logs.

The maintainer will assess scope, request missing evidence when needed, and coordinate a correction
or disclosure. No response deadline, bounty, CVE assignment or embargo is promised. Findings in
OpenCode or other dependencies belong to their maintainers unless this repository contributes to
the problem.
