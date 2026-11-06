# Changelog

## Unreleased

## 0.1.0-alpha.2 — 2026-11-06

### Fixed

- Correct the README's claim that the alpha has no `latest` npm tag. The public registry requires
  that alias; it does not establish stability or compatibility. Alpha updates use `next`, and the
  installation example pins the exact alpha.2 version rather than relying on either alias.
- No plugin logic or dependency changes. The host-validation limits of alpha.1 still apply.

## 0.1.0-alpha.1 — 2026-11-06

First experimental npm package, targeting the public OpenCode 2.2.5 plugin API. Host loading and
runtime behavior have not been tested; this is not a compatibility or security certification.

### Added

- Explicit Small, Medium, Large and optional Visual Design roles, and one to three advice-only
  Advisors, registered only from configured global defaults.
- Root-agent delegation policy with intensity, role preference and proven thinking variants;
  launches stay with OpenCode's native subagent tool.
- `/delegate` commands and draft editor with model filtering, preview, explicit Apply and
  recovery from rejected or unconfirmed saves.
- Session overrides, global defaults, reset/clear and a D/A prompt footer.
- A next-turn settings notice and a bounded local log without prompts, answers or session ids.

### Known limits

- Actual host permissions, launches, provider payloads, persistence, RPC and terminal rendering
  remain unverified. Other thinking providers, including OpenRouter, are incomplete.
- Advisor permissions are checked as a snapshot; the plugin cannot prevent later host permission
  changes or separate manual launches. Guidance does not guarantee the main agent's behavior.
- Removing the plugin does not promise to erase settings, logs or leftover agents.
- Development-only moderate Minimatch/Glob findings remain accepted and documented in SECURITY.md.

[Source](https://github.com/Yivas/opencode-delegation-policy)
