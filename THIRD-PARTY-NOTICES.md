# Third-party notices

This project contains data derived from a third-party work. The code is original; the model
reasoning tables are not.

## @earendil-works/pi-ai

- Source: <https://github.com/earendil-works/pi>, package `@earendil-works/pi-ai`, version `0.87.1`,
  commit `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`.
- Used for: the model catalog data behind the per-provider thinking tables, which translate a
  reasoning level into the model control each provider accepts. No code is copied; the facts
  (model identifiers, level names, control fields and bounds) are transcribed into TypeScript data.
- Derived files: `src/thinking/azure.ts`, `bedrock.ts`, `bedrock-budget.ts`, `bedrock-no-control.ts`,
  `codex.ts`, `google.ts`, `mistral.ts`, `mistral-admission.ts`, `protocols.ts`,
  `responses-admission.ts`.

### License

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Keeping this file current

When a derived table is refreshed against a newer `pi-ai` release, update the version, commit and
file list above in the same change. The package manifest does not define an allowlist yet; the first
packaged build must include this file (tracked in the release gate).
