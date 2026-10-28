---
name: skills
description: List the skills synced from the project's AntelopeJS packages and where each comes from. Use when the person asks which AntelopeJS or DMS skills the project has.
allowed-tools: Bash(node:*)
---

List the package-shipped skills of this project. The sync script is `scripts/sync-skills.mjs` at the plugin root, two levels above the directory holding this file. Run it with `--target claude` in Claude Code and `--target codex` in Codex:

```
node "<skill-dir>/../../scripts/sync-skills.mjs" --list --target <claude|codex>
```

It changes nothing. Each row is one skill: the entry in `.claude/skills/` (Claude Code) or `.agents/skills/` (Codex), the skill's own name (the one to invoke), the package and version that ships it, where that package was found, and its status.

- **FROM**: `workspace` (a source checkout: the current package, its parents up to the repository root, or a workspace package), `node_modules` (an installed dependency, pnpm links included), or `antelope-cache` (a module `ajs` installed in `.antelope/cache`).
- **STATUS**: `linked` (synced), `not synced yet` (run the `antelopejs:sync-skills` skill), or `skipped` (a file of the person's already holds that entry name, so it is never overwritten).

Present the result grouped by package, so the person sees which package teaches what. In a DMS project, point out the `dms` router skill and `dms-best-practices` as the place to start.

In Codex, every skill showing `not synced yet` means the plugin's hooks did not run: Codex runs them only once they are trusted, and asks again after every plugin update. Tell the person to open `/hooks` and trust the `antelopejs` hooks, then run the `antelopejs:sync-skills` skill.

If the script prints "Not an AntelopeJS project", explain that skills are synced per project: run the agent from the directory holding `antelope.config.*`, or from an app that depends on `@antelopejs/core`. If no package ships skills, say that skills arrive with the packages: install the dependencies (`pnpm install`, then `ajs project modules install` for `antelope.config` modules) and run the `antelopejs:sync-skills` skill.
