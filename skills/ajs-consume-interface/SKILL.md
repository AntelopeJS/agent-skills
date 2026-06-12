---
name: ajs-consume-interface
description: Consuming or providing an interface from an AntelopeJS module. Use when writing module code that imports and calls an interface or implements one with ImplementInterface, or when interface imports fail to resolve.
---

# Consuming & providing interfaces

For the framework mental model, see the **antelopejs** skill. This skill is the consumer/provider workflow.

## Before writing any interface call: resolve the contract

Do not guess method names or signatures — they are versioned and change. Look them up:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" show <name>            # surface + versions
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" contract <name> [sub]  # full TSDoc'd contract
```

Each `import "@antelopejs/interface-<name>/<sub>"` line in the output is a literal import you can paste.

**The one hard rule:** a module never imports another module's files — only interfaces. Every cross-module link is an attachment onto an interface proxy point, so the core can detach and reattach it on reload. If you're tempted to `import` something from a sibling module, the thing you need belongs in an interface instead.

## Importing an interface in a module

1. Add the interface package to the module's `dependencies` (`pnpm add @antelopejs/interface-<name>`). Consuming an interface is just depending on its package.
2. Import the symbols and call them, exactly as `contract`/`show` reported. Calls made before a provider attaches are queued by the proxy layer, so you don't need defensive null checks for "not ready yet" — but for the same reason every proxy call is **async**: `await` it, never read it as a synchronous value at module-load top level.

```ts
import { Table } from "@antelopejs/interface-database/selection";
// ...use the contract exactly as `contract` reported it
```

A consumed interface only *resolves* at runtime if some loaded module in the project provides it — otherwise it's an unresolved import (see below).

## Providing (implementing) an interface

A module that *provides* an interface declares its package name under `antelopeJs.implements` in `package.json` and calls `ImplementInterface`:

```jsonc
// package.json
"antelopeJs": { "implements": ["@antelopejs/interface-database"] }
```

```ts
import { ImplementInterface } from "@antelopejs/interface-core";
import * as DBInterface from "@antelopejs/interface-database";

ImplementInterface(DBInterface, {
  // implement every InterfaceFunction the contract declares — check with `contract`
});
```

The proxy layer attaches the implementation on module load and detaches on unload/hot-reload — implement idempotently and clean up resources in the module's shutdown lifecycle.

## Resolving unresolved imports

When `ajs` reports unresolved imports, a module needs an interface that no loaded module provides. Run:

```bash
ajs project modules install    # detects unresolved imports, lists providers, prompts you to pick one
```

`install` reads the registry manifest for each unresolved interface (which lists *all* implementing modules — you choose, there's no single default) and adds the chosen provider to `antelope.config`. (`ajs project modules add <modules...>` only adds modules you name explicitly; it does not resolve imports.) To see candidate providers for an interface:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" implementations <name>
```

## Wiring & overriding in antelope.config

Modules are declared in `antelope.config.ts` (`modules: Record<string, …>`). Per-module knobs that matter when consuming interfaces:

- `importOverrides` — force a specific source/provider for an interface (`{ interface, source, id }`), e.g. to bind a consumer to a particular implementation when several exist.
- `disabledExports` — stop a module from providing an interface it would otherwise export.
- `config` — module-specific configuration passed at load.

If two providers export the same interface, the binding is ambiguous — disambiguate with `importOverrides` rather than relying on load order.

## Pinning interface versions

Interfaces are semver-tagged. Check what a project resolves vs. what's available:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" versions <name>
```

A consumer should target a contract version it has actually been checked against; when bumping, re-run `contract` and diff the surface (see **ajs-author-interface** for the compatibility rules that govern those bumps).
