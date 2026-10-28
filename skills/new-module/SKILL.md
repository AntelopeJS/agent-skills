---
name: new-module
description: Scaffold a new AntelopeJS module and wire its interface dependencies. Use when the person wants to create a module with ajs module init.
argument-hint: <path> [interfaces to import]
allowed-tools: Bash(ajs:*), Bash(node:*), Bash(pnpm:*)
---

Help the person scaffold a new AntelopeJS module. The request gives the module's path and, optionally, the interfaces it imports; if it gives no path, ask for one.

Follow the **ajs-consume-interface** and **ajs-cli** skills (synced from `@antelopejs/core`). The interface resolver is `scripts/resolve-interface.mjs` at the plugin root, two levels above the directory holding this file. Steps:

1. Scaffold with `ajs module init <path>`. Your shell has no terminal, so answer every question with a flag or the command exits with code `2`: `-t <template>` (ask the person when unsure; `ajs module init --help` shows the flags), `--interfaces a,b` for the interfaces they named, `--pm pnpm`, and `--git-init` or `--no-git-init`.
2. For each interface the module should consume, confirm it exists and inspect its surface so you import the right symbols:
   `node "<skill-dir>/../../scripts/resolve-interface.mjs" show <name>`
3. Add each consumed interface as a dependency (`pnpm add @antelopejs/interface-<name>`); if the module _provides_ an interface, list its package under `antelopeJs.implements` in `package.json`.
4. From the project, add the module to `antelope.config.ts` if it is not there yet (`ajs project modules add <path> --mode local`), then run `ajs project modules install` to add a provider module for every interface no loaded module implements (`install` does that resolution, not `add`).

Confirm the target path with the person before running `ajs module init` if anything already exists there. Use pnpm for any package operations.
