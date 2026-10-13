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
chooses a variant or a per-run level. Recognizing a native effort field does not establish a
particular model's advertised support; the full model-specific Pi admission check remains unfinished.

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
Its factory requires an explicit `maxBytes`/`timeoutMs` read policy, with no production defaults.
The cloned body is collected incrementally, counted using intrinsic byte lengths and cancelled on
read failure without consuming the original. The deadline covers reading only, not ownership checks
or synchronous parsing/serialization. Clone tee, source chunks, parsed JSON and rebuilt bodies can
still increase memory use, and later hooks can rewrite the result. HTTP callbacks can access
authentication headers; this is not a credential-isolated boundary. Restoring Pi's budget while
keeping the total output cap can leave less answer room. Local request fixtures prove the component
at its callback position, not whole-callback timing, final-wire controls or provider acceptance.

Bedrock has a separate pure planner for all 47 exact adaptive Claude catalogue entries in Pi AI
`0.87.1`. It resolves `xhigh` and `off` support per row, keeps compatible and admitted levels separate,
and checks an overlay against caller-supplied fields asserted to represent the lowered native body.
Seven rows reject logical `off`; nine carry a native-default binding obstacle that the overlay
cannot delete. A control match proves only the supplied-field comparison at the pre-auth overlay
stage. Retained display, caller and binding conditions are not discharged: no actual observation,
host override or default reachability is certified. The planner does not execute requests, certify
AWS regions or restore Bedrock capability proofs in role validation. Newer SDK semantics remain
outside this scope.

A second pure planner covers the 22 exact nonadaptive Claude entries in the same snapshot. It
calculates manual budgets from supplied context estimates and Pi caller caps, with every arithmetic
stage visible. It compares Pi's virtual output cap with a separately supplied native cap; either a
higher or lower Pi cap blocks cap-preserving parity without changing the native value. Fixed/range
results keep complete recipe-equivalent sets and select nothing. The reference rows and level list
are immutable. These are source calculations and target descriptions, not verified provider requests:
context/cap producers, client resolution, authentication, serialization and a request consumer remain
unfinished. Synthetic arithmetic inputs carry no catalogue evidence.

An unwired Bedrock reader observes `inferenceConfig.maxTokens` from a native clone of a supplied
`Request`, leaving the original readable. It distinguishes a finite numeric cap, known absence,
malformed fields and unavailable evidence without exposing the body or headers. Its scope is that
request snapshot, not the cap finally sent. The caller must establish the protocol and ownership;
public events expose no request ID for authoritative cross-stage correlation. It buffers the whole
JSON body and has no timeout or cancellation policy, so an open stream can leave it pending.
These resource limits must be addressed before integration; no callback is registered.

A source-only planner covers the other 54 exact Bedrock reasoning entries in the same snapshot.
Pi's builder emits no thinking control for those entries; this is not a claim that thinking is disabled
or that a real request has no control. The planner preserves each row's five or six advertised levels,
keeps admitted and compatible sets separate, and calculates Simple/raw caps without choosing a level.
All seven canonical inputs share the builder result, but unadvertised `max` and scoped `xhigh` remain
outside policy admission. Pi payload hooks, native thinking settings, compatibility overrides,
arbitrary control/cap body overlays and later peers remain unresolved conditions. No native comparator
or role capability proof is added.

A source-only Mistral Simple planner covers nine exact provider/API/model entries from Pi AI
`0.87.1`. Its six effort entries map every advertised positive level to `reasoningEffort: "high"`;
three others use `promptMode: "reasoning"`. Off omits both fields, without claiming physical
disablement. Fixed/range results keep the full positive compatible set and admitted intersections;
a range spanning off and positives returns both candidates without selecting one. The planner
calculates virtual Simple caps from explicit caller-cap and estimate states, never filling unknowns
with zero or clipping a supplied caller cap to the catalogue maximum. SDK clamping of `xhigh`/`max`
to `high` is source evidence, not policy admission. The truthy API-key prerequisite, payload hooks,
forwarded native settings, arbitrary body overlays and later writers remain unresolved. Control
omission descriptors are not request settings or clearing overlays. There is no native-family
registration, raw canonical planner, request consumer or role proof for these entries.

A source-only Codex Simple planner covers eight exact `openai-codex-responses` entries from that
snapshot. Positive recipes include effort and automatic summary; supported off recipes use effort
`none` with no summary. All retain encrypted-reasoning inclusion. Minimal and low share a complete
compatible set; inclusive ranges return every admitted control class without selecting one.
Advertised support rejects off for Astra and max for Spark/GPT-5.5 even where SDK clamping or raw
inputs behave differently. Pi calculates a Simple output cap but never puts it in the Codex body;
the planner records that builder-scoped omission before payload hooks, not a sent cap or an
instruction to remove a native caller cap. It takes no cap or estimate input and has no arithmetic
helper. Credential/account prerequisites, Simple preprocessing, body replacement, native
correspondence, overlays, later writers and backend acceptance remain unresolved. No native
family, raw planner, request consumer or role proof is registered.

A source-only Azure Simple planner covers all 29 exact reasoning entries in that snapshot.
Admitted positive levels keep their individual effort, automatic summary and encrypted-reasoning
include; the nine admitted off entries use effort `none` without summary or include. Inclusive ranges
return all supported classes without selection. The Simple cap and the builder target are separate:
the builder raises a positive cap below 16 to 16 before sampling-parameter overlays and payload
hooks. Supplied caps are not clipped to the catalogue maximum, and unknown caps/estimates stay
unresolved. Positive finite supplied caps are a local input precondition; source zero-cap omission
is not modelled. Azure client/deployment resolution, overlays, native correspondence and backend
acceptance remain unresolved; no family registration, request consumer or role proof is added.

Full thinking parity remains unfinished, including other model/wrapper branches, Gemini budget
execution and scoped `off` controls. Pi-messages forwarding
also leaves server-side translation unresolved. Anthropic budget recipes are checked at the
model-derived cap, not against an actual request's output/context limit. Unit tests do not prove
the effective provider payload, launch choice or provider behavior.

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
