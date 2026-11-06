# opencode-delegation-policy

Delegation policy for OpenCode v2, with explicit roles and model selection. It ports the behavior of
the Pi extension `pi-delegation-policy` 0.25 to the public plugin API of OpenCode `2.2.5`.

**Unreleased and not yet run inside OpenCode.** Every part has local tests against doubles of the
host API, and none of it has been observed in a real OpenCode host. There is no published package
and no supported version. Do not load it into an OpenCode setup you depend on.

## What it does

The plugin registers helper agents for the roles the defaults configure, `ocv2-small`, `ocv2-medium`,
`ocv2-large` and `ocv2-visual-design`, and up to three Advisors, `ocv2-advisor-1` to
`ocv2-advisor-3`, each on its exact model. Advisors carry a deny-everything permission list. If the
host's effective rules reopen an action or cannot be read, that Advisor is excluded from the policy
and reported in status. This does not change the host's permissions or prevent a separate manual
launch; the actual denial of tools still needs a host test.

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
agents through OpenCode's own `subagent` tool, under OpenCode's permissions. The text states
obligations; it cannot enforce them.

## Settings

`/delegate` lives in the terminal interface and answers in a dialog. Typed alone, it opens a menu
with quick commands and an editor for the open session or the defaults. The editor shows value
origins, filters models from the host catalogue, and keeps changes in a local draft. Preview validates
without saving; Apply asks for confirmation. Closing a changed draft asks before discarding it.

A concurrent settings change refuses Apply instead of overwriting the other client's work. Reload
source settings keeps the draft and takes a fresh revision for another preview. If a save cannot be
confirmed, the editor keeps the draft but disables Apply until a successful reload. These checks
coordinate one server instance; they do not provide compare-and-swap across separate processes.

| Command | Effect |
| --- | --- |
| `/delegate` | Interactive command selector; cancelling sends nothing |
| `/delegate edit [session\|defaults]` | Open the draft editor; without a scope, use the open session or defaults on the home screen |
| `/delegate status` | Settings of the open session, or the defaults on the home screen, with where each value comes from and whether it works |
| `/delegate <off\|normal\|aggressive\|orchestrator>` | Intensity of the open session |
| `/delegate advisor <off\|on\|with-delegation>` | Advisor mode of the open session |
| `/delegate preference <efficient\|standard\|intensive>` | Small/Medium tie-break of the open session |
| `/delegate reset` | Turns the open session's delegation and Advisor off |
| `/delegate clear` | Drops the open session's changes, so it follows the defaults again |
| `/delegate defaults intensity\|advisor-mode\|preference <value>` | Same settings, for every session |
| `/delegate defaults role <small\|medium\|large\|visual-design> <provider/model[#variant]\|off\|unset>` | Model of a role |
| `/delegate defaults thinking <role> <level\|from..to\|unset>` | Thinking policy of a role |
| `/delegate defaults advisors <provider/model ...\|off\|unset>` | One to three Advisors, in order |
| `/delegate log` | Newest entries of the local log |

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
Mistral models, from Pi AI `0.87.1`. Other providers, including OpenRouter, list no variants yet.
Matching a catalogue entry is source evidence, not proof of what a provider does with the request.

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
a queue of at most 64 pending writes. Overflow is dropped and reads stop waiting after one second:
this is a best-effort diagnostic log, not an audit trail. The plugin makes no network calls of its
own.

## Try it locally

OpenCode loads plugins from local directories listed under `plugins` in `opencode.json(c)`. In a
throwaway project, `.opencode/opencode.jsonc`:

```jsonc
{
  "plugins": ["/path/to/opencode-delegation-policy"]
}
```

Build first with `npm ci --ignore-scripts` and `npm run build`. The emitted code imports nothing from
the host at runtime. A throwaway project alone does not isolate OpenCode's global configuration,
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
agent cleanup and rollback have not been exercised in a real host. There is no published release to
roll back to; keep the last verified source commit and rebuild it if a local update fails, without
resetting host storage to make the failure disappear.

## Limits

These are known gaps, not settled behavior:

- Nothing here has run in OpenCode: loading the terminal entry, the dialog and its connection to
  the server, the agent list format, injection order, launches with `#variant`, the Advisor's deny
  list and the notice are all unverified.
- The status line `D:/A:` in the prompt footer is not built: it needs OpenCode's terminal UI library at
  runtime, which has not been checked.
- Agents left over from an earlier configuration are reported, not removed.
- The notice resets when OpenCode restarts, so a change made while it was stopped is not announced.
- Pi's `consult_advisor` tool is out of scope. Consulting several Advisors at once would make the
  plugin launch, wait for and merge model calls itself; consultations use OpenCode's own
  `subagent` tool instead.

## Development

The development target is `@opencode/plugin@2.2.5`, with theme `2.2.5`, OpenTUI core/solid `0.8.0`
and Solid `1.9.17`, installed as exact development dependencies. Recent checks ran with Node.js
`24.22.1` and npm `11.21.1`. The pinned `@opentui/core@0.8.0` declares Node.js `>=26.4.0` or Bun
`>=1.3.14`; npm reports an engine warning under Node 24. The local checks use its types, not
its terminal runtime, and do not establish runtime compatibility under Node 24.

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
