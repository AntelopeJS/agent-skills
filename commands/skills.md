---
description: List the skills synced from the project's AntelopeJS packages and where each comes from
allowed-tools: Bash(node:*)
---

List the package-shipped skills of this project. Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-skills.mjs" --list
```

It changes nothing. Each row is one skill: the `.claude/skills/` entry, the skill's own name (the one to invoke), the package and version that ships it, where that package was found, and its status.

- **FROM**: `workspace` (a source checkout: the current package, its parents up to the repository root, or a workspace package), `node_modules` (an installed dependency, pnpm links included), or `antelope-cache` (a module `ajs` installed in `.antelope/cache`).
- **STATUS**: `linked` (synced), `not synced yet` (run `/antelopejs:sync-skills`), or `skipped` (a file of the user's already holds that entry name, so it is never overwritten).

Present the result grouped by package, so the user sees which package teaches what. In a DMS project, point out the `dms` router skill and `dms-best-practices` as the place to start. If the script prints "Not an AntelopeJS project", explain that skills are synced per project: run Claude Code from the directory holding `antelope.config.*`, or from an app that depends on `@antelopejs/core`. If no package ships skills, say that skills arrive with the packages: install the dependencies (`pnpm install`, then `ajs project modules install` for `antelope.config` modules) and run `/antelopejs:sync-skills`.
