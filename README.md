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
antelopejs/
  .claude-plugin/plugin.json
  skills/
    antelopejs/            # Layer 1 — concepts + router
    ajs-consume-interface/ # Layer 2 — build modules ON the framework
    ajs-author-interface/  # Layer 2 — author & version interfaces
    ajs-cli/               # Layer 2 — the ajs CLI
  commands/
    interface.md           # /antelopejs:interface <name> [subpath]
    new-module.md          # /antelopejs:new-module <path>
  scripts/
    resolve-interface.mjs  # Layer 3 — live contract resolver
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
`@<version>` (default: the `latest` dist-tag).

**CMS interfaces too.** The AntelopeJS CMS exposes its interfaces as *subpaths* of a host
package rather than as standalone `@antelopejs/interface-*` packages. The resolver handles both:

```bash
node scripts/resolve-interface.mjs show cms:cms-base                 # shorthand for the CMS backend
node scripts/resolve-interface.mjs contract cms:cms-base form        # a part of the interface
node scripts/resolve-interface.mjs show @antelopejs-private/cms/interfaces/cms-auth     # full import path
node scripts/resolve-interface.mjs show @antelopejs-private/cms-automation/interfaces/cms-automation
node scripts/resolve-interface.mjs show cms-base                     # bare name (resolved against known CMS hosts)
```

`list` includes a CMS section. CMS host packages default to `@antelopejs-private/cms`; add more
with `AJS_CMS_PACKAGES` (comma-separated), and point `AJS_CMS_DIR` (colon-separated) at local
CMS source roots to scan (default: the current directory). Because resolution goes through
`npm`, the private `@antelopejs-private` registry is fetched per your `.npmrc`.

**Where it reads from.** The npm registry is the source of truth. A locally-present copy — the
open project's `node_modules/@antelopejs`, a checkout under `$AJS_INTERFACES_DIR`
(colon-separated), or a discovered CMS host package — is used as an **offline fast-path** when
present and no version is pinned, but is never required. Flags:
`--remote` forces a fresh npm fetch (skip the local copy), `--offline` forbids the network
(local only), `--json` for machine output. The tarball cache lives at
`~/.cache/ajs-interface-resolver` (override with `AJS_RESOLVER_CACHE`).

## Installing

Add the parent directory as a plugin marketplace, or symlink `antelopejs/` into your Claude Code plugins. The skills auto-trigger on AntelopeJS context; the commands are invoked explicitly.
