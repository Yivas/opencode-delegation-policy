# Contributing

This repository contains an early typed plugin entry and preference store, not a usable OpenCode
plugin. Documentation corrections and scoped code changes are welcome through
[issues](https://github.com/Yivas/opencode-delegation-policy/issues) and pull requests.
Discuss changes to the runtime contract before implementation.

Search existing issues first. For a documentation problem, include the file or link, what it says,
and what should change. For an integration proposal, include the exact OpenCode version or
revision, the public API involved, and the user-visible behavior. No software baseline is supported
yet; do not report untested compatibility as established behavior.

Keep each pull request focused. Explain the reason, list the files changed, check relative links,
and identify checks actually run. Use Node.js `24.9.0` and npm `11.6.2` for the development baseline:

```bash
npm ci --ignore-scripts
npm run check
```

Add tests at the state/store boundary with a storage double; do not mock this project's parser or
state logic. Do not commit `dist/`, `node_modules/`, temporary reports or personal configuration.
Do not install the plugin in your personal OpenCode environment to run these tests. Host loading,
provider calls and terminal integration are not covered by the local suite; report them separately
if a scoped integration test is agreed. Do not add workflows or installation claims before they
have real checks behind them.

Remove credentials, private endpoints, personal paths, conversations, prompts and session logs from
all submissions. Send sensitive findings through [SECURITY.md](SECURITY.md).
Participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are made under the
repository's [MIT License](LICENSE); retain notices required by any authorized source material.
