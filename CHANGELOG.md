# Changelog

Releases of the `antelopejs` plugin for Claude Code and OpenAI Codex. The `@antelopejs/agent-skills` npm package has its own releases, tagged `agent-skills-v<version>`.

## 0.8.3

- The mockup and page-design skills tell the assistant to give a chart grouped by week or date a datetime category axis with a date format, and the currency format to the values only, so week labels no longer show as amounts. The `ChartBar` example in the mockup spec shows it.

## 0.8.2

- The DMS skills guide mockups and builds over read-write data: they propose edits, deletes and archives only where the data allows it, never erase transactions, and delete only tables nothing references.
- Mockups read their data from fixtures of the right shape (a table of shapes per block), read the spec with `mockup_read_spec`, give a change figure only to a page with a period selector, and draw a rating as a badge.
- A mockup of an existing app starts empty; the assistant brings an existing page in with `mockup_from_page { into }`, at its real section and place.
- The build writes the mockup's sections as sidebar sections and its column displays, groups and sizes through the builder, in Safe mode.
- Needs `@antelopejs/dms` 0.21.3 or later for the new MCP tools.

## 0.8.1

- The plugin now ships the DMS workflow skills, so an install gets seven more skills: `dms-best-practices`, `dms-builder-mcp`, `dms-external-database`, `dms-mockup`, `dms-mockup-build`, `dms-page-design` and `dms-pages`. They cover building DMS pages through the builder MCP or in code, designing pages that show data, connecting a project to an existing database, and mocking up an app and building it from the approved mockup.
- The plugin description now lists them. Installs of 0.8.0 kept the four-skill copy, because Claude Code updates a plugin only when its `version` changes.

## 0.8.0

- The plugin now lives in the repository's `plugin/` folder, and both marketplaces install it from there. An install gets only what the plugin runs: the manifests, its four skills, the Codex hooks and the sync and resolver scripts.
- Claude Code: the plugin no longer has hooks. The skill sync no longer runs at session start or after Bash commands. Run `/antelopejs:sync-skills` in the project, and again after installing or upgrading packages.
- Codex keeps its hooks. Trust them again in `/hooks` after this update.
- `eval-skills` is no longer part of the plugin. It runs only from a checkout of AntelopeJS/agent-skills, where it lives in `.agents/skills/eval-skills`.
