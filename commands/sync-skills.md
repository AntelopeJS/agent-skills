---
description: Sync package-shipped AntelopeJS skills into the project's .claude/skills/
allowed-tools: Bash(node:*)
---

Sync the skills shipped by the project's AntelopeJS packages into `.claude/skills/`, and report what changed.

Run the sync script verbosely:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-skills.mjs"
```

Then report to the user:

- Which skills were added or removed (entry names are `<module>--<skill>`, symlinked into `.claude/skills/`), and which were already up to date.
- Any warnings (e.g. a name collision with an entry the script does not manage — those are skipped, never overwritten).
- If the script prints "Not an AntelopeJS project", explain that skills are synced per-project: run it from a directory containing `antelope.config.*`.

Background for your explanation, if asked: packages declare skills via `antelopeJs.skills` in their package.json (an array of directories whose subdirectories contain a `SKILL.md`). The script discovers them in `node_modules` and `.antelope/cache`, links them into `.claude/skills/`, and tracks its own entries in `.claude/skills/.ajs-managed.json` (with a scoped `.gitignore`) so the repo stays clean and user-created skills are never touched. This sync also runs automatically via plugin hooks (session start and after Bash commands), so a manual run is only needed as a fallback.
