---
name: dms-best-practices
description: Enforces the rules for building AntelopeJS DMS pages (every page a tree of DMS blocks, custom code only for the missing block, `.meta()` on every custom block), finds the DMS module or block feature a need already has before anything is built (mails, tenants and SaaS, translated fields, archiving) and proposes installing a missing module, decides when to leave DMS blocks and proposes that deviation to the user, and runs the design-fidelity protocol. Use when creating or changing any DMS page, dashboard or screen, before building a feature or business logic in a DMS project (sending an email, tenants or subscriptions, translatable fields, archiving rows), before writing a CustomComponent or Vue for one, or when the user provides a design, mockup, Figma frame or screenshot to reproduce. Not for a question about one block option or DataType (dms-pages).
---

# DMS best practices

Three rules hold for every page, a path runs before any custom block, and a protocol runs whenever a design is involved. They keep each part of a screen a permission of its own, editable by the builder, and driven by the theme. **dms-pages** has the code APIs and **dms-builder-mcp** the builder tools; this skill decides what to build.

Three facts about the project change the steps below. **dms-builder-mcp** _Detect what the project has_ tells how to settle them:

- **The builder MCP** answers (`builder_catalog` is among your tools), or not. **The preview** is a tool of its own: `preview_blocks` is among your tools, or not (an older DMS serves it to the dms-assistant chat only).
- **Safe mode** is on (the builder tools are the only way to write), or not.
- **The asking tool**: `ask_user` in the dms-assistant chat, your harness's question tool elsewhere, else one closed question in chat.

## Before you build

Run this before any feature, a page or business logic alike. Most needs already have a DMS module or a block feature, and a home-made copy loses its admin pages, permissions and upgrades.

1. **List what the project has**: the `@antelopejs/*` dependencies of `package.json`, the modules of `antelope.config.*`, and the synced skills (**skills**). Table syntax (`Table`, its decorators and modifiers) is in **database-decorators-interface**.
2. **Match the need.** The table holds the needs most often rebuilt. For any other, the module catalog is the resolver's `list` (**interface**): each `dms-*` interface there is a module's contract.

| Need                                                     | Use                                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An email, its template, its sends                        | `@antelopejs/dms-mailing`: a mail is a template, sent with `SendTemplate` and shipped with `DeclareTemplate` (`@antelopejs/interface-dms-mailing`)                     |
| Tenants, workspaces, SaaS, plans, subscriptions, billing | `@antelopejs/dms-saas`                                                                                                                                                 |
| An image or file on a record                             | `@antelopejs/dms-media` (`AssetType`)                                                                                                                                  |
| A procedure run on a schedule, a webhook or a data event | `@antelopejs/dms-automation`                                                                                                                                           |
| Translated interface texts, translations for another app | `@antelopejs/dms-lang`                                                                                                                                                 |
| A field in several languages                             | `@Localized()` on a field of a `Table.with(LocalizationModifier)` (`@antelopejs/interface-database-decorators/modifiers/localization`); the DMS form edits each locale |
| Archive and restore rows instead of deleting them        | `@ArchiveField()` on a boolean field of the `Table` and `TableViewRoutes.Archive` / `Restore` (`@antelopejs/interface-dms/base`)                                       |
| Status tabs, saved views, kanban, footer totals          | `TableView` options (**dms-page-design**)                                                                                                                              |

3. **Installed**: load that module's skill, or its contract through **interface**, and build on it. **Absent**: never build a copy. Before any code or command, ask with the asking tool whether to install it; on yes, run `ajs project modules add @antelopejs/<module>` and build on it.
4. **Before adding a field, column, route or custom code to a block**, read what the block already offers: `builder_catalog` with the builder MCP, else the block's TSDoc through **interface** (`contract dms base`).

## The rules

1. **A page is always blocks.** Describe every page on the backend as a tree of DMS blocks: `PeriodSelector`, `Grid` / `GridRow`, `KpiCard`, `TableView`, `Form`, … Each static field and each `.child()` is a line in the roles editor, a `.watch()` target, a `periodScope` subscriber and a node the builder can move. One block that draws the whole screen loses all of that.
2. **Custom = the missing block only.** When a part has no DMS equivalent, build **that block** as a `CustomComponent` and keep everything around it (toolbar, filters, stats, tables) as DMS blocks on the backend.
3. **Every custom block carries `.meta()`.** `.meta({ name, description, icon })` in its backend declaration, `name` and `description` as `$` i18n keys added to every locale file. Without it the roles editor shows the raw component name. Every other text (page names, titles, labels) is a `$` key too.

```ts
// Good: blocks around the one custom block, which carries its metadata
static period = PeriodSelector({ id: "api" });
static kpis = Grid().child("row", GridRow()
  .child("calls", KpiCard({ title: "$api.routes.calls", fetchUrl: "/api/routes/calls", periodScope: "api" })));
static graph = CustomComponent("ApiRouteGraph")
  .options({ fetchUrl: "/api/routes/graph", periodScope: "api" })
  .meta({ name: "$api.routes.graph.name", description: "$api.routes.graph.description", icon: "i-ph-graph" });

// Bad: one component draws the period picker, the KPIs and the graph; no .meta()
static screen = CustomComponent("ApiRoutesScreen");
```

`CustomComponent` comes from `@antelopejs/interface-dms/base/custom` (not the `base` barrel); `.meta()` takes `Partial<ComponentMetadata>` (`name`, `description?`, `icon?`). Every DMS factory sets its own metadata; a custom block is the one place you must.

## When to leave DMS blocks

A custom block is a deviation, and you **propose** it: the user decides, after the path below. It is worth proposing only when one of these holds:

| Leave DMS blocks when                                                                  | Stay on DMS blocks when                                                                                  |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| No block covers the need, even through its options or a composition of blocks          | The difference is spacing, color, radius, font or a minor layout the theme or the block's options handle |
| The interaction model differs: a drag-and-drop canvas, real-time collaborative editing | The DMS block only "looks slightly different" from the mockup                                            |
| The user asked for pixel perfect on **this** element                                   | Another element of the page is custom: a custom block never pulls its neighbours along                   |
| A measured constraint (performance, data volume) the block cannot meet                 | The constraint is a guess, not a measurement                                                             |

A whole page leaves DMS blocks only when no arrangement of blocks draws it, such as a kanban of a custom shape or a landing page: it becomes a **custom page**, a page whose one block is a full-page `CustomComponent`, proposed as any custom block is (a mockup writes it as [SPEC.md](../dms-mockup/SPEC.md) _Custom pages_ says).

## Before any custom block

Run this path before writing a `CustomComponent` or its Vue, one element at a time:

1. **Search the catalog.** With the builder MCP, `builder_catalog`; otherwise the block catalog of the running DMS (`GET /api/block-preview/types`), else `ListBlockTypes()` from `@antelopejs/interface-dms/base/block-types` or the exports of `@antelopejs/interface-dms/base`. Try the block's options first, then a composition of blocks (`Card` + `KeyValueList`, `ChartCard` + a chart, `Grid` of `KpiCard`).
2. **Show the comparison.** When `preview_blocks` is among your tools, call it with the closest DMS option as `tree`, the user's design as `reference`, and a **sketch variant** of the custom block, then show the user what it answers. Without it, write the text table of [REFERENCE.md](REFERENCE.md). When the page belongs to a mockup, the sketch goes in the spec instead (**dms-mockup**).
3. **Ask.** One closed question with the asking tool, three options: _Keep the DMS block_ / _Adjust it through its options_ / _Build a custom block_.
4. **Build.** On _Adjust_, change the block's options and preview again. Only on _Build a custom block_, build that block alone, under the rules above, with `.meta()`; the rest of the page stays blocks.

In **Safe mode** step 4 is out of reach, since the builder tools cannot write Vue: say so, offer the closest DMS composition, and ask whether to turn Safe mode off for that one block.

The path is done when the user has answered for the element. [REFERENCE.md](REFERENCE.md) has worked calls and the fallback table.

## Design-fidelity protocol

Run it whenever the user hands you a design, mockup or screenshot. When the user wants to iterate on the design before any page exists, run **dms-mockup** instead: it applies this protocol inside the spec.

1. **Frame once.** Before building, ask **one** question with the asking tool:
   - _Pixel perfect_: reproduce the design, custom blocks allowed where nothing matches;
   - _DMS equivalents_: map every component to its closest DMS block silently; an element no block or composition covers still goes through the path;
   - _Component by component_ (**recommended**): decide each visible difference together.
2. **Map** every component of the design to its closest DMS block ([REFERENCE.md](REFERENCE.md) has the mapping table). Differences the right-hand column of the table above lists never trigger a question.
3. **Decide.** _Component by component_: run [the path](#before-any-custom-block) for each visible difference (layout, a missing element, another chart kind), batching several components in one preview and one question. _Pixel perfect_ answers step 3 of the path for every element, so skip that question but still run step 1: only the parts no block or composition matches become custom.
4. **Build** under the rules above.

The protocol is done when every visibly different component has an answer and every custom block in the page carries `.meta()`.

## Checklist before handing back

A `docs/<path>` link is `https://dms.antelopejs.com/docs/<path>`.

- Every page field and child is a DMS block, except custom blocks the user chose through the path.
- Every `CustomComponent` has `.meta({ name, description, icon })` with `$` keys present in every locale file.
- Every automation node a module registers names itself, its description and each schema property's `title` and `description` with `$` keys present in every locale file (`docs/building/backend-services`, Texts in the builder).
- An automation action with side effects (email, notification, write) declares `dryRun(input, ctx)`: it checks the input as `execute` would and acts on nothing, so a builder Test run sends nothing (`docs/building/backend-services`, Test runs).
- Locale values escape vue-i18n's special characters as literals (`{'@'}`, `{'{'}`, `{'}'}`, `{'|'}`): a raw `@` or brace breaks the message's compilation (`docs/building/localization`, Special characters).
- Data comes from routes (`fetchUrl`) rather than options computed at registration; a custom block reads its route with `useApiData` (server-rendered, refreshed with the page) and writes with `$authFetch`.
- Publish tenant data with the tenant id: a `PublishMessage` about one workspace's data passes `{ tenantId }`, or it wakes the page of every workspace.
- Verified live, as **dms-builder-mcp** _Verify_ says, or in the browser without the MCP (**dms-project**). The build typechecks `src/` only.
