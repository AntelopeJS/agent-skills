The AntelopeJS agent plugin for Claude Code and OpenAI Codex: the sync of the skills that AntelopeJS packages ship, the interface contract resolver, five skills of its own, and the skill evals. It is plain JavaScript (`.mjs`) that runs on Node.js alone.

## Layout

- `bin/agent-skills.mjs` is the CLI behind `npx -y github:AntelopeJS/agent-skills` (`sync`, `list`, `interface`, `verify`, `evals`; `evals seeded` runs the seeded-break eval, headless `claude -p` agents on scratch checkouts). It dispatches to the scripts in `scripts/`.
- `scripts/sync-skills.mjs` and `scripts/resolve-interface.mjs` also run straight from the plugin checkout: the hooks in `hooks/hooks.json` (Claude Code) and `hooks/codex-hooks.json` (Codex) and the skills in `skills/` call them with `node`, and nothing installs dependencies there. They import only `node:` built-ins and `scripts/lib/`. `@anthropic-ai/sdk` is the one runtime dependency, loaded lazily by `scripts/lib/model.mjs` for the model-backed evals.
- `evals/cases.json` holds the cross-package routing cases, `evals/verify-cases.json` the trigger cases of the verification skills, `evals/commands/<skill>/cases.json` the rubric cases of the plugin's workflow skills and `evals/packages.json` the packages whose skills the evals read. A package's own cases live in its `skills/<name>/cases.json`; the corpus loader collects them.
- `skills/` holds the plugin's own skills, loaded by both tools: `/antelopejs:<name>` in Claude Code, `$antelopejs:<name>` in Codex. A skill body takes its arguments from the request and reaches the scripts relative to its own directory (`<skill-dir>/../../scripts/…`): Codex expands neither `$ARGUMENTS` nor `${CLAUDE_PLUGIN_ROOT}` in skills, and has no plugin commands.
- The plugin is described twice: `.claude-plugin/plugin.json` (Claude Code) and `.codex-plugin/plugin.json` (Codex), with their marketplaces in `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. There is no root `plugin.json`: Codex would read it first, and with the agent-plugins.org `$schema` it loads no hooks. Installed copies update only when `version` changes, so a release bumps `version` in both plugin manifests and in `package.json` together.
- `scripts/check-plugin.mjs` (`pnpm check:plugin`, run in CI) checks those rules: the manifests, the versions, no `commands/`, the skill bodies, and that the two hook files differ only in the root variable and `--target`.

## Checks and tests

- There is no type check: the code is untyped JavaScript, so the `typecheck` script only prints that. `pnpm test` runs the `node:test` suites in `test/`.
- `pnpm run checks` does not run the evals. CI runs `pnpm evals:check` and `pnpm evals:baseline` (deterministic, no key, no model) after the checks. The model-backed evals run through `evals prepare`, `exec` (the local `claude` and `codex` CLIs) or an Amp Thread, and `score`; the `eval-skills` skill describes both executors. A change to `scripts/lib/` that touches scoring, the pass bar or the executors needs its test.

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
