---
description: Scaffold a new AntelopeJS module and wire its interface dependencies
argument-hint: <path> [interfaces to import]
allowed-tools: Bash(ajs:*), Bash(node:*), Bash(pnpm:*)
---

Help the user scaffold a new AntelopeJS module at `$ARGUMENTS`.

Follow the **ajs-consume-interface** and **ajs-cli** skills. Steps:

1. Scaffold with `ajs module init <path>` (it proposes interfaces to install). If the user named interfaces to import, plan to add them.
2. For each interface the module should consume, confirm it exists and inspect its surface so you import the right symbols:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" show <name>`
3. Add each consumed interface as a dependency (`pnpm add @antelopejs/interface-<name>`); if the module *provides* an interface, list its package under `antelopeJs.implements` in `package.json`. (Consumed interfaces are plain dependencies — there is no `antelopeJs.imports` field.)
4. Run `ajs project modules install` to resolve dependencies and surface/resolve any unresolved imports (`install` does the resolution, not `add`).

Confirm the target path with the user before running `ajs module init` if anything already exists there. Use pnpm for any package operations.
