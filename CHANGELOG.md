# Changelog

Releases of the `antelopejs` plugin for Claude Code and OpenAI Codex. The `@antelopejs/agent-skills` npm package has its own releases, tagged `agent-skills-v<version>`.

## 0.8.1

- The plugin now ships the DMS workflow skills, so an install gets seven more skills: `dms-best-practices`, `dms-builder-mcp`, `dms-external-database`, `dms-mockup`, `dms-mockup-build`, `dms-page-design` and `dms-pages`. They cover building DMS pages through the builder MCP or in code, designing pages that show data, connecting a project to an existing database, and mocking up an app and building it from the approved mockup.
- The plugin description now lists them. Installs of 0.8.0 kept the four-skill copy, because Claude Code updates a plugin only when its `version` changes.

## 0.8.0

- The plugin now lives in the repository's `plugin/` folder, and both marketplaces install it from there. An install gets only what the plugin runs: the manifests, its four skills, the Codex hooks and the sync and resolver scripts.
- Claude Code: the plugin no longer has hooks. The skill sync no longer runs at session start or after Bash commands. Run `/antelopejs:sync-skills` in the project, and again after installing or upgrading packages.
- Codex keeps its hooks. Trust them again in `/hooks` after this update.
- `eval-skills` is no longer part of the plugin. It runs only from a checkout of AntelopeJS/agent-skills, where it lives in `.agents/skills/eval-skills`.
