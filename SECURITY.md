# Security

## Supported versions

| Line | Support |
| --- | --- |
| Development source | Reports on the typed entry and preference store; host integration unverified |
| Software releases | None published or supported |

The development entry has no host side effects. The preference store rejects malformed/future
state and uses an injected storage interface; local tests do not verify OpenCode permissions,
host persistence, agents or provider behavior. There is no supported plugin release.

Use `npm ci --ignore-scripts` for development dependencies. Do not put credentials, prompts or
personal configuration in the store or tests. Serialization protects callers of one store instance,
not multiple server processes, and a rejected write has an unknown persistence outcome until
re-read. The unit suite is not a tested runtime security boundary.

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
