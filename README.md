<div align="center">
  <img src="./.github/assets/logo.png" alt="AntelopeJS logo" width="88">
  <h1>AntelopeJS agent skills</h1>
  <p><strong>The AntelopeJS and DMS skills, synced into Claude Code and Codex.</strong></p>

<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/ai-and-claude-code/overview"><img alt="Docs" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

</div>

Tools for coding agents building with [AntelopeJS](https://github.com/AntelopeJS) — the Node.js framework where a tight core + `ajs` CLI orchestrate modules that communicate **only** through versioned _interface_ contracts — and with the AntelopeJS DMS. Every skill ships inside an npm package (the framework skills in `@antelopejs/core`, the DMS suite in `@antelopejs/dms`, one per module or interface); this plugin syncs them into your project, resolves interface contracts live, and adds four skills of its own.

The repository is one plugin, `antelopejs`, packaged for **Claude Code** and **OpenAI Codex**, from one marketplace also named `antelopejs`.

## Install

### Claude Code

From your shell:

```bash
claude plugin marketplace add AntelopeJS/agent-skills
claude plugin install antelopejs@antelopejs
```

Or from inside a Claude Code session:

```
/plugin marketplace add AntelopeJS/agent-skills
/plugin install antelopejs@antelopejs
```

`antelopejs@antelopejs` is the plugin `antelopejs` from the marketplace `antelopejs` (this repository). The install lands in your user scope, so every project sees it. Restart the session (or run `/reload-plugins`) to load it. To install it for one repository only, recorded in that repository's `.claude/settings.json`, add `--scope project` to both commands.

The plugin's hooks sync the project's package-shipped skills into `.claude/skills/` on their own.

### Codex

From your shell:

```bash
codex plugin marketplace add AntelopeJS/agent-skills
codex plugin add antelopejs@antelopejs
```

Or open `/plugins` in Codex (or the Plugins directory of the desktop app) after the first command, and install `antelopejs` from the **AntelopeJS** marketplace.

Then trust the plugin's hooks: open `/hooks` in Codex (the CLI or the desktop app) and trust the `antelopejs` entries. Codex runs a plugin's hooks only once they are trusted, and asks again after every plugin update. From then on the hooks sync the project's package-shipped skills into `.agents/skills/`, where Codex discovers them, on their own, as in Claude Code.

Until the hooks are trusted, sync by hand from the project root, and again after installing or upgrading packages:

```bash
npx -y github:AntelopeJS/agent-skills sync --target codex
```

### Without a plugin

The sync needs only Node.js. From a project root, this links the package-shipped skills into both `.claude/skills/` and `.agents/skills/`:

```bash
npx -y github:AntelopeJS/agent-skills sync
```

`list` shows what would be synced, `--target claude|codex` restricts the sync to one directory, `interface` runs the contract resolver (`npx -y github:AntelopeJS/agent-skills interface show database`), and `verify` / `evals` check answers and skills (see [Evaluating the skills](#evaluating-the-skills)).

## What you get

| Kind   | Name                                    | Use                                                                                                         |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Skill  | `antelopejs:eval-skills`                | Run the skill evals on a pull request or a directory and produce an Eval report                             |
| Skill  | `antelopejs:interface <name> [subpath]` | Look up an interface contract                                                                               |
| Skill  | `antelopejs:new-module <path>`          | Scaffold a module and wire its interfaces                                                                   |
| Skill  | `antelopejs:skills`                     | List the skills synced from the project's packages and where each comes from                                |
| Skill  | `antelopejs:sync-skills`                | Sync those skills now                                                                                       |
| Hooks  | `SessionStart`, `PostToolUse` (Bash)    | Run the skill sync automatically (Codex: once trusted in `/hooks`)                                          |
| Script | `scripts/resolve-interface.mjs`         | The interface contract resolver, also run as `npx -y github:AntelopeJS/agent-skills interface …`            |
| CLI    | `verify`, `evals`                       | Report invented API names in an answer or a diff; score which skills a prompt triggers or catch seeded bugs |

Invoke the plugin's skills as `/antelopejs:<name>` in Claude Code and `$antelopejs:<name>` in Codex; both tools also pick them on their own when a request matches. They take their arguments from the request and reach the plugin's scripts relative to their own directory, so the same files serve both tools.

Beyond those five, the plugin carries no skill. The framework skills — `antelopejs` (mental model and router), `ajs-cli`, `ajs-consume-interface` and `ajs-author-interface` — ship with `@antelopejs/core` and are synced like any package skill, as `core--<skill>`. They follow the core version the project installs.

> **Release dependency.** `@antelopejs/core` ships these skills from its first release after 1.15.2. With an older core, a project has no framework skills until it upgrades `@antelopejs/core`; plugin versions before 0.3.0 still bundled them.

## What syncs, and when

Packages ship their own skills: a package declares `antelopeJs.skills` in its `package.json` (directories whose subdirectories each hold a `SKILL.md`). The sync links every such skill as `<package-short-name>--<skill>` into the open project's `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex):

- **When**: through the hooks, at session start and after every Bash command (so `pnpm install`, `ajs project dev`, or `ajs project modules add` that bring new packages are picked up); otherwise when you run the sync command. Claude Code loads the new skills in the running session; if `.claude/skills/` did not exist when the session started, run `/reload-skills` once. Codex detects skill changes on its own; restart it if a skill does not appear.
- **Where it looks**, first hit per package wins:
  1. the **workspace**: the current package, its parents up to the repository root, and the packages listed in that root's `pnpm-workspace.yaml` or `package.json` `workspaces` (source checkouts and module playgrounds);
  2. **`node_modules`** of the project and of the workspace root (pnpm's symlinks into `.pnpm` included; the link goes through `node_modules/<pkg>` so it survives version bumps);
  3. **`.antelope/cache`**, where `ajs` downloads the modules declared in `antelope.config.ts` on `ajs project dev`, `build`, or `modules add`.
- **Which projects**: a directory holding `antelope.config.*`, or an app whose `package.json` depends on `@antelopejs/core` (an embedded runtime, like the AdonisJS DMS template). Anywhere else the sync does nothing.
- **Safety**: only the entries the sync created are touched. Each skills directory tracks them in its own `.ajs-managed.json` and lists them in a generated `.gitignore`, so your repository stays clean; a skill of yours with the same entry name is skipped, never overwritten; entries whose package disappeared are removed.

Every AntelopeJS project gets the framework skills this way (`core--antelopejs`, `core--ajs-cli`, `core--ajs-consume-interface`, `core--ajs-author-interface` from `@antelopejs/core`, a dependency of every project the sync acts on). In a **DMS project** it also brings the DMS suite: `dms` (the DMS router, start there), `dms-project`, `dms-module`, `dms-pages`, `dms-auth` and `dms-best-practices` from `@antelopejs/dms`, `dms-frontend` from `@antelopejs/dms-frontend`, plus one skill per installed `dms-*` module. Run the `antelopejs:skills` skill (or `npx -y github:AntelopeJS/agent-skills list`) to see them; the [skill catalog](https://dms.antelopejs.com/docs/ai-and-claude-code/skill-catalog) lists the whole suite, the package that ships each skill and when it triggers.

**dms-ai** (the DMS AI assistant) needs none of this: it loads by itself the skills of every loaded module, of their dependencies, and of the project's own dependencies (the framework skills included). The plugin is for the coding agent working on the project's code.

## Prompt every contributor to install it

For Claude Code, commit this `.claude/settings.json` in a project (the DMS templates ship it):

```json
{
  "extraKnownMarketplaces": {
    "antelopejs": {
      "source": {
        "source": "github",
        "repo": "AntelopeJS/agent-skills"
      }
    }
  },
  "enabledPlugins": {
    "antelopejs@antelopejs": true
  }
}
```

When a contributor opens the project in Claude Code and accepts the workspace trust dialog, Claude Code registers the marketplace and enables the plugin; the `/plugin` menu shows it. `claude plugin marketplace add AntelopeJS/agent-skills --scope project` followed by `claude plugin install antelopejs@antelopejs --scope project` writes the same file.

For Codex, document the commands of [Install › Codex](#codex) in the project's `README.md` or `AGENTS.md`; the DMS templates do both.

## Update

Claude Code:

```bash
claude plugin marketplace update antelopejs
claude plugin update antelopejs@antelopejs
```

In a session: `/plugin marketplace update antelopejs`, then restart. To update in the background, open `/plugin` → **Marketplaces** → `antelopejs` → **Enable auto-update**.

Codex (refreshes the marketplace snapshot and the installed copy):

```bash
codex plugin marketplace upgrade antelopejs
```

Installed copies update when `version` changes in `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`, so bump both on every release. After a Codex update, trust the hooks again in `/hooks`. `npx -y github:AntelopeJS/agent-skills` always runs the latest commit of the default branch.

The synced skills follow your packages, not the plugin: upgrade `@antelopejs/dms` or a module and the next sync points at the new version.

## Uninstall

Claude Code:

```bash
claude plugin uninstall antelopejs@antelopejs
claude plugin marketplace remove antelopejs
```

Add `--scope project` to `uninstall` when it was installed for one repository, and remove the two keys from that repository's `.claude/settings.json`.

Codex:

```bash
codex plugin remove antelopejs@antelopejs
codex plugin marketplace remove antelopejs
```

To drop the synced skills from a project, delete the entries listed in `.claude/skills/.ajs-managed.json` and `.agents/skills/.ajs-managed.json`, along with those files and the `.gitignore` next to each.

## Troubleshooting

| Symptom                                        | Fix                                                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Claude Code project settings do not prompt | The folder is not trusted yet: restart Claude Code in it and accept the trust dialog. In `-p` runs the entries apply only in folders trusted interactively before.                                 |
| No DMS skills in `antelopejs:skills` or `list` | The packages are not installed: run `pnpm install`; modules declared in `antelope.config.ts` arrive in `.antelope/cache` on the first `ajs project dev`. Then sync again.                          |
| No `core--*` skills                            | The installed `@antelopejs/core` predates the framework skills: upgrade it (`pnpm add @antelopejs/core@latest`), then sync again.                                                                  |
| "Not an AntelopeJS project"                    | Run the agent (or the sync) in the directory holding `antelope.config.*` (or the app depending on `@antelopejs/core`), not in a parent folder.                                                     |
| A synced skill does not show up                | Claude Code: run `/reload-skills`; `.claude/skills/` did not exist when the session started. Codex: restart it.                                                                                    |
| An entry is reported `skipped`                 | A file or folder of yours already uses that name in the skills directory; rename or remove it.                                                                                                     |
| Hooks seem not to run                          | Claude Code: check `claude plugin list` shows the plugin enabled; `node` must be on `PATH`. Codex: trust the hooks in `/hooks` (again after each plugin update), or run the sync command yourself. |

## Design: three layers of knowledge

AntelopeJS's own architecture dictates how the knowledge is organized. The stable core is hand-authored; the extensive, versioned interface set is resolved on demand from its source of truth so it never goes stale; product knowledge (the DMS, its modules) ships with the packages themselves.

| Layer            | What                                                                    | Mechanism                                                                                                               |
| ---------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **1. Concepts**  | The mental model: core, CLI, modules, interfaces-as-versioned-contracts | `antelopejs` router skill, shipped by `@antelopejs/core`                                                                |
| **2. Workflows** | Consume an interface, author/version a contract, drive the CLI          | `ajs-consume-interface`, `ajs-author-interface`, `ajs-cli` skills, shipped by `@antelopejs/core`, + the plugin's skills |
| **3. Contracts** | The actual interface APIs, per name@version                             | `scripts/resolve-interface.mjs` — reads the `@antelopejs/interface-*` packages live                                     |
| **Products**     | DMS, dms-* modules, interface packages                                  | Skills shipped in each package                                                                                          |

Every skill lives in the package whose version it describes and reaches the agent through `scripts/sync-skills.mjs` (or dms-ai's own loader); the plugin keeps only what no package can carry: the sync, the resolver, and the four skills that drive them.

Skills are split by **intent**, not audience: a framework user asking "how do I import the database interface" hits `ajs-consume-interface`; a core dev asking "how do I version this contract" hits `ajs-author-interface`. The router skill sends each to the right place and keeps context lean (progressive disclosure).

## Layout

```
agent-skills/
  .claude-plugin/
    plugin.json            # Claude Code manifest
    marketplace.json       # Claude Code marketplace (this repo)
  .codex-plugin/
    plugin.json            # Codex manifest (hooks: hooks/codex-hooks.json)
  .agents/plugins/
    marketplace.json       # Codex marketplace (this repo)
  skills/                  # the plugin's skills, shared by Claude Code and Codex
    eval-skills/SKILL.md   # antelopejs:eval-skills
    interface/SKILL.md     # antelopejs:interface <name> [subpath]
    new-module/SKILL.md    # antelopejs:new-module <path>
    skills/SKILL.md        # antelopejs:skills
    sync-skills/SKILL.md   # antelopejs:sync-skills
  hooks/
    hooks.json             # Claude Code: skill sync into .claude/skills (SessionStart + after Bash)
    codex-hooks.json       # Codex: skill sync into .agents/skills
  bin/
    agent-skills.mjs       # npx entry: sync, list, interface, verify, evals
  scripts/
    resolve-interface.mjs  # Layer 3 — live contract resolver
    sync-skills.mjs        # syncs package-shipped skills into .claude/skills and .agents/skills
    check-plugin.mjs       # checks the plugin loads the same way in Claude Code and Codex
    verify.mjs             # API names of an answer or diff vs the installed .d.ts
    evals.mjs              # trigger and answer-quality evals
    lib/                   # corpus loader, dataset schema, baseline, scoring, backends, prepare/exec/score
  evals/
    cases.json             # cross-package routing cases (the skills' own cases live beside them)
    commands/<skill>/      # rubric cases of the plugin's workflow skills
    packages.json          # published packages of the CI corpus (--published)
  test/                    # node:test suites
```

## The resolver

Contracts are versioned data, not memorized facts. The resolver reads them straight from the
published `@antelopejs/interface-*` packages on **npm** — no local checkout required. It
fetches `<pkg>@<version>` on demand (published tarballs ship the `dist/*.d.ts` contract),
caches the extracted tarball, and reads it:

```bash
node scripts/resolve-interface.mjs list                  # interfaces on npm (+ any installed locally)
node scripts/resolve-interface.mjs show database          # surface, symbols, versions
node scripts/resolve-interface.mjs contract database query    # full TSDoc'd .d.ts contract
node scripts/resolve-interface.mjs show database@0.1.0    # a specific published version
node scripts/resolve-interface.mjs versions database      # published versions + dist-tag latest
node scripts/resolve-interface.mjs implementations auth   # providers (registry manifest, fetched over HTTP)
```

`<name>` accepts `core`, `interface-core`, or `@antelopejs/interface-core`, optionally with
`@<version>` (default: the `latest` dist-tag). Bare names resolve against the public
`@antelopejs` scope **plus any scope discovered from the current project**: every dependency
(or optionalDependency) in the cwd's `package.json` matching `@<scope>/interface-*`
contributes its scope, and `AJS_INTERFACE_SCOPES` (comma-separated) adds more. Nothing
scope-specific is hardcoded — a project depending on `@acme/interface-payments` makes
`show payments` resolve, and private registries work through your own `.npmrc` without the
plugin knowing any name.

**Interfaces exposed as subpaths.** An embedded interface (`<module>/interface`) or a host
package exporting `./interfaces/<group>` subpaths (older DMS releases did this; current ones
publish `@antelopejs/interface-dms`) resolves too. Hosts are discovered from the current
project (its dependencies in `node_modules`, the CLI's `.antelope/cache`, and a scan of
`AJS_DMS_DIR`/the cwd for source checkouts); `AJS_DMS_PACKAGES` (comma-separated) names extra
hosts explicitly:

```bash
node scripts/resolve-interface.mjs show @acme/broker/interface              # an embedded interface
node scripts/resolve-interface.mjs show dms-host:dms-base                   # <host-short-name>:<group> shorthand
node scripts/resolve-interface.mjs contract dms-host:dms-base form          # a part of the interface
```

**Where it reads from.** The npm registry is the source of truth. A locally-present copy — the
open project's `node_modules` and `.antelope/cache`, a checkout under `$AJS_INTERFACES_DIR`
(colon-separated), or a discovered host package — is used as an **offline fast-path** when
present and no version is pinned, but is never required. Flags:
`--remote` forces a fresh npm fetch (skip the local copy), `--offline` forbids the network
(local only), `--json` for machine output. The tarball cache lives at
`~/.cache/ajs-interface-resolver` (override with `AJS_RESOLVER_CACHE`).

## Shipping skills from a package

Declare the skill directories in the package's `package.json`, and publish them:

```jsonc
// package.json of any module or interface package
"files": ["dist", "skills"],
"antelopeJs": { "skills": ["./skills"] }
```

Each `skills/<name>/SKILL.md` becomes `.claude/skills/<package-short-name>--<name>` and
`.agents/skills/<package-short-name>--<name>` in every project that installs the package. Run
`npx -y github:AntelopeJS/agent-skills list` (or the `antelopejs:skills` skill) in a consuming project to
check what it picks up.

## Evaluating the skills

A skill only helps when the agent loads it, and a loaded skill only helps when the answer it produces uses real APIs. Two evals and one checker measure both. No eval needs an API key: the model-backed runs go through the logged-in `claude` and `codex` CLIs, or through an Amp Thread (see the `antelopejs:eval-skills` skill).

### The cases

A case is a user prompt, the skills an agent should load for it (`expect.skills`), the ones it may load without penalty (`expect.acceptable`), the ones it must not load (`expect.avoid`, for a prompt that belongs to a neighbour), and optionally API names the answer must or must not mention and an expected behaviour (`asks-first`: ask the user before writing code, as `dms-best-practices` requires before leaving DMS blocks). `style` is `clean` (well formed) or `casual` (as typed).

Cases live beside their skill, in `skills/<name>/cases.json` of the package that ships it (`{ "version": 1, "cases": [...] }`); [`evals/cases.json`](evals/cases.json) keeps the cross-package routing cases and [`evals/verify-cases.json`](evals/verify-cases.json) the trigger cases of the verification skills (`verify-antelopejs`, `verify-dms` and the shared `verify-interface`, `verify-module`, `verify-template`), which no package ships: their cases are skipped until `--skills` points at a checkout holding them. The corpus loader collects both, and a skill's own case replaces a central case with the same id. `scripts/lib/dataset.mjs` is the schema; `pnpm test` rejects an invalid file.

Every skill needs the minimum, enforced by `evals check`: a clean and a casual should-trigger case, one should-not-trigger case (`avoid`) aimed at its nearest neighbour, and one answers case with `mustMention` or a `behaviour`. Write prompts the way users ask, from the package's docs and issues.

The plugin's own workflow skills (`new-module`, `interface`) have rubric cases under [`evals/commands/<skill>/cases.json`](evals/commands): an organic prompt, a fixture and 3 to 6 criteria a judge scores from the transcript. `evals check` validates them; they run in the eval Thread, not in the deterministic harness.

### The corpus

The skills an eval runs against, by name and description, read from their `SKILL.md`:

| Option                                             | Source                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--project <dir>` (default: the current directory) | what the sync finds there: workspace, `node_modules`, `.antelope/cache`                                        |
| `--skills <dir>` (repeatable)                      | every `SKILL.md` under the directory, e.g. a checkout under review                                             |
| `--packages <a,b>` / `--published`                 | the skills shipped by npm packages, fetched as tarballs; `--published` takes the list in `evals/packages.json` |

When two sources ship a skill of the same name, the first wins, in that order. An expected skill missing from the corpus is left out of the score, and a case with none left is reported `skipped`, so the evals keep working while skills move between packages.

### Prepare, execute, score

```bash
npx -y github:AntelopeJS/agent-skills evals prepare --out run --skills skills --published
npx -y github:AntelopeJS/agent-skills evals exec run
npx -y github:AntelopeJS/agent-skills evals score run --report
```

`prepare` writes `run/<model>/<trigger|answers>/<case>.<n>.request.json` (system, user, schema) for each model of the matrix (`claude-opus-5-5-low`, `claude-sonnet-5-5-low`, `codex-gpt`; `--models` picks others), one trigger run per case and two answers runs per answers case (a case with `mustMention`, `mustNotMention` or a `behaviour`). Any executor can write `<case>.<n>.answer.txt` beside each request; `exec` is the local one. It calls `claude -p` and `codex exec` in empty temporary directories with no user settings, CLAUDE.md, skills, tools, MCP servers, AGENTS.md or memories (the Claude run uses `--setting-sources ""`, `--disable-slash-commands`, `--tools ""`; the Codex run a temporary `CODEX_HOME` holding only the auth link, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`), and records the models it saw in `run/<model>/executor.json`. The Codex run keeps the CLI's own default model and effort.

`score` reads the answers, runs the checks and applies the pass bar. `--against <dir>` takes a second run made from `main`'s skills; `--touched a,b` limits the per-skill floors; `--new-cases` names the cases that must pass everywhere; `--report` prints the Markdown Eval report. It exits 1 when the bar fails.

- **No regression**: no case that passed on `main` fails now, per model. A trigger case passes when every expected skill is picked and no `avoid` skill is; an answers case passes when its answer invents no API name (as defined below), mentions every `mustMention` name, none of the `mustNotMention` ones, and shows its `behaviour`.
- **New cases** pass on every model.
- **Floors** for each touched skill: trigger recall at least 0.8 and precision at least 0.7 (0.1 less on Sonnet), no invented API name in its answers cases (an import that `verify` cannot resolve: a missing package, subpath or export; API-shaped names an answer uses without importing them are listed as unverified, because they also catch the user's own identifiers and tool names), and the full-corpus recall and precision drop at most 2 points.
- **Noise**: a trigger case runs once; an answers case runs twice and both runs must pass.

`prepare --no-skills --modes answers` prepares the same answers cases with no skill loaded; `evals lift <with-dir> <without-dir>` then prints each skill's pass rate with and without it, per model, and the lift.

### Trigger eval

```bash
npx -y github:AntelopeJS/agent-skills evals --project .                       # deterministic baseline
npx -y github:AntelopeJS/agent-skills evals --project . --backend anthropic   # ask a model through the API
npx -y github:AntelopeJS/agent-skills evals --backend openai --dry-run        # print the prompt, call nothing
```

For each case it asks which skills would be loaded, then prints recall (expected skills picked) and precision (picks that were expected or acceptable) per case, per question style and overall. `--min-recall` and `--min-precision` make it exit 1 under a threshold.

- **`--backend baseline`** (default) needs no key: it scores each skill by the overlap between the prompt's terms and the skill's name and description. It cannot read intent; it goes red when a description stops carrying the terms users type, which is what CI watches.
- **`--backend anthropic`** sends the model only the skills' names and descriptions, as a coding agent sees them before loading one, and reads its picks as structured output. It uses `ANTHROPIC_API_KEY` and `$EVAL_MODEL` (default `claude-opus-5-5`, or `--model`); without a key it prints a notice and exits 0.
- **`--backend openai`** does the same through the OpenAI Responses API with `OPENAI_API_KEY` and `$EVAL_OPENAI_MODEL` (default `gpt-6.1-sol`).
- **`--backend <module.mjs>`** plugs any other model: the module exports `complete({ system, user, schema, effort, maxTokens })` returning the reply text.

### Answer-quality eval

```bash
npx -y github:AntelopeJS/agent-skills evals answers --project . --out answers/
```

The model answers each prompt with the case's expected skills loaded in full; `verify` then counts the API names it invented. The report adds the expected names the answer left out, the forbidden ones it used, and whether it asked first when it had to. `--max-invented` sets the failing rate. It needs a key (`--backend anthropic` or `openai`) and is skipped without one.

### Seeded-break eval

```bash
npx -y github:AntelopeJS/agent-skills evals seeded --repo ../antelopejs --min-catch 1.0 --min-door-catch 1.0 --out seeded-run
```

A verification skill (`.agents/skills/verify-<repo>/`) is Trusted only if it catches every bug planted in it. This eval measures that with the agent that will use the skill. The checkout supplies the cases:

| Case          | Patch                                                                         | The headless verifier must                                                                                             |
| ------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `break-<f>`   | `seeded-breaks/<feature>.patch`                                               | return FAIL naming the feature                                                                                         |
| `door-<kind>` | `seeded-doors/<kind>.patch`                                                   | name the kind in its One-way doors section (the door scan the skill defines)                                           |
| `control`     | none, the unpatched head                                                      | not return FAIL: a false alarm fails the run (PASS, or PASS+NOTES for an empty diff)                                   |
| `touched-<f>` | none, a blank line appended to the files of `<f>`'s patch (`--modes touched`) | not return FAIL: the feature's journeys run on correct code, which shows what a catch of the break is measured against |

For each case the eval builds a scratch checkout, runs `claude -p` in it and reads the verdict the agent returns as structured output (`result`, `failedFeatures`, `notRun`, `doors`, `summary`). The prompt names the skill and the base commit and nothing about the change; the agent finds the feature the way a verifier does, through the skill's own diff-to-feature command.

- **Scratch checkout.** A fresh single-commit repository of the checkout's tracked files at `--ref` (default `HEAD`), with `seeded-breaks/` and `seeded-doors/` removed, so the verifier can read neither the patches nor their history. `origin/main` points at the base commit, the diff base the skills default to; `origin` keeps the checkout's URL (verdict rendering reads it) with its push URL disabled. `--setup` runs between the base commit and the patch (default `pnpm install --frozen-lockfile --prefer-offline --ignore-scripts`); the patch becomes the one commit on top.
- **Isolation.** The agent runs in its own process group with a temporary `HOME`, a temporary Claude config directory holding only a link to the login, and an allowlisted environment: no `GH_*`, `GITHUB_*`, `SSH_*` or other token reaches it, and `--pass-env` adds names. Settings, plugins, MCP servers and slash commands are off. Its tools are `Bash`, `Read`, `Grep` and `Glob`. The prompt forbids publishing; with no credential and no push URL nothing could be posted. The XDG cache stays the caller's, so a warm pnpm store and the skill's base builds are reused. The agent's `TMPDIR` is private to the case, and `DMS_CONTROL_RUNS` points into it, so every run a harness starts lives under one folder. When the agent ends (or a timeout kills its process group), the eval runs the harness's own stop command for each of those runs (`--teardown`; by default `dms-control down` for `verify-dms` and `verify-ajs clean` for `verify-antelopejs`), lists any process of the case that is still alive, reports it in `result.json` and fails the run, and removes the case's folders. It never kills a leftover itself.
- **Scoring.** A break is caught when the verdict is FAIL, `failedFeatures` names the feature and none of the feature's journeys is in `notRun` (the required journeys that did not run or finish): a FAIL for a run that could not start proves nothing. With `--modes breaks,touched` the report adds the catch rate over the breaks whose touched twin does not FAIL, and lists the breaks whose twin FAILs too: on a feature that already fails on the head (known findings) a FAIL naming it cannot tell the break from them, the case V1's own `seeded` handles by excluding journeys that fail in the control. A door is caught when `doors` (the kinds of the One-way doors rows, false positives excluded) names the kind, whatever the result. A case with no verdict (timeout, budget, setup or CLI failure) is an error and counts as missed. The report prints the catch rate of the breaks and the door catch rate; `--min-catch` and `--min-door-catch` exit 1 under a ratio, and a false alarm on `control` fails the run whatever the gates, and `--min-clean` gates the `touched` cases the same way (without it they are only reported: a feature with known findings fails its verdict by the skill's own rule whenever a diff touches it).
- **Concurrency and cost.** `--jobs` (default 3) cases at once, `--timeout` seconds per case (default 1800), `--max-budget` dollars per case (default 5), `--resume` to rerun only the cases of `--out` that errored or are missing, `--only break-x,door-y` to iterate on a few cases. Each case writes `<out>/<id>/result.json` with the verdict, wall time, turns, tokens and dollars; `summary.json` and `report.md` sum them up. `--keep-scratch` keeps the checkouts.
- **Runtime.** `claude -p` with `--model claude-sonnet-5-5 --effort medium`, because it takes a tool allowlist, a JSON schema for the final answer, a dollar cap and a config directory switch, and reports tokens, turns and dollars per call. `codex exec` has an output schema and a sandbox but no cost cap and no per-call dollars. Sonnet was enough. Measured on the 37 cases of `verify-antelopejs` (2026-10-29, `claude` 2.1.312): $0.07 per case on average ($0.06 to $0.13, $2.69 for all 37), a median of 7 turns (3 to 12), about 75,000 input tokens of which 86% were cache reads, 1,700 output tokens, and a median of 0.8 minutes of wall time (0.4 to 19 on a busy machine). A case that needs a long journey, such as `project-dev`, takes longer, not more tokens.

The verifier runs with the caller's `PATH`, so the tools the skill needs (the pnpm its `packageManager` names, Docker, Node) must resolve there. `--cache-home` gives it a dedicated XDG cache instead of the caller's, which keeps other sessions out of a skill's warm store; run one case first (`--only control`) so the cache is warm before three cases share it, then `--resume`.

### `verify`

```bash
npx -y github:AntelopeJS/agent-skills verify answer.md
git diff main | npx -y github:AntelopeJS/agent-skills verify -
```

It extracts the API names a Markdown answer relies on (imports, code fences, inline code) or the imports a unified diff adds, then resolves each module specifier to the `.d.ts` of the installed package: its `exports` map (conditions and `*` patterns) or `types` field, following `export *` chains. Interface packages that are not installed are fetched through the contract resolver (`--offline` prevents it). It reports names a module does not export, subpaths a package does not expose, `@antelopejs` packages that do not exist, and, in answers, unimported API-shaped names (`KpiCard`, `@RegisterPage`, `new Foo`) that no installed `@antelopejs` package exports. It exits 1 when it finds one. Prose claims and misused real names pass through.

### In CI

`.github/workflows/ci.yml` runs the tests, the plugin layout check (`pnpm check:plugin`), the case-file check (`pnpm evals:check`) and the baseline trigger eval (`pnpm evals:baseline`, against the skills of the `--published` packages) on every push and pull request. CI holds no secret and calls no model. Packages get the same two checks from the reusable Node CI workflow of `AntelopeJS/.github` (`skill-eval-offline`) when `skills/**` changes, with the pull request's package as a workspace override of the published corpus. The model-backed run is the `antelopejs:eval-skills` skill, started by the maintainer's Bots or by an explicit ask.

### Background

The evals and `verify` come from [AntelopeJS/docs-assistant](https://github.com/AntelopeJS/docs-assistant), a retrieval experiment over the AntelopeJS docs whose benchmark showed a small model inventing most of the API names it cited without the docs, and none with them. Three of its measured decisions carry over: no fixed similarity threshold (relevance scores of right and wrong passages overlapped, so judging relevance is left to the model, here the trigger eval); sections merged into chunks of about 250 words (truncated passages hurt more than blurred ones, which is also why skills load whole); and query rewriting rejected (rewritten casual questions scored higher but drifted off topic and lost recall, hence the casual variants in the dataset, scored as typed). Its 24 framework questions, translated to English, are the first cases of the dataset, and its `verify`, which only searched backticked names in the indexed docs, became the `.d.ts`-based checker above.

## Development

```bash
pnpm test                         # node:test suites (no install needed)
pnpm evals:baseline               # trigger eval against the published skills, as CI runs it
pnpm evals:check                  # case files valid, rubric suites well formed
pnpm check:plugin                 # the plugin loads the same way in Claude Code and Codex
claude plugin validate .          # Claude Code manifests, skills, hooks
claude --plugin-dir .             # load this checkout in a Claude Code session
codex plugin marketplace add .    # register this checkout as a Codex marketplace
```

Bump `version` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `package.json` together on every release: installed copies only update when it changes.

## License

[Apache-2.0](./LICENSE)
