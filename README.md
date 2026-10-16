# AntelopeJS agent skills

Knowledge and tools for building with [AntelopeJS](https://github.com/AntelopeJS) — the Node.js framework where a tight core + `ajs` CLI orchestrate modules that communicate **only** through versioned *interface* contracts — and for the AntelopeJS DMS, whose skills ship inside its packages and are synced into your project.

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

Or open `/plugins` in Codex (or the Plugins directory of the desktop app) after the first command, and install `antelopejs` from the **AntelopeJS** marketplace. Codex loads the plugin's skills (`antelopejs:antelopejs`, `antelopejs:ajs-*`) from then on.

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

`list` shows what would be synced, `--target claude|codex` restricts the sync to one directory, and `interface` runs the contract resolver (`npx -y github:AntelopeJS/agent-skills interface show database`).

## What you get

| Kind | Name | Use |
| --- | --- | --- |
| Skill | `antelopejs` | Framework mental model and router; the agent loads it in any AntelopeJS project |
| Skill | `ajs-consume-interface` | Import, call, or implement an interface; unresolved and optional interfaces; provider bindings |
| Skill | `ajs-author-interface` | Author and version an interface package |
| Skill | `ajs-cli` | The `ajs` CLI and its plugins; `ajs dms …` is left to the `dms-frontend` skill |
| Command (Claude Code) | `/antelopejs:interface <name> [subpath]` | Look up an interface contract |
| Command (Claude Code) | `/antelopejs:new-module <path>` | Scaffold a module and wire its interfaces |
| Command (Claude Code) | `/antelopejs:skills` | List the skills synced from the project's packages and where each comes from |
| Command (Claude Code) | `/antelopejs:sync-skills` | Sync those skills now |
| Hooks | `SessionStart`, `PostToolUse` (Bash) | Run the skill sync automatically (Claude Code; Codex desktop once trusted) |

## What syncs, and when

Packages ship their own skills: a package declares `antelopeJs.skills` in its `package.json` (directories whose subdirectories each hold a `SKILL.md`). The sync links every such skill as `<package-short-name>--<skill>` into the open project's `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex):

- **When**: through the hooks, at session start and after every Bash command (so `pnpm install`, `ajs project dev`, or `ajs project modules add` that bring new packages are picked up); otherwise when you run the sync command. Claude Code loads the new skills in the running session; if `.claude/skills/` did not exist when the session started, run `/reload-skills` once. Codex detects skill changes on its own; restart it if a skill does not appear.
- **Where it looks**, first hit per package wins:
  1. the **workspace**: the current package, its parents up to the repository root, and the packages listed in that root's `pnpm-workspace.yaml` or `package.json` `workspaces` (source checkouts and module playgrounds);
  2. **`node_modules`** of the project and of the workspace root (pnpm's symlinks into `.pnpm` included; the link goes through `node_modules/<pkg>` so it survives version bumps);
  3. **`.antelope/cache`**, where `ajs` downloads the modules declared in `antelope.config.ts` on `ajs project dev`, `build`, or `modules add`.
- **Which projects**: a directory holding `antelope.config.*`, or an app whose `package.json` depends on `@antelopejs/core` (an embedded runtime, like the AdonisJS DMS template). Anywhere else the sync does nothing.
- **Safety**: only the entries the sync created are touched. Each skills directory tracks them in its own `.ajs-managed.json` and lists them in a generated `.gitignore`, so your repository stays clean; a skill of yours with the same entry name is skipped, never overwritten; entries whose package disappeared are removed.

In a **DMS project** this brings the DMS suite: `dms` (the DMS router, start there), `dms-project`, `dms-module`, `dms-pages`, `dms-auth` and `dms-best-practices` from `@antelopejs/dms`, `dms-frontend` from `@antelopejs/dms-frontend`, plus one skill per installed `dms-*` module. Run `/antelopejs:skills` (or `npx -y github:AntelopeJS/agent-skills list`) to see them; the [skill catalog](https://dms.antelopejs.com/docs/ai-and-claude-code/skill-catalog) lists the whole suite, the package that ships each skill and when it triggers.

**dms-ai** (the DMS AI assistant) needs none of this: it loads the skills of every loaded module by itself. The plugin is for the coding agent working on the project's code.

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
| "Not an AntelopeJS project" | Run the agent (or the sync) in the directory holding `antelope.config.*` (or the app depending on `@antelopejs/core`), not in a parent folder. |
| A synced skill does not show up | Claude Code: run `/reload-skills`; `.claude/skills/` did not exist when the session started. Codex: restart it. |
| An entry is reported `skipped` | A file or folder of yours already uses that name in the skills directory; rename or remove it. |
| Hooks seem not to run | Claude Code: check `claude plugin list` shows the plugin enabled; `node` must be on `PATH`. Codex: trust the hooks in `/hooks`, or run the sync command yourself. |

## Design: three layers of knowledge

AntelopeJS's own architecture dictates how the knowledge is organized. The stable core is hand-authored; the extensive, versioned interface set is resolved on demand from its source of truth so it never goes stale; product knowledge (the DMS, its modules) ships with the packages themselves.

| Layer | What | Mechanism |
| --- | --- | --- |
| **1. Concepts** | The mental model: core, CLI, modules, interfaces-as-versioned-contracts | `antelopejs` router skill |
| **2. Workflows** | Consume an interface, author/version a contract, drive the CLI | `ajs-consume-interface`, `ajs-author-interface`, `ajs-cli` skills + slash commands |
| **3. Contracts** | The actual interface APIs, per name@version | `scripts/resolve-interface.mjs` — reads the `@antelopejs/interface-*` packages live |
| **Products** | DMS, dms-* modules, interface packages | Skills shipped in each package, synced by `scripts/sync-skills.mjs` |

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
  skills/
    antelopejs/            # Layer 1 — concepts + router
    ajs-consume-interface/ # Layer 2 — build modules ON the framework
    ajs-author-interface/  # Layer 2 — author & version interfaces
    ajs-cli/               # Layer 2 — the ajs CLI
  commands/                # Claude Code slash commands
    interface.md           # /antelopejs:interface <name> [subpath]
    new-module.md          # /antelopejs:new-module <path>
    skills.md              # /antelopejs:skills
    sync-skills.md         # /antelopejs:sync-skills
  hooks/
    hooks.json             # Claude Code: skill sync into .claude/skills (SessionStart + after Bash)
    codex-hooks.json       # Codex: skill sync into .agents/skills
  bin/
    agent-skills.mjs       # npx entry: sync, list, interface
  scripts/
    resolve-interface.mjs  # Layer 3 — live contract resolver
    sync-skills.mjs        # syncs package-shipped skills into .claude/skills and .agents/skills
  test/                    # node:test suites for both scripts
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

## Development

```bash
pnpm test                         # node:test suites for both scripts (no install needed)
claude plugin validate .          # Claude Code manifests, skills, commands, hooks
claude --plugin-dir .             # load this checkout in a Claude Code session
codex plugin marketplace add .    # register this checkout as a Codex marketplace
```

Bump `version` in `.claude-plugin/plugin.json`, `plugin.json` and `package.json` together on every release: installed copies only update when it changes.
