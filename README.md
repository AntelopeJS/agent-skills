<div align="center">
  <img src="./.github/assets/logo.png" alt="AntelopeJS logo" width="88">
  <h1>AntelopeJS agent skills</h1>
  <p><strong>The AntelopeJS and DMS skills, synced into Claude Code and Codex.</strong></p>

<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/ai-and-claude-code/overview"><img alt="Docs" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

</div>

Tools for coding agents building with [AntelopeJS](https://github.com/AntelopeJS) — the Node.js framework where a tight core + `ajs` CLI orchestrate modules that communicate **only** through versioned *interface* contracts — and with the AntelopeJS DMS. Every skill ships inside an npm package (the framework skills in `@antelopejs/core`, the DMS suite in `@antelopejs/dms`, one per module or interface); this plugin syncs them into your project, resolves interface contracts live, and adds a few commands.

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

Sync the project's package-shipped skills into `.agents/skills/`, where Codex discovers them, from the project root:

```bash
npx -y github:AntelopeJS/agent-skills sync --target codex
```

Run it again after installing or upgrading packages. The plugin also declares the same sync hooks as for Claude Code (`hooks/codex-hooks.json`), but Codex runs plugin hooks only for plugins installed in the desktop app, and only once you trust them in `/hooks`; in the Codex CLI, rely on the command above.

### Without a plugin

The sync needs only Node.js. From a project root, this links the package-shipped skills into both `.claude/skills/` and `.agents/skills/`:

```bash
npx -y github:AntelopeJS/agent-skills sync
```

`list` shows what would be synced, `--target claude|codex` restricts the sync to one directory, `interface` runs the contract resolver (`npx -y github:AntelopeJS/agent-skills interface show database`), and `verify` / `evals` check answers and skills (see [Evaluating the skills](#evaluating-the-skills)).

## What you get

| Kind | Name | Use |
| --- | --- | --- |
| Command (Claude Code) | `/antelopejs:interface <name> [subpath]` | Look up an interface contract |
| Command (Claude Code) | `/antelopejs:new-module <path>` | Scaffold a module and wire its interfaces |
| Command (Claude Code) | `/antelopejs:skills` | List the skills synced from the project's packages and where each comes from |
| Command (Claude Code) | `/antelopejs:sync-skills` | Sync those skills now |
| Hooks | `SessionStart`, `PostToolUse` (Bash) | Run the skill sync automatically (Claude Code; Codex desktop once trusted) |
| Script | `scripts/resolve-interface.mjs` | The interface contract resolver, also run as `npx -y github:AntelopeJS/agent-skills interface …` |
| CLI | `verify`, `evals` | Report invented API names in an answer or a diff; score which skills a prompt triggers |

The plugin carries no skill of its own. The framework skills — `antelopejs` (mental model and router), `ajs-cli`, `ajs-consume-interface` and `ajs-author-interface` — ship with `@antelopejs/core` and are synced like any package skill, as `core--<skill>`. They follow the core version the project installs.

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

Every AntelopeJS project gets the framework skills this way (`core--antelopejs`, `core--ajs-cli`, `core--ajs-consume-interface`, `core--ajs-author-interface` from `@antelopejs/core`, a dependency of every project the sync acts on). In a **DMS project** it also brings the DMS suite: `dms` (the DMS router, start there), `dms-project`, `dms-module`, `dms-pages`, `dms-auth` and `dms-best-practices` from `@antelopejs/dms`, `dms-frontend` from `@antelopejs/dms-frontend`, plus one skill per installed `dms-*` module. Run `/antelopejs:skills` (or `npx -y github:AntelopeJS/agent-skills list`) to see them; the [skill catalog](https://dms.antelopejs.com/docs/ai-and-claude-code/skill-catalog) lists the whole suite, the package that ships each skill and when it triggers.

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

Installed copies update when `version` changes in `.claude-plugin/plugin.json` and `plugin.json`, so bump both on every release. `npx -y github:AntelopeJS/agent-skills` always runs the latest commit of the default branch.

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

| Symptom | Fix |
| --- | --- |
| The Claude Code project settings do not prompt | The folder is not trusted yet: restart Claude Code in it and accept the trust dialog. In `-p` runs the entries apply only in folders trusted interactively before. |
| No DMS skills in `/antelopejs:skills` or `list` | The packages are not installed: run `pnpm install`; modules declared in `antelope.config.ts` arrive in `.antelope/cache` on the first `ajs project dev`. Then sync again. |
| No `core--*` skills | The installed `@antelopejs/core` predates the framework skills: upgrade it (`pnpm add @antelopejs/core@latest`), then sync again. |
| "Not an AntelopeJS project" | Run the agent (or the sync) in the directory holding `antelope.config.*` (or the app depending on `@antelopejs/core`), not in a parent folder. |
| A synced skill does not show up | Claude Code: run `/reload-skills`; `.claude/skills/` did not exist when the session started. Codex: restart it. |
| An entry is reported `skipped` | A file or folder of yours already uses that name in the skills directory; rename or remove it. |
| Hooks seem not to run | Claude Code: check `claude plugin list` shows the plugin enabled; `node` must be on `PATH`. Codex: trust the hooks in `/hooks`, or run the sync command yourself. |

## Design: three layers of knowledge

AntelopeJS's own architecture dictates how the knowledge is organized. The stable core is hand-authored; the extensive, versioned interface set is resolved on demand from its source of truth so it never goes stale; product knowledge (the DMS, its modules) ships with the packages themselves.

| Layer | What | Mechanism |
| --- | --- | --- |
| **1. Concepts** | The mental model: core, CLI, modules, interfaces-as-versioned-contracts | `antelopejs` router skill, shipped by `@antelopejs/core` |
| **2. Workflows** | Consume an interface, author/version a contract, drive the CLI | `ajs-consume-interface`, `ajs-author-interface`, `ajs-cli` skills, shipped by `@antelopejs/core`, + slash commands |
| **3. Contracts** | The actual interface APIs, per name@version | `scripts/resolve-interface.mjs` — reads the `@antelopejs/interface-*` packages live |
| **Products** | DMS, dms-* modules, interface packages | Skills shipped in each package |

Every skill lives in the package whose version it describes and reaches the agent through `scripts/sync-skills.mjs` (or dms-ai's own loader); the plugin keeps only what no package can carry: the sync, the resolver, and the commands.

Skills are split by **intent**, not audience: a framework user asking "how do I import the database interface" hits `ajs-consume-interface`; a core dev asking "how do I version this contract" hits `ajs-author-interface`. The router skill sends each to the right place and keeps context lean (progressive disclosure).

## Layout

```
agent-skills/
  .claude-plugin/
    plugin.json            # Claude Code manifest
    marketplace.json       # Claude Code marketplace (this repo)
  plugin.json              # portable manifest read by Codex (hooks under extensions.com.openai)
  .agents/plugins/
    marketplace.json       # Codex marketplace (this repo)
  commands/                # Claude Code slash commands
    interface.md           # /antelopejs:interface <name> [subpath]
    new-module.md          # /antelopejs:new-module <path>
    skills.md              # /antelopejs:skills
    sync-skills.md         # /antelopejs:sync-skills
  hooks/
    hooks.json             # Claude Code: skill sync into .claude/skills (SessionStart + after Bash)
    codex-hooks.json       # Codex: skill sync into .agents/skills
  bin/
    agent-skills.mjs       # npx entry: sync, list, interface, verify, evals
  scripts/
    resolve-interface.mjs  # Layer 3 — live contract resolver
    sync-skills.mjs        # syncs package-shipped skills into .claude/skills and .agents/skills
    verify.mjs             # API names of an answer or diff vs the installed .d.ts
    evals.mjs              # trigger and answer-quality evals
    lib/                   # corpus loader, dataset schema, baseline, scoring, model backend
  evals/
    cases.json             # the eval dataset
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
`npx -y github:AntelopeJS/agent-skills list` (or `/antelopejs:skills`) in a consuming project to
check what it picks up.

## Evaluating the skills

A skill only helps when the agent loads it, and a loaded skill only helps when the answer it produces uses real APIs. Two evals and one checker measure both, over the dataset in [`evals/cases.json`](evals/cases.json).

### The dataset

Each case is a user prompt, the skills an agent should load for it (`expect.skills`), the ones it may load without penalty (`expect.acceptable`), and optionally API names the answer must or must not mention and an expected behaviour (`asks-first`: ask the user before writing code, as `dms-best-practices` requires before leaving DMS blocks). Cases cover the framework (each question in a well-formed and a casual variant), DMS page building, permissions, dev servers, the frontend CLI and deployment, the `dms-*` modules, dms-ai, and installing the skills. `scripts/lib/dataset.mjs` is the schema; `pnpm test` rejects an invalid dataset.

### The corpus

The skills an eval runs against, by name and description, read from their `SKILL.md`:

| Option | Source |
| --- | --- |
| `--project <dir>` (default: the current directory) | what the sync finds there: workspace, `node_modules`, `.antelope/cache` |
| `--skills <dir>` (repeatable) | every `SKILL.md` under the directory, e.g. a checkout under review |
| `--packages <a,b>` / `--published` | the skills shipped by npm packages, fetched as tarballs; `--published` takes the list in `evals/packages.json` |

When two sources ship a skill of the same name, the first wins, in that order. An expected skill missing from the corpus is left out of the score, and a case with none left is reported `skipped`, so the evals keep working while skills move between packages.

### Trigger eval

```bash
npx -y github:AntelopeJS/agent-skills evals --project .                       # deterministic baseline
npx -y github:AntelopeJS/agent-skills evals --project . --backend anthropic   # ask a model
npx -y github:AntelopeJS/agent-skills evals --backend anthropic --dry-run     # print the prompt, call nothing
```

For each case it asks which skills would be loaded, then prints recall (expected skills picked) and precision (picks that were expected or acceptable) per case, per question style and overall. `--min-recall` and `--min-precision` make it exit 1 under a threshold.

- **`--backend baseline`** (default) needs no key: it scores each skill by the overlap between the prompt's terms and the skill's name and description. It cannot read intent; it goes red when a description stops carrying the terms users type, which is what CI watches.
- **`--backend anthropic`** sends the model only the skills' names and descriptions, as a coding agent sees them before loading one, and reads its picks as structured output. It uses `ANTHROPIC_API_KEY` and `$EVAL_MODEL` (default `claude-opus-5-5`, or `--model`); without a key it prints a notice and exits 0.
- **`--backend <module.mjs>`** plugs any other model: the module exports `complete({ system, user, schema, effort, maxTokens })` returning the reply text.

### Answer-quality eval

```bash
npx -y github:AntelopeJS/agent-skills evals answers --project . --out answers/
```

The model answers each prompt with the case's expected skills loaded in full; `verify` then counts the API names it invented. The report adds the expected names the answer left out, the forbidden ones it used, and whether it asked first when it had to. `--max-invented` sets the failing rate. It needs a key and is skipped without one.

### `verify`

```bash
npx -y github:AntelopeJS/agent-skills verify answer.md
git diff main | npx -y github:AntelopeJS/agent-skills verify -
```

It extracts the API names a Markdown answer relies on (imports, code fences, inline code) or the imports a unified diff adds, then resolves each module specifier to the `.d.ts` of the installed package: its `exports` map (conditions and `*` patterns) or `types` field, following `export *` chains. Interface packages that are not installed are fetched through the contract resolver (`--offline` prevents it). It reports names a module does not export, subpaths a package does not expose, `@antelopejs` packages that do not exist, and, in answers, unimported API-shaped names (`KpiCard`, `@RegisterPage`, `new Foo`) that no installed `@antelopejs` package exports. It exits 1 when it finds one. Prose claims and misused real names pass through.

### In CI

`.github/workflows/ci.yml` runs the tests and the baseline trigger eval (`pnpm evals:baseline`, against the skills of the `--published` packages) on every push and pull request. The model-backed trigger and answer evals run on manual dispatch and on pull requests that touch the evals, only when the `ANTHROPIC_API_KEY` secret exists.

### Background

The evals and `verify` come from [AntelopeJS/docs-assistant](https://github.com/AntelopeJS/docs-assistant), a retrieval experiment over the AntelopeJS docs whose benchmark showed a small model inventing most of the API names it cited without the docs, and none with them. Three of its measured decisions carry over: no fixed similarity threshold (relevance scores of right and wrong passages overlapped, so judging relevance is left to the model, here the trigger eval); sections merged into chunks of about 250 words (truncated passages hurt more than blurred ones, which is also why skills load whole); and query rewriting rejected (rewritten casual questions scored higher but drifted off topic and lost recall, hence the casual variants in the dataset, scored as typed). Its 24 framework questions, translated to English, are the first cases of the dataset, and its `verify`, which only searched backticked names in the indexed docs, became the `.d.ts`-based checker above.

## Development

```bash
pnpm test                         # node:test suites (no install needed)
pnpm evals:baseline               # trigger eval against the published skills, as CI runs it
claude plugin validate .          # Claude Code manifests, commands, hooks
claude --plugin-dir .             # load this checkout in a Claude Code session
codex plugin marketplace add .    # register this checkout as a Codex marketplace
```

Bump `version` in `.claude-plugin/plugin.json`, `plugin.json` and `package.json` together on every release: installed copies only update when it changes.
