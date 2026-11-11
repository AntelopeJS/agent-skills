---
name: dms-builder-mcp
description: Drives the AntelopeJS DMS builder MCP tools (builder_catalog, builder_add_block, builder_compose_page, …), whose typechecked operations change a project's pages, and detects whether the project has them. Use when adding, configuring, moving or removing DMS blocks, pages or categories through the builder, when Safe mode is on, or when a builder tool answers an error.
---

# Building DMS pages through the builder MCP

The DMS builder edits the project's own TypeScript: a page is a `PageController` class, a block a static field or `.child()` call, a resource a `Table` + `DataController` + model. Every builder operation is **atomic and typecheck-gated**: on success it returns the file changes; on `typecheck_failed` nothing is written.

Load **dms-best-practices** first and follow it: it decides what a page is made of and runs the design-fidelity protocol. This skill covers driving the builder tools.

## Detect what the project has

Settle these three before the first edit. They decide every later branch.

1. **The builder MCP.** Look for `builder_catalog` among your tools. Claude Code prefixes MCP tools with their server (`mcp__dms__builder_catalog`); the bare name is what counts. When it is missing:
   - The project's `.mcp.json` names a DMS server, but the tools are absent: the DMS writes that entry under `ajs project dev`, and the tools answer only while it runs. Ask the user to start `ajs project dev`, then to reload the MCP servers (`/mcp` in Claude Code, a restart in Codex).
   - No such entry, or the user wants to go on without the dev server: **code path**. Edit the TypeScript yourself with **dms-pages**, then verify as _Verify_ below says.
2. **Safe mode.** The DMS MCP refuses its project tools (`builder_configure_project`, `builder_delete_resource`) with a Safe mode error, or the user says Safe mode is on. The server cannot stop your harness from editing files, so the rule is yours to hold: write only through the builder tools, never by a file edit. A step they cannot do (_Errors_ below) goes to the user.
3. **The asking tool.** In the dms-assistant chat, `ask_user` asks the user a closed question. Elsewhere, use your harness's own question tool (`AskUserQuestion` in Claude Code), or ask one closed question in chat.

## Addressing

- **PageRef** = the page's route, e.g. `/charts/revenue`.
- **BlockPath** = `<pageRef>#<name>[/<childId>...]`: `#<name>` is a top-level block; each `/<childId>` descends into a container's child.
- **CategoryRef** = a dotted id, e.g. `pages.charts` (top-level pages under `pages.*`; module pages under `modules.<id>.*`). Take exact refs from `builder_list_pages`, never guess.
- **ResourceRef** = a data resource's id, its `/api/<name>` route segment. **FieldPath** = `<resourceRef>#<fieldName>`. Take refs from `builder_list_resources`.
- **QueryRef** = `<pageRef>@<queryName>`, e.g. `/catalog/books@inStockCount`. Take refs from `builder_page_structure`'s `queries`.

## DataType, component and reference values

- A config field the catalog marks `x-dataType` (a Form field's `type`, a TableView column `type`, a resource field's `dataType`) takes a **DataType value** `{ $dataType: "<id>", config: {…} }`, an id from `builder_catalog`'s `dataTypes`. Pass no raw `$expr`: Safe mode refuses it.
- A config field marked `x-component` holds a nested block (a ChartCard's `chart`): pass `{ $block: { type: "<type>", config: {…} } }` with a `type` from `builder_catalog`.
- A builder-generated resource class named inside config (a relation column's `dataApiController`) takes a **reference value** `{ $ref: { resource: "<ref>", as?: "dataApi" | "table" | "model" } }` (default `dataApi`). The resource must exist. `$ref` is validated and allowed in Safe mode.

## Workflow

1. **Catalog first.** `builder_catalog` with no arguments returns every valid block `type` with its `container` / `controllerArg` flags, every DataType id and `reservedFieldNames`. Use only the types it lists. Then call it with `blocks: ["TableView", …]` and `dataTypes: ["select", …]` for the full schema of the entries you will use.
2. **Read before you write.** `builder_list_pages` finds a page or category; `builder_page_structure <pageRef>` gives the block tree, `editable` flags and the `version` hash. Model new blocks on an existing page.
3. **Create a page** with `builder_create_page` (a real `CategoryRef`); it returns `{ ref, filepath }`. Then `navigate_to_page` to it at once, so the user watches it fill in.
4. **Build the blocks.** A whole page, or a set of blocks, goes in one `builder_compose_page` call: the blocks as an ordered tree, each data block with its `query` inline. Preview it first (`"preview": true`), as **dms-page-design** _Build a page in one call_ says. For one block, `builder_add_block`: omit `parent` for a top-level block or pass a container's BlockPath; `name` unique among siblings. A controller-leading block (catalog `controllerArg: true`, e.g. `TableView`) takes `controller` = the resource `ref`; other types refuse it.
5. **Configure or rearrange.** `builder_configure_block` merges options (`replace: true` overwrites); `builder_configure_table_view` sets a table's displays, views and footer. Children change only through `builder_add_block`, `builder_move_block` and `builder_remove_block` (which removes the subtree).
6. **Pages and categories.** `builder_configure_page` edits displayName, icon, order and description; `builder_delete_page` removes a page and its barrel import; `builder_create_category`, `builder_configure_category` and `builder_delete_category` manage categories. A category delete is refused with `referential_integrity` while a page references it.
7. **Verify.** A typecheck-clean edit can still fail at runtime (a `fetchUrl` that 404s). `navigate_to_page` loads the page and lists the blocks that are empty, failed or loading; `query_logs` shows the host's reload and runtime output. The step is done when every block the change touched has data and the logs show no error from it.

On the code path, verify with the project's typecheck (the `typecheck` MCP tool, or the project's own script), then open the page in the browser as **dms-pages** _Verify in the browser_ says.

## Data resources and queries

A **resource** is the data a table or form shows: a `Table` + `Model` and a `DataAPI` controller at `/api/<name>`, generated as decorator classes kept in sync. Create it with the builder, then `builder_add_block` a `TableView` with `controller` = the resource `ref`.

A **query** is a derived-data endpoint on a page: an aggregate or one point per group, backed by a generated model method. Its `response` matches the block: `value` for a `KpiCard`, `card` for a `ChartCard`, `items` for a `TopListCard`, `series` for a bare chart. Run `builder_query_templates` and `builder_preview_query` first, add it with `builder_add_query` on the page that shows it, and wire the returned `route` as the block's `fetchUrl`.

[REFERENCE.md](REFERENCE.md) has the resource and query workflows, field rules, `$param` binding and opaque queries.

## Errors

- `typecheck_failed`: read `diagnostics`, fix the `config` or `type`, retry. Nothing was written.
- `invalid_config`, `duplicate_name`, `not_found`: fix the input.
- `stale`: the page changed under you; read it again with `builder_page_structure` and retry.
- `builder_unavailable`, `request_failed`: the builder engine is unreachable or does not implement the operation (`HTTP 400` means `unknown_op`). Explain the limitation; retry nothing.
- `opaque_target`, `unsupported`: the builder cannot make this change. Without Safe mode, make it in code with **dms-pages**, then call `builder_refresh` (scoped to the page) so the builder reads the file again. In Safe mode, ask the user whether to turn Safe mode off for that one step; never force it.

## Guardrails

- Read the full schema of each block type before you add one; use only its listed config keys. Read `builder_query_templates` before adding a query.
- Every block and child has a name, unique among its siblings.
- A card showing an aggregate reads a query, never a DataAPI route.
