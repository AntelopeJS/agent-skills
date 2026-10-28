---
name: sync-skills
description: Sync the skills shipped by the project's AntelopeJS packages into the project now. Use when the person asks to sync or refresh the AntelopeJS skills, or after installing packages when a skill is missing.
allowed-tools: Bash(node:*)
---

Sync the skills shipped by the project's AntelopeJS packages into the project, and report what changed. The sync script is `scripts/sync-skills.mjs` at the plugin root, two levels above the directory holding this file. Run it verbosely, with `--target claude` in Claude Code (into `.claude/skills/`) and `--target codex` in Codex (into `.agents/skills/`):

```
node "<skill-dir>/../../scripts/sync-skills.mjs" --target <claude|codex>
```

In Codex, the sandbox keeps `.agents/` read-only, as it does `.git/`, so request to run this command outside the sandbox; Codex asks the person to approve it.

Then report to the person:

- Which skills were added or removed (entry names are `<module>--<skill>`, symlinked into the skills directory), and how many were already up to date. For the full list with each skill's package and source, run the `antelopejs:skills` skill.
- Any warnings (e.g. a name collision with an entry the script does not manage: those are skipped, never overwritten).
- If the script prints "Not an AntelopeJS project", explain that skills are synced per project: run it from a directory holding `antelope.config.*`, or from an app that depends on `@antelopejs/core`.

The sync also runs on its own through the plugin's hooks (at session start and after Bash commands), so a manual run is only a fallback. When you are Codex and this run added skills, the hooks probably did not run: Codex runs them only once they are trusted, and asks again after every plugin update. Tell the person to open `/hooks` and trust the `antelopejs` hooks so the sync keeps running on its own.

Skills synced mid-session load on their own, except when the skills directory did not exist when the session started: then tell the person to run `/reload-skills` in Claude Code, or to restart Codex.

Background for your explanation, if asked: packages declare skills via `antelopeJs.skills` in their package.json (an array of directories whose subdirectories contain a `SKILL.md`). The script discovers them in the workspace (the current package, its parents up to the repository root, and workspace packages), in `node_modules` (pnpm links included), and in `.antelope/cache`; links them into `.claude/skills/` and `.agents/skills/` (one of them with `--target`); and tracks its own entries in each directory's `.ajs-managed.json` (with a scoped `.gitignore`) so the repo stays clean and the person's own skills are never touched.
