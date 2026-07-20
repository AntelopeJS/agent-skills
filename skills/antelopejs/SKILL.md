---
name: antelopejs
description: Core mental model and router for AntelopeJS. Use whenever working in an AntelopeJS project or interface/module repo, or when the user mentions AntelopeJS. Routes to the ajs-consume-interface, ajs-author-interface, and ajs-cli skills, and to the interface contract resolver.
---

# AntelopeJS

AntelopeJS is a modular Node.js framework. Read this overview first, then jump to the specialized skill for the task.

## The model in one screen

- **Core + CLI (`ajs`)** — a small runtime that loads modules, wires their interfaces together, and manages the dev/build/start lifecycle. Users rarely edit the core; they run it via `ajs`.
- **Modules** — independent units of functionality. A module may import **interfaces**, never another module's files. Its *only* links to the rest of the project are the interface proxy points it attaches to — nothing else crosses the boundary.
- **Interfaces** — **versioned contracts**, published as `@antelopejs/interface-<name>` packages. An interface package contains the **proxy points** (`InterfaceFunction`, `EventProxy`, `RegisteringProxy`, …) that actually cross to the provider, the **types** that pass across — and often substantial **client-side code** built over those proxies. It is not just empty slots: the `database` interface is mostly chainable `Table`/`Query`/`Datum` classes that assemble a query *in the caller's process*, crossing the boundary only when `.run()` invokes the underlying `RunQuery` proxy. The contract is the package's whole TypeScript surface (`exports` subpaths + `.d.ts`), versioned with semver git tags. **Interfaces may depend on other interfaces** (e.g. `data-api` builds on `api`, `api-util`, `core`, `database`, and `database-decorators`) — that composition is allowed and normal. What's forbidden is modules reaching into each other.

The golden rule: **the only connections between a module and the rest of the project go through interface proxy points** — never a direct `import` of another module's file. Everything else follows from that.

### How a connection is made — and unmade

Every module-to-module link is built in exactly two steps:

1. **The interface defines proxy points.** `InterfaceFunction`/`EventProxy`/`RegisteringProxy` objects are empty attachment slots — and the *only* things that cross to the provider. (`InterfaceFunction` is a factory over the underlying `AsyncProxy` primitive; all four are exported by `@antelopejs/interface-core`.) The package may wrap them in classes and helpers that run consumer-side (like `Query.run()` calling `RunQuery`), but that code is not the boundary; the proxy is.
2. **The implementing module requires the interface and attaches its implementation onto those proxies** via `ImplementInterface`. Consumers require the same interface and call through the proxies; the proxy queues calls until an implementation is attached.

```ts
// 1. Interface package declares the proxy point (no behavior, just the slot)
export const GetUser = InterfaceFunction<(id: string) => User>();

// 2. Implementing module requires the interface and attaches onto it
import { ImplementInterface } from "@antelopejs/interface-core";
import * as UserInterface from "@antelopejs/interface-user";
ImplementInterface(UserInterface, { GetUser: (id) => db.find(id) });

// Consumer requires the same interface and calls through the proxy
const user = await GetUser("42");   // queued until an implementation attaches
```

Because every connection lives on a known proxy and nothing else crosses the boundary, the core can **detach and reattach a module's links freely** — that's exactly what makes a module safe to hot-reload (or unload) at runtime: tear down its proxy attachments, swap the code, reattach. A direct module-to-module `import` would be an invisible, non-detachable link and would break this — which is why it's forbidden.

**Caveat — what queues, and what's async.** The three proxy kinds behave differently before a provider attaches:

- `InterfaceFunction`/`AsyncProxy` calls **queue** and always return a Promise — nothing that returns a *value* from the provider can be synchronous. This rules out an interface function that *both* depends on a provider's state (e.g. its module config) *and* is callable synchronously at consumer load time; anything that needs a live implementation must be `await`ed.
- `RegisteringProxy.register` is a **synchronous** call that queues too: registrations made early are replayed when the provider attaches.
- `EventProxy.emit` is synchronous and does **not** queue — it reaches only the handlers registered at that moment; an emit before attach is simply not seen.

## Where to go next

| Task | Skill |
| --- | --- |
| Build a module / app *on* AntelopeJS, import & call an interface, resolve unresolved imports | **ajs-consume-interface** |
| Define a new interface, add/version a contract, decide a semver bump, ship breaking changes | **ajs-author-interface** |
| Run, build, scaffold, test via the CLI (`ajs project …`, `ajs module …`) | **ajs-cli** |

## Interface contract resolver (use this instead of guessing)

Contracts are versioned data, not memorized facts. Never invent an interface's methods — look them up:

```bash
# List interfaces published on npm (plus any installed locally)
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" list

# Inspect one: export subpaths, exported symbols, available versions
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" show database

# Print the full TSDoc'd contract for a subpath (the source of truth)
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" contract database query

# A specific published version, and the list of available versions
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" show database@<version>
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" versions database
```

The resolver reads contracts straight from the published `@antelopejs/interface-*` packages on
**npm** — no local checkout needed; it fetches and caches the package on demand. `<name>` accepts
`core`, `interface-core`, or `@antelopejs/interface-core`, optionally `@<version>` (default: the
`latest` dist-tag). Bare names resolve against the public scope plus any scope discovered from
the current project's dependencies (`@<scope>/interface-*` deps contribute their scope;
`AJS_INTERFACE_SCOPES` adds more). A locally-present copy (the project's `node_modules`,
`.antelope/cache`, or `$AJS_INTERFACES_DIR`) is used as an offline fast-path when available.
Flags: `--remote` (force a fresh npm fetch), `--offline` (local only). `npm` honours `.npmrc`,
so scopes served from private registries resolve too.

It also resolves **host-package interfaces** — interfaces exposed as subpaths of a host package
(a package whose `package.json` sets `antelopeJs.cms` or exports `./interfaces/<group>`
subpaths). Hosts are discovered from the current project (dependencies, `.antelope/cache`,
source checkouts under `AJS_CMS_DIR`/cwd; `AJS_CMS_PACKAGES` names extras). Use the
`<host-short-name>:<group>` shorthand, the full import path, or a bare group name, e.g.
`… show cms-host:cms-base`, `… contract cms-host:cms-base form`,
`… show @acme/cms-host/interfaces/cms-auth`, or `… show cms-base`.

Products built as a host package usually ship their own skills inside their packages: start a
project from the product's template, install the dependencies, and those skills sync into the
project automatically (see the package-shipped skills mechanism) — that is where the
product-specific mental model and workflows live.

When asked anything about a specific interface's API (what methods exist, a signature, which version has X), run `contract`/`show` and answer from the output — do not rely on training data, which goes stale as contracts version.

## Conventions in AntelopeJS repos

These repos enforce (see any repo's `AGENTS.md`): **pnpm only** (never npm/yarn), English-only identifiers, no `switch`/`case` (use maps), no comments — self-documenting code, TSDoc allowed on public APIs — no inline/anonymous types, no magic values, functions ≤ ~40 lines. Index files: `AGENTS.md` prefers `export * from './module'`, though existing barrels mostly use named re-exports — match the file you're in.
