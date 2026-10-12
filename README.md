# opencode-delegation-policy

Delegation policy for OpenCode v2, with explicit roles and model selection.

**Early implementation, not a usable plugin yet.** The typed entry, preference store and
model/thinking validator have local unit tests. The entry does not yet apply policy, register agents or expose a terminal interface.
There is no published package or verified OpenCode compatibility. Do not install this checkout in
your personal OpenCode configuration.

## Development

The development baseline is Node.js `24.9.0`, npm `11.6.2` and the public types from
`@opencode/plugin@2.0.21`. These types do not prove host compatibility.

```bash
npm ci --ignore-scripts
npm run check
```

`check` runs formatting, lint, typechecking, build and Node's test runner. The tests use storage,
catalogue and model-editor doubles, with no provider calls or changes to OpenCode configuration. Run `npm run build` before
`npm test` when running the tests separately. Use `--ignore-scripts` for dependency installation;
the pinned SDK includes optional transitive packages with install scripts.

The store keeps versioned global defaults and session overrides, with per-field provenance and
separate Advisor mode. Applying a session change never saves defaults. `clearSession` returns to
global defaults; `resetSession` turns delegation and Advisor off for that session. Malformed or
future documents are not overwritten. Mutations are serialized within one store instance, not across server
processes; a rejected write requires a fresh read because the host may have stored it.

The validator checks exact model references against an injected host catalogue and keeps delegation
and Advisor errors separate. `with-delegation` without a configured Advisor stays off; unreadable
preferences fail both axes without applying policy. Catalogue availability is not authentication.

Thinking validation recognizes the six named OpenAI/xAI Responses efforts and scoped Anthropic,
DeepSeek, Z.ai, Moonshot and Google controls. Native-field recognition and model-specific Pi translations
carry separate evidence. A binary switch or capped budget can cover several logical levels; the
result keeps the full compatible set separate from the levels admitted by a fixed/range policy.
Variant names are not evidence. An explicit variant is never replaced, and the validator never
chooses a variant or a per-run level.

A separate, unwired adapter can plan and register owned budget variants for verified nonadaptive
Anthropic models. It preserves user variants, rejects any reserved-prefix collision and waits for
an effective catalogue read when registration is batched. Unexpected editor failures escape to the
host's failure boundary; in a grouped host this can disable the plugin's transform group. Expected
per-model rejections remain skips.

Google planning uses exact model/API tables, including the different Gemini 2.5 Flash-Lite budgets
in GenAI and Vertex. Scoped uppercase levels reproduce Pi's SDK enum values; lowercase levels carry
native-field evidence only. The pure request verifier distinguishes unknown, known and proven-absent
output caps, checks the native budget fit and filters ranges without selecting a level. All Google
budgets, including automatic `-1`, remain conditional candidates outside role validation. Native
lowering of budget `off` also adds `includeThoughts`, which Pi omits. These helpers are not wired to a launch gate.

An inert request component can replace only the Google thinking subtree after native lowering,
restoring the scoped Pi budget or omitting inherited fields for `off` without changing the output cap.
It requires an injected authority for the exact child, parent, role, model, variant, registration
lifetime and body-independent authentication. It preserves request options and rejects stale bindings
or concurrent request changes. There is no production ownership authority or hook registration yet.
It buffers owned bodies in memory, and later hooks can still rewrite its result. Local request doubles
prove the component at its callback position, not the final wire or provider acceptance.

Full thinking parity remains unfinished, including Gemini budget execution, wrapper translations
and scoped `off` controls. Anthropic budget recipes are checked at the model-derived cap, not against
an actual request's output/context limit. Unit tests do not prove the effective provider payload,
launch choice or provider behavior.

Real plugin loading, policy injection, native agents/launches, terminal UI, packaging and host
integration remain unfinished. The manifest is private and has no release version.

## Participate

This is a collaborative open-source project under the [MIT License](LICENSE).
[Issues](https://github.com/Yivas/opencode-delegation-policy/issues) and pull requests are welcome for documentation corrections and scoped
proposals. Discuss changes to the runtime contract first; local unit tests do not establish a
supported OpenCode version.
See [Contributing](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

Report sensitive findings through the process in [Security](SECURITY.md), not in a public issue.
There is no supported plugin release or plugin installation procedure at this stage.
