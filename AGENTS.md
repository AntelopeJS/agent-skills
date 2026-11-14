The AntelopeJS agent plugin for Claude Code and OpenAI Codex: the sync of the skills that AntelopeJS packages ship, the interface contract resolver, the plugin's own skills (four that drive the sync and the resolver, and the DMS workflow skills), and the skill evals. It is plain JavaScript (`.mjs`) that runs on Node.js alone.

## Layout

- `bin/agent-skills.mjs` is the CLI behind `npx -y github:AntelopeJS/agent-skills` (`sync`, `list`, `interface`, `verify`, `evals`). It dispatches to the scripts in `scripts/`.
- `plugin/` is the plugin folder, and an install gets only it. It holds what users run and nothing else: the manifests, the skills in `plugin/skills/`, the Codex hook file, `plugin/scripts/sync-skills.mjs`, `plugin/scripts/resolve-interface.mjs` with the `plugin/scripts/lib/` modules they import, and `plugin/packages/agent-skills/`. The Claude plugin directory reviews every file in it, so contributor files (`CLAUDE.md`, `.agents/`, the `.claude/skills` links, `.npmrc`), the evals and anything that reads a credential stay outside it. The marketplaces point at `./plugin`.
- The two plugin scripts run straight from the plugin folder: the Codex hooks in `plugin/hooks/codex-hooks.json` and the skills call them with `node`, and nothing installs dependencies there. They import only `node:` built-ins, `plugin/scripts/lib/` and `plugin/packages/agent-skills/`, each by relative path, never by a package name. The Claude plugin has no hooks: the directory holds a hook that runs a script other than a plain shell script, and accepts hooks only from Verified organizations. `@anthropic-ai/sdk` is the one runtime dependency, loaded lazily by `scripts/lib/model.mjs` for the model-backed evals, which stay outside the plugin folder.
- `plugin/packages/agent-skills/` is `@antelopejs/agent-skills`, the one implementation of which packages ship skills and which copy of each wins. The plugin imports it by relative path (a plugin checkout has no `node_modules`) and dms-assistant installs it from npm, so both see the same skills. It is plain ES-module JavaScript with a hand-written `index.d.ts`, imports only `node:` built-ins and has no top-level `await`, so dms-assistant, which is CommonJS, loads it with `require()`. Keep that, and keep the root `package.json` private: its `@anthropic-ai/sdk` dependency must not reach dms-assistant. The package is a pnpm workspace member released on its own: the `Release agent-skills` workflow runs the shared `release-npm-public.yml` in `plugin/packages/agent-skills` and tags `agent-skills-v<version>`, independently of the plugin version. The plugin owns the project layout (ancestors, workspace globs, `.antelope/cache`, the `node_modules` sweep) and the skill names; the package owns the order and the name reservation. The root `.npmrc` stops pnpm from hoisting `@types/*` into `node_modules/.pnpm/node_modules`: type-aware oxlint finds them there and reports hundreds of new findings in the untyped scripts and tests.
- `evals/cases.json` holds the trigger and answers cases of the plugin's DMS workflow skills, and the routing cases no package ships (drop a case there once its package ships it), `evals/verify-cases.json` the trigger cases of the verification skills, `evals/commands/<skill>/cases.json` the rubric cases of the plugin's workflow skills and `evals/packages.json` the packages whose skills the evals read. A package's own cases live in its `skills/<name>/cases.json`; the corpus loader collects them.
- `plugin/skills/` holds the plugin's own skills, loaded by both tools: `/antelopejs:<name>` in Claude Code, `$antelopejs:<name>` in Codex. A skill body takes its arguments from the request and reaches the scripts relative to its own directory (`<skill-dir>/../../scripts/…`): Codex expands neither `$ARGUMENTS` nor `${CLAUDE_PLUGIN_ROOT}` in skills, and has no plugin commands. `allowed-tools` names each exact command, never a whole program such as `Bash(node:*)`, once by `${CLAUDE_SKILL_DIR}/../../scripts/…` and once by `${CLAUDE_PLUGIN_ROOT}/scripts/…`, since a model writes either path. Claude Code expands both there; Codex ignores the field. Write it as a block list, one `  - Bash(<rule>)` per line with no comment, blank line, tag or anchor, under a bare `allowed-tools:` key: `check-plugin` reads no other form, so no rule can hide from it. A rule names a script in `plugin/scripts/` or a subcommand of a program in its `ALLOWED_PROGRAMS` (`ajs`); add a program there only when it cannot run arbitrary code.
- The plugin is described twice: `plugin/.claude-plugin/plugin.json` (Claude Code) and `plugin/.codex-plugin/plugin.json` (Codex), with their marketplaces in `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. There is no `plugin.json` at the repository or plugin root: Codex would read it first, and with the agent-plugins.org `$schema` it loads no hooks. Installed copies update only when `version` changes, so a release bumps `version` in both plugin manifests and in `package.json` together.
- `scripts/check-plugin.mjs` (`pnpm check:plugin`, run in CI) checks those rules: the manifests, the versions, the marketplace sources, no `commands/`, the skill bodies and their `allowed-tools`, no Claude hooks, a Codex hook file shaped as hooks, and no `CLAUDE.md`, symbolic link or package launcher (`npx`, `uvx`, …) in the plugin folder.

## Checks and tests

- `typecheck` runs `tsc` over `plugin/packages/agent-skills` only (JSDoc types in `index.mjs` checked against `index.d.ts`); the rest is untyped JavaScript. `test/tsconfig.json` lists the test files typed the same way, so type-aware lint reads `node:` types in them: add a new test file there to type it the same way. `pnpm test` runs the `node:test` suites in `test/`.
- `pnpm run checks` does not run the evals. CI runs `pnpm evals:check` and `pnpm evals:baseline` (deterministic, no key, no model) after the checks. The model-backed evals run through `evals prepare`, `exec` (the local `claude` and `codex` CLIs) or an Amp Thread, and `score`; the repository's `eval-skills` skill (`.agents/skills/eval-skills`, not shipped in the plugin) describes both executors. A change to `scripts/lib/` that touches scoring, the pass bar or the executors needs its test.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, suppressions, and sync, and prints only what failed. The change is done when it prints no failure.

### While you work

`pnpm run checks` runs every step, so run it once, at the end. While you iterate, run only the check that covers what you changed:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- Run one test file instead of the whole suite. In a module that tests with `ajs module test`, run `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`. Repeat `-f` for more files.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

Before suppressing a type rule, try inference or a type derived from its owner with `Parameters`, `ReturnType`, or indexed access. A private alias can still appear in a published declaration. Keep a suppression only after checking the published contract and the unchecked boundary it protects.

Check each directive reason against the current line and its callers. Returning a value is not the same as awaiting and discarding it. A reason must describe what the code does now.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Cleanup proof

A behaviour-preserving cleanup PR shows `antelopejs-api-diff <base-ref>` passing. Published declarations, built runtime exports and the names and signatures a DMS frontend module auto-imports stay unchanged; pass `--allow-added <glob>` (repeatable, e.g. `'**/internal/**'`) to let added entries under that glob pass when their module is `@internal`, and copy its "Added (allowed)" list. Every export under a directory that `dms.frontend.build.ts` auto-imports is published, `@internal` or not; a helper that must stay private goes under `app/build/`. A comment-only PR shows `antelopejs-comment-proof <base-ref>` passing instead of a verifier. Both compare committed HEAD.

Copy the proof's whole output into the PR body, down to its closing `<!-- antelopejs-proof ... -->` line, which stamps the command, base, committed head and a digest. Never type counts by hand. List the lint findings a PR leaves in place by pasting the block `antelopejs-body-check --findings` prints and replacing each `<why>`. `antelopejs-body-check <body.md>` fails an edited or stale proof block, proof output outside one, and a findings line that is not a live diagnostic at HEAD; counts in prose are not checked, so leave them out. The table counts a lint directive once per rule it names, inline directives included.

Pass `--probe <file.cjs>` to api-diff when changing receivers, positional calls, or modules that no published entry reaches. The same captured script runs against both worktree roots, supplied as `argv[2]`, and prints JSON observations. Matching metadata alone does not prove those behaviours.

An entry-only rule exempts only its own module. Add a second module entry rather than exempting another importer. A no-upward rule must reject peers in the same tier as well as higher tiers. Probe the rank decision with an import, not just a reading of the configuration.

Moving a method body into a function keeps how it is called: the same receiver, argument count, read order and laziness.

Verify a boundary against the imports a developer or agent would plausibly write: static and dynamic imports, re-exports, Vue `src`, CSS `@import`, and worker or child-process entries in normally named files. A construction only an evasion would write, an edit to resolution configuration (`package.json` `browser`, `exports`, `main` or `imports`, bundler aliases, tsconfig `paths`), and a difference observable only by patching private fields or internal methods go under Attention and never block. Public API and ordinary subclass behaviour stay part of the contract.

### Suppression budget

`guardrails.suppressions.json` caps the suppressions in authored code, the repository's own files under `.agents/`, `.claude/` and the other agent directories included (`agentFiles`; only what `antelopejs-sync` writes there is skipped): lint directives per rule they name (`*` for none), `@ts-expect-error`, `@ts-ignore` and `SAFETY:` comments, and under `config` each rule a lint config (`oxlint.config.*`, `.oxlintrc.json`, `eslint.config.*`) switches off or to a warning, keyed by rule and `files` glob anchored at the config's directory, so widening or moving a scope is a new ceiling of 0, while narrowing one takes over the room it gives up. Switching a rule off in a config is a suppression too: fix the code its rule reports instead. A suppression over its ceiling fails: fix the code, or remove another suppression of the same kind. A rule that keeps needing suppressions should be changed in the preset. Never raise or remove a number in that file: the check fails a ceiling higher than on the pull request base, and only the operator approves a raise. A directive disabling `anti-slop/require-safety-comment-for-type-assertion` is burn-down debt: remove the assertion, or, where it holds, replace the directive with `SAFETY: <why it holds>`, which takes over its room without a raise. After you remove suppressions, run `pnpm run suppressions:update` and commit the lowered file.

### What enforces what

| Rule                                                                               | Enforced by                                         |
| ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| Formatting                                                                         | oxfmt                                               |
| Lint findings are errors; no rule warns                                            | oxlint preset                                       |
| Comments are TSDoc, directives, or `SAFETY:` only                                  | `antelopejs/no-comments`                            |
| Every test asserts                                                                 | `antelopejs/require-assertion`                      |
| Tests read no files outside fixtures, helpers, locales                             | `antelopejs/no-fs-read-in-tests`                    |
| Tests import the code under test from local source, not their own package name     | `antelopejs/no-self-import-in-tests`                |
| No assertion that restates a constant                                              | `antelopejs/no-constant-value-assertion`            |
| No test whose only check is "is a function"                                        | `antelopejs/no-typeof-function-only-test`           |
| String-keyed object tables are read through own keys only                          | `antelopejs/no-inherited-key-lookup`                |
| A type guard checks each member it narrows to; keys with `Object.hasOwn`           | `antelopejs/no-presence-only-type-guard`            |
| A type guard checks the nested elements and values it claims                       | review; no tool                                     |
| A startup read does not decide an insert another replica can race                  | `antelopejs/no-read-then-insert`                    |
| An async function or promise callback returns no unrun database query              | `antelopejs/no-unrun-query`                         |
| `Object.assign` writes no `unknown`, `any` or mistyped value over a field          | `antelopejs/no-unsafe-object-assign`                |
| Every file type-aware lint reads is listed by a tsconfig that resolves its imports | `antelopejs/require-tsconfig-include`               |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20     | `eslint/max-*`, `eslint/complexity`                 |
| Cleanup preserves declarations, runtime exports and DMS auto-imports               | `antelopejs-api-diff <base-ref>`                    |
| Comment-only changes preserve JavaScript emit                                      | `antelopejs-comment-proof <base-ref>`               |
| PR-body proof tables are copied unedited from the current head                     | `antelopejs-body-check <body.md>`                   |
| PR-body findings-left lines are live diagnostics at HEAD                           | `antelopejs-body-check <body.md>`                   |
| Receiver, positional and unpublished-module behaviour                              | `antelopejs-api-diff <base-ref> --probe <file.cjs>` |
| Directive and `SAFETY:` reasons are true of the code                               | review; no tool                                     |
| Evasion-only and patched-internal findings go under Attention                      | review; no tool                                     |
| No-upward rules reject same-tier peers                                             | review and import probes                            |
| No `@ts-ignore`                                                                    | `typescript/ban-ts-comment`                         |
| No once-used type parameter standing in for `unknown`                              | `typescript/no-unnecessary-type-parameters`         |
| No `any` passed, assigned or returned where a type is declared                     | `typescript/no-unsafe-{argument,assignment,return}` |
| Files ≤ 20,000 bytes, tests and agent files included                               | `antelopejs-check-size` (pre-commit)                |
| Suppressions stay within `guardrails.suppressions.json`                            | `antelopejs-suppressions` (pre-commit, checks)      |
| No lint config switches off a rule to stay under the budget                        | `antelopejs-suppressions` (pre-commit, checks)      |
| No added directive disables the `SAFETY:`, comment or test rules                   | `antelopejs-suppressions` (pre-commit, checks)      |
| An added suppression gives a specific reason                                       | `antelopejs-suppressions` (pre-commit, checks)      |
| A directive in a file a change touches suppresses something and gives a reason     | `antelopejs-suppressions` (pre-commit, checks)      |
| A block disable is closed in its file                                              | `antelopejs-suppressions` (pre-commit, checks)      |
| Types check                                                                        | `tsc` (pre-push)                                    |
| No dead files, exports, or dependencies                                            | knip                                                |
| Managed files match the pack                                                       | `antelopejs-sync --check`                           |
| A CI gate reads `needs.<id>` only of jobs in its `needs`                           | `antelopejs-sync --check`                           |
| Entry-only rules exempt no tracked outsider                                        | `antelopejs-sync --check`                           |
| A DMS layer's `build/backend-boundary.ts` is the pack's plugin                     | `antelopejs-sync --check`                           |
| No `skipLibCheck` in the root tsconfig or one `typecheck` or `build` uses          | `antelopejs-sync --check`                           |
| `build` skips the lib check only over what `typecheck` checks                      | `antelopejs-sync --check`                           |
| `release` runs `typecheck`                                                         | `antelopejs-sync --check`                           |
| A test names the wrong implementation it catches                                   | review; no tool                                     |

<!-- antelopejs-guardrails:end -->
