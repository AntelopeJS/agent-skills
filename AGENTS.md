The AntelopeJS agent plugin for Claude Code and OpenAI Codex: the sync of the skills that AntelopeJS packages ship, the interface contract resolver, the plugin's own skills (four that drive the sync and the resolver, and the DMS workflow skills), and the skill evals. It is plain JavaScript (`.mjs`) that runs on Node.js alone.

## Layout

- `bin/agent-skills.mjs` is the CLI behind `npx -y github:AntelopeJS/agent-skills` (`sync`, `list`, `interface`, `verify`, `evals`). It dispatches to the scripts in `scripts/`.
- `plugin/` is the plugin folder, and an install gets only it. It holds what users run and nothing else: the manifests, the skills in `plugin/skills/`, the Codex hook file, `plugin/scripts/sync-skills.mjs`, `plugin/scripts/resolve-interface.mjs` with the `plugin/scripts/lib/` modules they import, and `plugin/packages/agent-skills/`. The Claude plugin directory reviews every file in it, so contributor files (`CLAUDE.md`, `.agents/`, the `.claude/skills` links, `.npmrc`), the evals and anything that reads a credential stay outside it. The marketplaces point at `./plugin`.
- The two plugin scripts run straight from the plugin folder: the Codex hooks in `plugin/hooks/codex-hooks.json` and the skills call them with `node`, and nothing installs dependencies there. They import only `node:` built-ins, `plugin/scripts/lib/` and `plugin/packages/agent-skills/`, each by relative path, never by a package name. The Claude plugin has no hooks: the directory holds a hook that runs a script other than a plain shell script, and accepts hooks only from Verified organizations. `@anthropic-ai/sdk` is the one runtime dependency, loaded lazily by `scripts/lib/model.mjs` for the model-backed evals, which stay outside the plugin folder.
- `plugin/packages/agent-skills/` is `@antelopejs/agent-skills`, the one implementation of which packages ship skills and which copy of each wins. The plugin imports it by relative path (a plugin checkout has no `node_modules`) and dms-assistant installs it from npm, so both see the same skills. It is plain ES-module JavaScript with a hand-written `index.d.ts`, imports only `node:` built-ins and has no top-level `await`, so dms-assistant, which is CommonJS, loads it with `require()`. Keep that, and keep the root `package.json` private: its `@anthropic-ai/sdk` dependency must not reach dms-assistant. The package is a pnpm workspace member released on its own: the `Release agent-skills` workflow runs the shared `release-npm-public.yml` in `plugin/packages/agent-skills` and tags `agent-skills-v<version>`, independently of the plugin version. The plugin owns the project layout (ancestors, workspace globs, `.antelope/cache`, the `node_modules` sweep) and the skill names; the package owns the order and the name reservation. The root `.npmrc` stops pnpm from hoisting `@types/*` into `node_modules/.pnpm/node_modules`: type-aware oxlint finds them there and reports hundreds of new findings in the untyped scripts and tests.
- `evals/cases.json` holds the trigger and answers cases of the plugin's DMS workflow skills, and the routing cases no package ships (drop a case there once its package ships it), `evals/verify-cases.json` the trigger cases of the verification skills, `evals/commands/<skill>/cases.json` the rubric cases of the plugin's workflow skills and `evals/packages.json` the packages whose skills the evals read. A package's own cases live in its `skills/<name>/cases.json`; the corpus loader collects them.
- `plugin/skills/` holds the plugin's own skills, loaded by both tools: `/antelopejs:<name>` in Claude Code, `$antelopejs:<name>` in Codex. A skill body takes its arguments from the request and reaches the scripts relative to its own directory (`<skill-dir>/../../scripts/…`): Codex expands neither `$ARGUMENTS` nor `${CLAUDE_PLUGIN_ROOT}` in skills, and has no plugin commands. `allowed-tools` names each exact command, never a whole program such as `Bash(node:*)`, once by `${CLAUDE_SKILL_DIR}/../../scripts/…` and once by `${CLAUDE_PLUGIN_ROOT}/scripts/…`, since a model writes either path. Claude Code expands both there; Codex ignores the field. Write it as a block list, one `  - Bash(<rule>)` per line with no comment, blank line, tag or anchor, under a bare `allowed-tools:` key: `check-plugin` reads no other form, so no rule can hide from it. A rule names a script in `plugin/scripts/` or a subcommand of a program in its `ALLOWED_PROGRAMS` (`ajs`); add a program there only when it cannot run arbitrary code.
- The plugin is described twice: `plugin/.claude-plugin/plugin.json` (Claude Code) and `plugin/.codex-plugin/plugin.json` (Codex), with their marketplaces in `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`. There is no `plugin.json` at the repository or plugin root: Codex would read it first, and with the agent-plugins.org `$schema` it loads no hooks.
- Every merge to `main` is a plugin release: both marketplaces install from the default branch, and installed copies update only when `version` changes. A pull request that changes a file the plugin ships therefore bumps `version` itself, in `plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json` and `package.json` together, and adds the user-facing change to `CHANGELOG.md` under that version. Pick the level from the change: patch for a fix or a wording change, minor for a new skill, script command or behaviour, major for a change that breaks an install (a removed skill, a renamed command, a new required package version). No separate `chore(release)` pull request bumps the plugin. Every file under `plugin/` ships except those of `plugin/packages/agent-skills/` other than `index.mjs`: the package has its own npm release, and its README, changelog and `package.json` changes need no plugin bump.
- `scripts/check-plugin-version.mjs` (`pnpm check:plugin-version`) fails when the branch changes a shipped file since it left `origin/main` while the manifest version is not greater than the one on `origin/main`. In the merge queue it compares with the commit the group builds on, so two queued pull requests cannot ship under one version. When another plugin release lands first, merge `origin/main` and bump past it. It does not check the `CHANGELOG.md` entry.
- `scripts/check-plugin.mjs` (`pnpm check:plugin`, run in CI) checks those rules: the manifests, the versions, the marketplace sources, no `commands/`, the skill bodies and their `allowed-tools`, no Claude hooks, a Codex hook file shaped as hooks, and no `CLAUDE.md`, symbolic link or package launcher (`npx`, `uvx`, …) in the plugin folder.

## Checks and tests

- `typecheck` runs `tsc` over `plugin/packages/agent-skills` only (JSDoc types in `index.mjs` checked against `index.d.ts`); the rest is untyped JavaScript. `test/tsconfig.json` lists the test files typed the same way, so type-aware lint reads `node:` types in them: add a new test file there to type it the same way. `pnpm test` runs the `node:test` suites in `test/`.
- `pnpm run checks` does not run the evals. CI runs `pnpm evals:check` and `pnpm evals:baseline` (deterministic, no key, no model) after the checks. The model-backed evals run through `evals prepare`, `exec` (the local `claude` and `codex` CLIs) or an Amp Thread, and `score`; the repository's `eval-skills` skill (`.agents/skills/eval-skills`, not shipped in the plugin) describes both executors. A change to `scripts/lib/` that touches scoring, the pass bar or the executors needs its test.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, check only what you touched, one test file and not the suite, as the [`verify-agent-skills`](.agents/skills/verify-agent-skills/SKILL.md) skill says.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
