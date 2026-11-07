# opencode-delegation-policy

Delegation policy for OpenCode v2, with explicit roles and model selection. It ports the behavior of
the Pi extension `pi-delegation-policy` 0.25 to the public plugin API of OpenCode `2.2.6`.

**Experimental alpha `0.1.0-alpha.3`.** It has been loaded in one OpenCode `2.2.5`/`2.2.6`
installation, where the plugin loads, the footer appears, and `/delegate` opens the panel and saves
the defaults. Applying to a session, agent registration, permission denial, provider requests and
persistence across restarts have not been observed in a real host; every part has local tests
against doubles of the host API. OpenCode `2.2.5` is the
development target, not a supported or verified runtime. Use a setup you can recover; publishing
this alpha does not establish compatibility.

## What it does

The plugin registers helper agents for the roles the defaults configure, `ocv2-small`, `ocv2-medium`,
`ocv2-large` and `ocv2-visual-design`, and up to three Advisors, `ocv2-advisor-1` to
`ocv2-advisor-3`, each on its exact model. Advisors may only read: their permission list allows
`read` (files and directory listings), `glob` and `grep` inside the project and denies everything
else, including editing, commands, web access, subagents, questions, skills, MCP tools, paths
outside the project and environment files other than `*.env.example`. If the host's effective rules
reopen an action or cannot be read, that Advisor is excluded from the policy and reported in status.

Read-only is not confidentiality. `grep` asks for permission with its search pattern, not a path, so
an Advisor can find text in any project file you can read, and whatever it reads is sent to its
model's provider. A symbolic link inside the project that points outside it is not caught either.
Do not treat an Advisor as a sandbox for untrusted content.

Two rules are enforced at runtime through OpenCode's permission hook. A launch of one of the plugin's
agents is refused unless the session's effective policy offers that agent, and a delegated agent can
never launch one. An Advisor's actions other than reading, and its reads of environment files, are
refused even if a session's permissions would allow them. The guard only narrows a decision the host
already made and never fails a tool call. Each refusal is kept in the local log, and `/delegate
status` says whether the host offers the hook.

On each request of the main agent in a root session it adds a `<delegation_policy>` block to the
system instructions. The block follows Pi's text: the intensity rule, Visual Design's four
conditions, role choice by task fit, the Advisor checkpoints with a fixed brief order, ownership and
the launch requirements, with the exact agent id and the model strings each role may be launched
with. It names only agents the host actually lists, on the model they were created with. Delegated
child sessions and the plugin's own agents never receive it.

After an effective change of settings, the next turn also carries a short notice of what changed,
so earlier settings quoted in the conversation stop steering the main agent. The notice is consumed
when that turn succeeds.

It also adds `ocv2-budget-*` thinking variants to six Anthropic models listed in its tables, so a
budget can be chosen for them. It keeps user variants, never chooses one, and never changes the main
agent's model.

The plugin does not launch, route, supervise or accept subagent work. The main agent launches the
agents through OpenCode's own `subagent` tool, under OpenCode's permissions. Apart from the two
runtime rules above, the policy text states obligations; it cannot enforce them.

## Settings

`/delegate` lives in the terminal interface and answers in a dialog. Typed alone, it opens one panel
that lists every setting with its effective value and where that value comes from: intensity, Advisor
mode, preference, the model and thinking policy of each role, and the Advisors. Choosing a row edits a
local draft. `Apply to this session` saves intensity, Advisor mode and preference; `Save as defaults`
saves the whole draft. Both validate the draft first and then save without a second confirmation.
Models, thinking and Advisors take effect after OpenCode restarts. Closing a changed draft asks before
discarding it.

On the home screen, with no session open, `Apply to next session` saves intensity, Advisor mode and
preference for the session that comes next. The first root session created after the save takes those
values as its own and the saved setting is removed; sessions that already existed and child sessions
never take it. The panel shows what the next session would use, marked `next session`, and offers
`Clear next session` while something is saved. A saved setting the plugin cannot read is reported and
never applied.

A concurrent settings change refuses the save instead of overwriting the other client's work. When a
save is refused or cannot be confirmed, the panel keeps the draft and offers `Reload`, which reads the
saved settings again without discarding it; until then the save actions are hidden. These checks
coordinate one server instance; they do not provide compare-and-swap across separate processes.

| Command | Effect |
| --- | --- |
| `/delegate` | Open the settings panel for the open session, or for the defaults on the home screen |
| `/delegate edit [session\|defaults]` | Open the same panel; `defaults` ignores the open session |
| `/delegate status` | Settings of the open session, or the defaults on the home screen, with where each value comes from and whether it works |
| `/delegate <off\|normal\|aggressive\|orchestrator>` | Intensity of the open session |
| `/delegate advisor <off\|on\|with-delegation>` | Advisor mode of the open session |
| `/delegate preference <efficient\|standard\|intensive>` | Small/Medium tie-break of the open session |
| `/delegate next <intensity>`, `next advisor <mode>`, `next preference <value>`, `next clear` | Settings for the next new session |
| `/delegate reset` | Turns the open session's delegation and Advisor off |
| `/delegate clear` | Drops the open session's changes, so it follows the defaults again |
| `/delegate defaults intensity\|advisor-mode\|preference <value>` | Same settings, for every session |
| `/delegate defaults role <small\|medium\|large\|visual-design> <provider/model[#variant]\|off\|unset>` | Model of a role |
| `/delegate defaults thinking <role> <level\|from..to\|unset>` | Thinking policy of a role |
| `/delegate defaults advisors <provider/model ...\|off\|unset>` | One to three Advisors, in order |
| `/delegate log` | Newest entries of the local log |

The prompt footer shows the effective state of the open session, or of the defaults on the home
screen, next to the host's own footer content: `D:OFF`, `D:NORM`, `D:AGG`, `D:ORCH` or `D:ERR`, and
`A:OFF`, `A:ON`, `A:PART` or `A:ERR`. It reads the server again when settings change and every 30
seconds. A change clears the label until the new state arrives. A read that takes more than 10
seconds shows `D:? A:?`, and its late answer is dropped, so a label on screen describes a read
started at most about 40 seconds earlier. In a delegated
child session it shows `D:OFF A:OFF`, because children never receive the policy.

Agents are created when OpenCode starts, from the defaults, so a change to roles, Advisors or
thinking needs a restart. A session can change intensity, Advisor mode and preference; it cannot
create an agent. As in Pi, each of Small, Medium and Large must be configured or turned `off` before
delegation works; Visual Design is optional.

## Thinking

OpenCode expresses thinking as model variants, written `provider/model#variant`. The plugin lists,
for each role and Advisor, only the variants whose reasoning level it can name from its provider
tables. A role without a thinking policy chooses one of them per launch, and a fixed or range policy
lists only the variants it admits. A model whose variants cannot be named runs without one, and the
policy says so. A `#variant` written into a reference is used only when its level can be named.

The tables cover OpenAI and xAI Responses, Anthropic, DeepSeek, Z.ai, Moonshot, Google and specific
Mistral models, from Pi AI `0.87.1`, checked against the request code of OpenCode `2.2.6`. Matching a
catalogue entry is source evidence, not proof of what a provider does with the request.

OpenRouter variants are admitted only when they set `reasoning.effort` to `low`, `medium` or `high`, or
`reasoning.enabled` to `false` (off). OpenCode forwards both unchanged, so the request names the level,
but the plugin cannot know which upstream model OpenRouter routes to. Token budgets, `enabled: true`,
`exclude` and other effort values stay unmapped. Other providers list no variants yet.

## Privacy and cost

Each Advisor consultation sends a brief to another model, and there can be up to three Advisors per
checkpoint, so one checkpoint can mean up to three extra model calls. The brief is the only context
an Advisor gets: new children launched by OpenCode's `subagent` tool start with fresh context. The
plugin does not copy or forward the parent conversation.

The local log stays in the plugin's own OpenCode storage. It keeps times, the host version, a hash of
the policy block when it changes, the modes in force and, for each launch of a plugin agent, its id,
background flag, outcome and duration. It keeps no model argument, prompt, brief, answer, session id,
path or host error. Reads accept only validated fields of the current log schema; older records are
hidden and removed during pruning. Retention targets the newest 500 entries, with bounded scans and
a queue of at most 64 pending writes. A refusal by the runtime guard keeps only the refused action
and the plugin agent's id. Overflow is dropped and reads stop waiting after one second:
this is a best-effort diagnostic log, not an audit trail. The plugin makes no network calls of its
own.

## Install the alpha

OpenCode installs published plugins from its `plugins` configuration; a global `npm install -g`
is not needed. In the `opencode.json(c)` used by your OpenCode instance, add this exact package
reference to the existing list, keeping other entries:

```jsonc
{
  "plugins": ["opencode-delegation-policy@0.1.0-alpha.3"]
}
```

Restart that OpenCode instance and open `/delegate status`, then `/delegate`. Start by checking
that both dialogs open and the footer appears, without sending a message to a model. If loading
fails, remove only the new plugin entry and restart. Keep a copy of the configuration before editing
it; preferences, logs and registered agents may persist after removal. Alpha updates use npm's `next`
tag. The public registry also requires a `latest` alias; its presence is not a statement of stability
or verified compatibility, and it may reference a different release. Use the exact version above
for a reproducible installation. Do not try to delete `latest`.
The first registry installation needs network access. Model calls are not needed for these initial
checks, but this does not promise that OpenCode makes no other network requests on startup.

Delegation is initially off and no Advisor is configured. Use `/delegate` to configure global roles
and Advisors, then restart so OpenCode registers their agents. Changing settings in a session does
not create an agent. Consultations can make real model calls and incur cost; see Privacy and cost.

A project directory alone does not isolate OpenCode's global storage, service, credentials or other
plugins. This is an opt-in alpha installation, not a validated sandbox or a verified removal path.

## Build from source

OpenCode also loads local directories listed under `plugins` in `opencode.json(c)`. In a
throwaway project, `.opencode/opencode.jsonc`:

```jsonc
{
  "plugins": ["/path/to/opencode-delegation-policy"]
}
```

Build first with `npm ci --ignore-scripts` and `npm run build`. The emitted code imports nothing from
the host at runtime, except the footer view, which imports Solid and OpenTUI and is loaded on its own
after `/delegate` is registered. To turn the footer off, list the plugin as
`{ "package": "/path/to/opencode-delegation-policy", "options": { "footer": false } }`; that the host
passes these options to the terminal entry is typed, not observed. A throwaway project alone does not isolate OpenCode's global configuration,
storage or service: use a separate disposable host environment, without personal sessions or
credentials. Restart only that environment's service, configure the defaults with `/delegate
defaults ...`, and restart again so the agents exist. `opencode debug agents` lists them.

## Disable or remove

To stop delegation and consultation for sessions that follow the defaults, use:

```text
/delegate defaults intensity off
/delegate defaults advisor-mode off
```

Existing session overrides still take precedence. In each affected session, `/delegate reset` turns
both axes off; `/delegate clear` drops its overrides and follows the defaults. Restart the disposable
host so its agent catalogue is rebuilt. Turning the modes off does not delete preferences or log
entries.

To stop loading the plugin, remove only its entry from the project's `plugins` list and restart that
environment's service. Do not delete unrelated plugin entries or host data. There is no command to
wipe the plugin's storage, and removing its entry does not promise to erase it. Removal, persistent
agent cleanup and rollback have not been exercised in a real host. There is no earlier verified release to
roll back to. Keep the previous configuration and a known source commit or package, without
resetting host storage to make the failure disappear.

## Limits

These are known gaps, not settled behavior:

- Nothing here has run in OpenCode: loading the terminal entry, the dialog and its connection to
  the server, the agent list format, injection order, launches with `#variant`, the Advisor's deny
  list and the notice are all unverified.
- The `D:/A:` footer status relies on OpenCode rewriting the plugin's Solid and OpenTUI imports to
  its own copies when it loads the terminal entry. That is how the host's source sets it up, but it has
  not been observed. If the view cannot load, the footer stays as the host draws it.
- Agents left over from an earlier configuration are reported, not removed.
- The notice resets when OpenCode restarts, so a change made while it was stopped is not announced.
- Pi's `consult_advisor` tool is out of scope. Consulting several Advisors at once would make the
  plugin launch, wait for and merge model calls itself; consultations use OpenCode's own
  `subagent` tool instead.

## Development

The development target is `@opencode/plugin@2.2.6`, with theme `2.2.6`, OpenTUI core/solid `0.8.1`
and Solid `1.9.17`, installed as exact development dependencies. Recent checks ran with Node.js
`26.13.0` and npm `11.21.1`. The pinned `@opentui/core@0.8.1` declares Node.js `>=26.4.0` or Bun
`>=1.3.14`. The local checks use its types, not its terminal runtime. Updating the development
machine's Node or Bun does not qualify or replace the runtime embedded in OpenCode.

```bash
npm ci --ignore-scripts
npm run check
```

`check` runs formatting, lint, typechecking, build and Node's test runner. The tests use doubles of
storage, the model catalogue, the agent editor, sessions, RPC and the event stream; they make no
provider calls and change no OpenCode configuration. Use `--ignore-scripts`: the pinned SDK pulls
optional transitive packages with install scripts.

## Participate

This is an open-source project under the [MIT License](LICENSE).
[Issues](https://github.com/Yivas/opencode-delegation-policy/issues) and pull requests are welcome for
documentation corrections and scoped proposals; discuss changes to the runtime contract first. See
[Contributing](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report sensitive
findings through [Security](SECURITY.md), not in a public issue.
