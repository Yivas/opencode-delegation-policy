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

`check` runs formatting, lint, typechecking, build and Node's test runner. The tests use a storage
double and make no provider calls or changes to OpenCode configuration. Run `npm run build` before
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

The initial thinking mapping recognizes `minimal` through `max` from OpenAI and xAI Responses effort
overlays. Variant names are not level evidence; `none`/`off`, budgets and other protocols remain
unmapped for fixed/range policies. An explicit variant is never replaced, and multiple compatible
variants remain options for the caller—not an automatic launch choice.

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
