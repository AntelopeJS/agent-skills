# AntelopeJS plugin for Claude Code

Knowledge and tools for building with [AntelopeJS](https://github.com/AntelopeJS) — the Node.js framework where a tight core + `ajs` CLI orchestrate modules that communicate **only** through versioned *interface* contracts.

## Design: three layers of knowledge

AntelopeJS's own architecture dictates how the knowledge is organized. The stable core is hand-authored; the extensive, versioned interface set is resolved on demand from its source of truth so it never goes stale.

| Layer | What | Mechanism |
| --- | --- | --- |
| **1. Concepts** | The mental model: core, CLI, modules, interfaces-as-versioned-contracts | `antelopejs` router skill |
| **2. Workflows** | Consume an interface, author/version a contract, drive the CLI | `ajs-consume-interface`, `ajs-author-interface`, `ajs-cli` skills + slash commands |
| **3. Contracts** | The actual interface APIs, per name@version | `scripts/resolve-interface.mjs` — reads the `@antelopejs/interface-*` packages live |

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
    sync-skills.md         # /antelopejs:sync-skills
  hooks/
    hooks.json             # auto-runs the skill sync (SessionStart + after Bash)
  scripts/
    resolve-interface.mjs  # Layer 3 — live contract resolver
    sync-skills.mjs        # syncs package-shipped skills into .claude/skills/
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

**Host-package interfaces too.** Some packages (CMS-style) expose interfaces as *subpaths* of
a host package rather than as standalone interface packages — a package is recognized as a
host when its `package.json` sets `antelopeJs.cms` or exports `./interfaces/<group>` subpaths.
Hosts are discovered from the current project (its dependencies in `node_modules`, the CLI's
`.antelope/cache`, and a scan of `AJS_CMS_DIR`/the cwd for source checkouts); `AJS_CMS_PACKAGES`
(comma-separated) names extra hosts explicitly. The resolver handles both shapes:

```bash
node scripts/resolve-interface.mjs show cms-host:cms-base            # <host-short-name>:<group> shorthand
node scripts/resolve-interface.mjs contract cms-host:cms-base form   # a part of the interface
node scripts/resolve-interface.mjs show @acme/cms-host/interfaces/cms-auth   # full import path
node scripts/resolve-interface.mjs show cms-base                     # bare group name (discovered hosts)
```

`list` includes a host-interface section built from the discovered hosts.

**Where it reads from.** The npm registry is the source of truth. A locally-present copy — the
open project's `node_modules` and `.antelope/cache`, a checkout under `$AJS_INTERFACES_DIR`
(colon-separated), or a discovered host package — is used as an **offline fast-path** when
present and no version is pinned, but is never required. Flags:
`--remote` forces a fresh npm fetch (skip the local copy), `--offline` forbids the network
(local only), `--json` for machine output. The tarball cache lives at
`~/.cache/ajs-interface-resolver` (override with `AJS_RESOLVER_CACHE`).

## Package-shipped skills

Packages can ship Claude Code skills next to their code: declare `antelopeJs.skills` in the
package's `package.json` — an array of directories (relative to the package root) whose
subdirectories each contain a `SKILL.md`:

```jsonc
// package.json of any module or interface package
"antelopeJs": { "skills": ["./skills"] }
```

The plugin auto-syncs those skills into the open project's `.claude/skills/` via hooks — on
session start and after Bash commands (so a `pnpm install` / `ajs` run that changes
dependencies is picked up). `scripts/sync-skills.mjs` scans `node_modules` and
`.antelope/cache`, creates one relative symlink per skill
(`.claude/skills/<module>--<skill>`), and tracks its entries in
`.claude/skills/.ajs-managed.json` plus a scoped `.gitignore`, so your repo stays clean and
anything it didn't create is never touched. Outside an AntelopeJS project (no
`antelope.config.*`) it does nothing (and stays silent in hook mode). Manual
fallback: `/antelopejs:sync-skills`.

## Installing

This repo ships its own `marketplace.json`, so it can be added directly:

```
/plugin marketplace add AntelopeJS/claude-antelopejs   # or a local checkout path
/plugin install antelopejs@antelopejs
```

The skills auto-trigger on AntelopeJS context; the commands are invoked explicitly.
