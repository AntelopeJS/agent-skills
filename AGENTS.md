The AntelopeJS agent plugin for Claude Code and OpenAI Codex: the sync of the skills that AntelopeJS packages ship, the interface contract resolver, a few commands, and the skill evals. It is plain JavaScript (`.mjs`) that runs on Node.js alone.

## Layout

- `bin/agent-skills.mjs` is the CLI behind `npx -y github:AntelopeJS/agent-skills` (`sync`, `list`, `interface`, `verify`, `evals`). It dispatches to the scripts in `scripts/`.
- `scripts/sync-skills.mjs` and `scripts/resolve-interface.mjs` also run straight from the plugin checkout: the hooks in `hooks/hooks.json` (Claude Code) and `hooks/codex-hooks.json` (Codex) and the commands in `commands/` call them with `node`, and nothing installs dependencies there. They import only `node:` built-ins and `scripts/lib/`. `@anthropic-ai/sdk` is the one runtime dependency, loaded lazily by `scripts/lib/model.mjs` for the model-backed evals.
- `evals/cases.json` is the eval dataset and `evals/packages.json` the packages whose skills the evals read.
- The plugin is described twice: `.claude-plugin/plugin.json` (Claude Code) and `plugin.json` (Codex), with their marketplaces in `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. Installed copies update only when `version` changes, so a release bumps `version` in both plugin manifests and in `package.json` together.

## Checks and tests

- There is no type check: the code is untyped JavaScript, so the `typecheck` script only prints that. `pnpm test` runs the `node:test` suites in `test/`.
- `pnpm run checks` does not run the evals. CI runs `pnpm evals:baseline` (deterministic, no key) after the checks. On pull requests that touch `evals/` or the eval scoring code, the `model-eval` job runs `pnpm evals:model` and `pnpm evals:answers`; both need `ANTHROPIC_API_KEY`, and `evals:answers` also needs `--project` pointing at a project with the interface packages installed (see `ci.yml`).

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
