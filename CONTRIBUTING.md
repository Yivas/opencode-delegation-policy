# Contributing

This repository contains an unreleased OpenCode plugin that has not yet run inside OpenCode.
Documentation corrections and scoped code changes are welcome through
[issues](https://github.com/Yivas/opencode-delegation-policy/issues) and pull requests.
Discuss changes to the runtime contract before implementation.

Search existing issues first. For a documentation problem, include the file or link, what it says,
and what should change. For an integration proposal, include the exact OpenCode version or
revision, the public API involved, and the user-visible behavior. No software baseline is supported
yet; do not report untested compatibility as established behavior.

Keep each pull request focused. Explain the reason, list the files changed, check relative links,
and identify checks actually run. The development target is SDK `2.2.5`; recent local checks ran
with Node.js `24.22.1` and npm `11.21.1`:

```bash
npm ci --ignore-scripts
npm run check
```

These checks use the terminal peers' types, not their runtime. The pinned OpenTUI core requires
Node.js `>=26.4.0` or Bun `>=1.3.14`; a passing check under Node 24 does not qualify terminal loading.

Add tests at the boundary the change crosses, with doubles only for the host API (storage, model
catalogue, agent editor, sessions, RPC, events); do not mock this project's own parser, validator or
state logic. Do not commit `dist/`, `node_modules/`, temporary reports or personal configuration.
Do not load the plugin into an OpenCode setup you depend on to run these tests. Host loading,
provider calls and terminal integration are not covered by the local suite; report what you observe
in a throwaway OpenCode project separately, with the OpenCode version. Do not add workflows or installation claims before they
have real checks behind them.

Remove credentials, private endpoints, personal paths, conversations, prompts and session logs from
all submissions. Send sensitive findings through [SECURITY.md](SECURITY.md).
Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are made under the
repository's [MIT License](LICENSE); retain notices required by any authorized source material.
