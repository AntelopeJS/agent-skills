# AntelopeJS plugin for Claude Code

Knowledge and tools for building with [AntelopeJS](https://github.com/AntelopeJS) — the Node.js framework where a tight core + `ajs` CLI orchestrate modules that communicate **only** through versioned *interface* contracts — and for the AntelopeJS DMS, whose skills ship inside its packages and are synced into your project by this plugin.

## Install

> [!IMPORTANT]
> This repository is **internal** to the AntelopeJS organization today. Claude Code clones it with your own git credentials, so you need read access to `AntelopeJS/claude-antelopejs` on GitHub (an SSH key loaded in `ssh-agent`, or a stored HTTPS credential, e.g. `gh auth login` then `gh auth setup-git`). Without access, `marketplace add` fails with a clone error.

One command per step, from your shell:

```bash
claude plugin marketplace add AntelopeJS/claude-antelopejs
claude plugin install antelopejs@antelopejs
```

The same from inside a Claude Code session:

```
/plugin marketplace add AntelopeJS/claude-antelopejs
/plugin install antelopejs@antelopejs
```

`antelopejs@antelopejs` is the plugin `antelopejs` from the marketplace `antelopejs` (this repository). The install lands in your user scope, so every project sees it. Restart the session (or run `/reload-plugins`) to load it.

To install it for one repository only, so it is recorded in that repository's `.claude/settings.json`, add `--scope project` to both commands.

## What you get

| Kind | Name | Use |
| --- | --- | --- |
| Skill | `antelopejs` | Framework mental model and router; Claude loads it in any AntelopeJS project |
| Skill | `ajs-consume-interface` | Import, call, or implement an interface; unresolved and optional interfaces; provider bindings |
| Skill | `ajs-author-interface` | Author and version an interface package |
| Skill | `ajs-cli` | The `ajs` CLI and its plugins; `ajs dms …` is left to the `dms-frontend` skill |
| Command | `/antelopejs:interface <name> [subpath]` | Look up an interface contract |
| Command | `/antelopejs:new-module <path>` | Scaffold a module and wire its interfaces |
| Command | `/antelopejs:skills` | List the skills synced from the project's packages and where each comes from |
| Command | `/antelopejs:sync-skills` | Sync those skills now |
| Hooks | `SessionStart`, `PostToolUse` (Bash) | Run the skill sync automatically |

## What syncs automatically, and when

Packages ship their own skills: a package declares `antelopeJs.skills` in its `package.json` (directories whose subdirectories each hold a `SKILL.md`). The plugin links every such skill into the open project's `.claude/skills/` as `<package-short-name>--<skill>`:

- **When**: at session start, and after every Bash command (so `pnpm install`, `ajs project dev`, or `ajs project modules add` that bring new packages are picked up). Claude Code loads the new skills in the running session; if `.claude/skills/` did not exist when the session started, run `/reload-skills` once.
- **Where it looks**, first hit per package wins:
  1. the **workspace**: the current package, its parents up to the repository root, and the packages listed in that root's `pnpm-workspace.yaml` or `package.json` `workspaces` (source checkouts and module playgrounds);
  2. **`node_modules`** of the project and of the workspace root (pnpm's symlinks into `.pnpm` included; the link goes through `node_modules/<pkg>` so it survives version bumps);
  3. **`.antelope/cache`**, where `ajs` downloads the modules declared in `antelope.config.ts` on `ajs project dev`, `build`, or `modules add`.
- **Which projects**: a directory holding `antelope.config.*`, or an app whose `package.json` depends on `@antelopejs/core` (an embedded runtime, like the AdonisJS DMS template). Anywhere else the sync does nothing.
- **Safety**: only the entries the plugin created are touched. They are tracked in `.claude/skills/.ajs-managed.json` and listed in a generated `.claude/skills/.gitignore`, so your repository stays clean; a skill of yours with the same entry name is skipped, never overwritten; entries whose package disappeared are removed.

In a **DMS project** this brings the DMS suite: `dms` (the DMS router, start there), `dms-project`, `dms-module`, `dms-pages`, `dms-auth` and `dms-best-practices` from `@antelopejs/dms`, `dms-frontend` from `@antelopejs/dms-frontend`, plus one skill per installed `dms-*` module. Run `/antelopejs:skills` to see them; the [skill catalog](https://dms.antelopejs.com/docs/ai-and-claude-code/skill-catalog) lists the whole suite, the package that ships each skill and when it triggers.

**dms-ai** (the DMS AI assistant) needs none of this: it loads the skills of every loaded module by itself. The plugin is for Claude Code working on the project's code.

## Prompt every contributor to install it

Commit this `.claude/settings.json` in a project (the DMS templates ship it):

```json
{
  "extraKnownMarketplaces": {
    "antelopejs": {
      "source": {
        "source": "github",
        "repo": "AntelopeJS/claude-antelopejs"
      }
    }
  },
  "enabledPlugins": {
    "antelopejs@antelopejs": true
  }
}
```

When a contributor opens the project in Claude Code and accepts the workspace trust dialog, Claude Code registers the marketplace and enables the plugin; the `/plugin` menu shows it. `claude plugin marketplace add AntelopeJS/claude-antelopejs --scope project` followed by `claude plugin install antelopejs@antelopejs --scope project` writes the same file. Contributors still need read access to this repository.

## Update

```bash
claude plugin marketplace update antelopejs
claude plugin update antelopejs@antelopejs
```

In a session: `/plugin marketplace update antelopejs`, then restart. Updates arrive when `version` in `.claude-plugin/plugin.json` changes, so bump it on every release. To update in the background, open `/plugin` → **Marketplaces** → `antelopejs` → **Enable auto-update**.

The synced skills follow your packages, not the plugin: upgrade `@antelopejs/dms` or a module and the next sync points at the new version.

## Uninstall

```bash
claude plugin uninstall antelopejs@antelopejs
claude plugin marketplace remove antelopejs
```

Add `--scope project` to `uninstall` when it was installed for one repository, and remove the two keys from that repository's `.claude/settings.json`. To drop the synced skills from a project, delete the entries listed in `.claude/skills/.ajs-managed.json` along with that file and `.claude/skills/.gitignore`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `marketplace add` fails to clone | You lack read access to this internal repository, or git has no stored credential. Check with `git ls-remote https://github.com/AntelopeJS/claude-antelopejs`. Without a GitHub SSH key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`. |
| The project settings do not prompt | The folder is not trusted yet: restart Claude Code in it and accept the trust dialog. In `-p` runs the entries apply only in folders trusted interactively before. |
| No DMS skills in `/antelopejs:skills` | The packages are not installed: run `pnpm install`; modules declared in `antelope.config.ts` arrive in `.antelope/cache` on the first `ajs project dev`. Then `/antelopejs:sync-skills`. |
| "Not an AntelopeJS project" | Start Claude Code in the directory holding `antelope.config.*` (or the app depending on `@antelopejs/core`), not in a parent folder. |
| A synced skill does not show up | Run `/reload-skills`; `.claude/skills/` did not exist when the session started. |
| An entry is reported `skipped` | A file or folder of yours already uses that name in `.claude/skills/`; rename or remove it. |
| Hooks seem not to run | Check `claude plugin list` shows the plugin enabled; `node` must be on `PATH`. |

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
claude-antelopejs/
  .claude-plugin/
    plugin.json
    marketplace.json       # lets this repo be added directly as a marketplace
  skills/
    antelopejs/            # Layer 1 — concepts + router
    ajs-consume-interface/ # Layer 2 — build modules ON the framework
    ajs-author-interface/  # Layer 2 — author & version interfaces
    ajs-cli/               # Layer 2 — the ajs CLI
  commands/
    interface.md           # /antelopejs:interface <name> [subpath]
    new-module.md          # /antelopejs:new-module <path>
    skills.md              # /antelopejs:skills
    sync-skills.md         # /antelopejs:sync-skills
  hooks/
    hooks.json             # auto-runs the skill sync (SessionStart + after Bash)
  scripts/
    resolve-interface.mjs  # Layer 3 — live contract resolver
    sync-skills.mjs        # syncs package-shipped skills into .claude/skills/
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

Each `skills/<name>/SKILL.md` becomes `.claude/skills/<package-short-name>--<name>` in every
project that installs the package. Run `node scripts/sync-skills.mjs --list` (or
`/antelopejs:skills`) in a consuming project to check what it picks up.

## Development

```bash
pnpm test                         # node:test suites for both scripts (no install needed)
claude plugin validate .          # manifests, skills, commands, hooks
claude --plugin-dir .             # load this checkout in a session
```

Bump `version` in `.claude-plugin/plugin.json` on every release: installed copies only update when it changes.
