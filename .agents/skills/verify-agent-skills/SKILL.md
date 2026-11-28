---
name: verify-agent-skills
description: How to check a change in AntelopeJS/agent-skills (the Claude Code and Codex plugin, its scripts, the @antelopejs/agent-skills package and the skill evals) before you push it, scoped to what you touched. Use after you edit plugin skills, scripts, tests, evals or manifests.
---

# Verify a change in agent-skills

CI and the merge queue run every check. You run only the row for what you changed, so a wrong change fails on your machine in seconds. The repository's own rules are in `AGENTS.md`: read it when a row does not cover your change.

## Setup

Once per checkout: `pnpm install`. pnpm 10 (`packageManager` in `package.json`) on a current Node.js. The plugin scripts run on Node.js alone.

## What to run for your change

| You changed | Run |
| --- | --- |
| Any `.mjs`, `.json` or Markdown file | `pnpm exec oxlint <files>` and `pnpm exec oxfmt --check <files>` |
| A type, a signature or `plugin/packages/agent-skills/index.mjs` or `index.d.ts` | `pnpm run typecheck` (`tsc` over that package only; it is fast) |
| A script in `scripts/`, `plugin/scripts/` or `bin/` | The one test file that covers it: `node --test --test-concurrency=4 test/<name>.test.mjs`. A new test file also goes in `test/tsconfig.json`. |
| Scoring, the pass bar or an executor in `scripts/lib/` | Its test, `node --test --test-concurrency=4 test/<name>.test.mjs` (`scoring`, `passbar`, `executors`, `run-score`, `rubric`). A change here needs a test. |
| A plugin skill in `plugin/skills/`, a manifest, a marketplace or a hook file | `pnpm check:plugin` |
| Any file the plugin ships (everything under `plugin/` except the package's files other than `index.mjs`) | Bump `version` in `plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json` and `package.json` together, add the `CHANGELOG.md` entry, then `pnpm check:plugin-version` |
| `evals/cases.json`, `evals/verify-cases.json`, `evals/commands/*/cases.json` or a package's `cases.json` | `pnpm evals:check` |
| A lint directive, `@ts-expect-error` or `SAFETY:` comment | `pnpm run suppressions`; after removing one, `pnpm run suppressions:update` and commit `guardrails.suppressions.json` |
| A file `antelopejs-sync` writes (`ci.yml`, `lefthook.yml`, the Guardrails block, `verify-changes`) | Nothing by hand: change `@antelopejs/tooling-configs`, run `pnpm run sync`, then `pnpm run sync:check` |

The commit hook formats and lints the staged files again.

## Tools

pnpm, oxlint and oxfmt (config at the repository root), `node:test` for `test/*.test.mjs`, `tsc` for the package, knip, lefthook, and `antelopejs-checks` behind `pnpm run checks`.

## Services

None. No test needs a database or a network service. The model-backed evals need `claude`, `codex` or an API key and are never part of a local check.

## Scope

One test file at a time, with `--test-concurrency=4` at most. Never run `pnpm test` alone: it runs every file in `test/`.

## Left to CI

The agent reads these on its pull request and reruns none of them locally, apart from the scoped command of a failing check:

- `ci / checks` (`ci.yml`, job `ci`, shared `ci-node.yml`): `pnpm run checks`, the full suite, `knip`, `size` and `sync:check`, plus `extra-commands`: `pnpm check:plugin`, `pnpm check:plugin-version`, `pnpm evals:check` and `pnpm evals:baseline`.
- The merge queue (`merge_group`) runs the full suite again on the merged result; `check:plugin-version` then compares with the commit the group builds on.
- The nightly run (`schedule` or `workflow_dispatch` with `nightly`) adds the nightly tier. There is no Windows leg: the plugin has no Windows-specific code.
- `verdict` (`ci.yml`) fails when any job it needs failed.
- `Release` (`release.yml`) publishes `@antelopejs/agent-skills` on its own tag.

## Done

The change is checked when every row its diff touches passed, with the command and its output shown. A row that cannot run goes in the report with the reason.
