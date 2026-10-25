---
description: Scaffold a new AntelopeJS module and wire its interface dependencies
argument-hint: <path> [interfaces to import]
allowed-tools: Bash(ajs:*), Bash(node:*), Bash(pnpm:*)
---

Help the user scaffold a new AntelopeJS module at `$ARGUMENTS`.

Follow the **ajs-consume-interface** and **ajs-cli** skills (synced from `@antelopejs/core`). Steps:

1. Scaffold with `ajs module init <path>`. Your shell has no terminal, so answer every question with a flag or the command exits with code `2`: `-t <template>` (ask the user when unsure; `ajs module init --help` shows the flags), `--interfaces a,b` for the interfaces the user named, `--pm pnpm`, and `--git-init` or `--no-git-init`.
2. For each interface the module should consume, confirm it exists and inspect its surface so you import the right symbols:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" show <name>`
3. Add each consumed interface as a dependency (`pnpm add @antelopejs/interface-<name>`); if the module _provides_ an interface, list its package under `antelopeJs.implements` in `package.json`.
4. From the project, add the module to `antelope.config.ts` if it is not there yet (`ajs project modules add <path> --mode local`), then run `ajs project modules install` to add a provider module for every interface no loaded module implements (`install` does that resolution, not `add`).

Confirm the target path with the user before running `ajs module init` if anything already exists there. Use pnpm for any package operations.
