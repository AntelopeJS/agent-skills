# Changelog

Releases of the `antelopejs` plugin for Claude Code and OpenAI Codex. The `@antelopejs/agent-skills` npm package has its own releases, tagged `agent-skills-v<version>`.

## 0.9.4

- A week- or date-grouped `ChartBar` sets `orientation: "vertical"` in the mockup spec example, the mockup spec and dms-page-design: an unset orientation is horizontal, which forces a category axis and reads `NaN` inside a currency `ChartCard`. The mockup spec's `ResourceForm` example lists its `fields` once and names them in each section's `fieldIds`, so it validates.

## 0.9.3

- A week- or date-grouped chart in a mockup is a vertical `ChartBar` with `xaxisType: "datetime"` and `xAxis.datetimeFormat`, with `valueFormat` and `currencyCode` on the wrapping `ChartCard` (a bare chart ignores them); a horizontal `ChartBar` stays bare on a category axis. The mockup spec notes that a duplicate module id is an issue.

## 0.9.2

- A KPI that is a share or a rate is built on the builder's `ratio` query template with `valueFormat: "percent"` (dms-builder-mcp, dms-page-design), and the mockup build never swaps a block no builder tool can build for another figure: it leaves it unbuilt, reports it under what remains and offers Code mode.

## 0.9.1

- The DMS skills no longer call the preview tool, which the DMS dev MCP and assistant drop: the design-fidelity protocol builds or updates a mockup through `dms-mockup` for the user to annotate, with the text table as the fallback when there is no mockup tooling, and the mockup build compares pages through `page_verify` and the user's confirmation only.

## 0.9.0

- Mockup specs carry a top-level `modules` (DMS module catalog ids such as `mailing`, `media`, `saas`): the mockup skill writes a matched module there instead of sketching a copy, and the build skill installs each missing package with `ajs project modules add`, loads its skill and builds on it.

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
