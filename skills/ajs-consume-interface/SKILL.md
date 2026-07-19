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

**Package-shipped skills first, for installed interfaces.** Interface packages may ship their own skill (declared via `antelopeJs.skills`), which the plugin syncs automatically into the project's `.claude/skills/` as `<module>--<skill>`. For an interface that is already **installed**, prefer that skill plus the installed package's own `dist/*.d.ts` and `docs/` directory — that is exactly the version the project compiles against. Use the resolver for interfaces **not yet installed**, for discovering what exists (`list`), and for comparing versions (`versions`, `show <name>@<version>`).

**The one hard rule:** a module never imports another module's files — only interfaces. Every cross-module link is an attachment onto an interface proxy point, so the core can detach and reattach it on reload. If you're tempted to `import` something from a sibling module, the thing you need belongs in an interface instead.

## Importing an interface in a module

1. Add the interface package to the module's `dependencies` (`pnpm add @antelopejs/interface-<name>`). Consuming an interface is just depending on its package.
2. Import the symbols and call them, exactly as `contract`/`show` reported. `InterfaceFunction` calls made before a provider attaches are queued by the proxy layer, so no defensive "not ready yet" checks — but for the same reason every such call is **async**: `await` it, never read it as a synchronous value at module-load top level. (`RegisteringProxy.register` is synchronous and also queues; `EventProxy.emit` is synchronous and does *not* queue — an emit before attach reaches nobody.) Queuing assumes a provider *will* attach: a required dependency with no provider fails startup first (see *Resolving unresolved imports*); one that may legitimately lack a provider is an *optional* interface (see *Optional interfaces*).

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

An interface in a module's `dependencies` is **required**: if no loaded module provides it, the runtime aborts startup with `Unresolved interface dependencies: …` rather than running in a half-wired state. When `ajs` reports unresolved imports, a module needs an interface that no loaded module provides. Run:

```bash
ajs project modules install    # detects unresolved imports, lists providers, prompts you to pick one
```

`install` reads the registry manifest for each unresolved interface (which lists *all* implementing modules — you choose, there's no single default) and adds the chosen provider to `antelope.config`. (`ajs project modules add <modules...>` only adds modules you name explicitly; it does not resolve imports.) To see candidate providers for an interface:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" implementations <name>
```

## Optional interfaces

To consume an interface that may legitimately have no provider, declare its package under top-level **`optionalDependencies`** in `package.json` instead of `dependencies` (it's the standard npm field, a sibling of `dependencies` — not part of the `antelopeJs` block). Import and call it exactly the same way.

The difference is what happens when nothing provides it. A missing **required** dependency aborts startup; a missing **optional** one lets startup proceed and the core *stubs* the interface:

- **async calls reject** immediately — `await`ing a stubbed method throws `Interface '<name>' has no provider for this async method; the call was rejected. Load a module that implements it to enable this call.` It does **not** queue or hang.
- **registering proxies keep queuing** — `register` calls are retained and replay if a provider is loaded later; **event emits reach nobody** while stubbed. Neither throws.
- a one-time **warning** is logged at startup: `Optional interface '<name>' has no provider; async calls on it will reject, sync usage will no-op.`

**Detecting whether an optional interface is implemented:** there is no direct probe for a plain optional dependency. `GetInterfaceInstances(interfaceID)` (from `@antelopejs/interface-core`) returns the calling module's connection descriptors, but the core only wires connections for interfaces listed in `dependencies` or given an explicit `importOverrides` entry — for an interface declared only under `optionalDependencies` it returns `[]` even while a provider is loaded, so it is *not* a valid guard there. Two working approaches:

- `try/catch` the first `await` — the stub rejects deterministically with the message above; it never hangs.
- add an `importOverrides` entry for the consumer (see below): that creates a connection descriptor, making `GetInterfaceInstances(...).length > 0` a valid guard, and `GetInterfaceInstance(interfaceID, connectionID)` selects a specific provider when several implement the interface.

There is no state in which a call to a declared dependency stays pending forever: it's either connected, rejected (stubbed optional), or startup-blocked (unprovided required).

(A related case: an interface package whose own `package.json` sets `antelopeJs.standalone` self-hosts when no module implements it — same stubbing path, but treated as expected, so it's logged at trace level rather than warned. That's a property of the interface package, not of how you depend on it.)

## Wiring & overriding in antelope.config

Modules are declared in `antelope.config.ts` (authored with `defineConfig` from `@antelopejs/interface-core/config`): `modules: Record<string, string | AntelopeModuleConfig>` — a plain string is a version shorthand. Per-module knobs that matter when consuming interfaces:

- `importOverrides` — force a specific source/provider for an interface, either as a list of `{ interface, source, id }` entries or a `{ interface: source }` shorthand map; e.g. to bind a consumer to a particular implementation when several exist.
- `disabledExports` — stop a module from providing an interface it would otherwise export.
- `config` — module-specific configuration passed at load.

If two providers export the same interface, the binding is ambiguous — disambiguate with `importOverrides` rather than relying on load order.

## Pinning interface versions

Interfaces are semver-tagged, but there is **no runtime version negotiation**: the core wires consumer to provider purely by interface *package name*, and each module gets whatever version npm resolved for it. Version discipline lives entirely in your `dependencies` range. Check what a project resolves vs. what's available:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" versions <name>
```

A consumer should target a contract version it has actually been checked against; when bumping, re-run `contract` and diff the surface (see **ajs-author-interface** for the compatibility rules that govern those bumps).
