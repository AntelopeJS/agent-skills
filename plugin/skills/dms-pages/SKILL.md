---
name: dms-pages
description: Declares AntelopeJS DMS admin pages in code and composes their blocks. Use when writing a @RegisterPage / PageController class, composing Form, TableView, Chart, Grid or KpiCard blocks from @antelopejs/interface-dms/base, choosing DataTypes, wiring the routes and DataControllers that feed a page, or editing page TypeScript when the builder MCP is unavailable or cannot make a change.
---

# Pages and components in code

The DMS is backend-driven: you declare a **page** and attach **blocks** to it as static fields. The builders produce a serializable description that the shared Vue frontend renders, so a standard screen needs no Vue. **Before composing a page, apply dms-best-practices** (blocks only, custom for the missing block, `.meta()`, design fidelity). A `docs/<path>` link is `https://dms.antelopejs.com/docs/<path>`: pages in `docs/building/pages-and-components`, the navigation tree in `docs/building/navigation`, one page per block under `docs/components`.

## Pick the path

- **The builder MCP answers** (`builder_catalog` is among your tools): build through **dms-builder-mcp**. It writes this same code, typechecked, and keeps the builder's index in step. Use this skill for what the builder reports `opaque_target` or `unsupported`, for routes and DataControllers, and for custom blocks; then call `builder_refresh`.
- **Safe mode is on**: the builder tools are the only way to write. Follow **dms-builder-mcp**.
- **No builder MCP**: write the TypeScript below yourself.

This skill ships with the `antelopejs` plugin, not with the project's DMS. The project's installed `@antelopejs/interface-dms` is the source of truth: when a name below is missing from its types (`node_modules/@antelopejs/interface-dms`, TSDoc and `docs/`), follow the installed version.

## Declaring a page

A page is a class extending `PageController(id, options)` decorated with `@RegisterPage()`. Registration happens at import time: `src/index.ts` must import the pages module.

```ts
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";

@RegisterPage()
export class RecipesPage extends PageController("recipes", {
  displayName: "Recipes", // sidebar label (a "$dms_x.y" i18n key in real modules)
  icon: "i-ph-cooking-pot", // any iconify name
  module: "cookbook", // a RegisterModule'd module id; can be combined with a category inside the module
  order: 0,
}) {}
```

`options` is the `MenuOptions` shape: `displayName`, `icon`, `module` and/or `category` (at least one; a module page's explicit category descends from the module's root), `urlSlug` (defaults to the id), `order`, `description`, `hidden`, `type`, plus auth options (`publicAccess`, `authOnly`, `memberAccess`, `permission`, `noComponentPermissions`; see **dms-auth**). `Category(id, options)` returns a `CategoryInfo` for a page's `category`; `RegisterModule({ id, … })` creates a module root that pages join with `module: "<id>"`. Module pages live under `/modules/<moduleId>/<urlSlug>` and are **owner-only by design**: a screen for regular users goes under `pagesCategory` or a normal `Category`.

## Composing blocks

Each **static field on the page class whose value is a block builder** becomes a named block. Builders are fluent; import them from `@antelopejs/interface-dms/base` (barrel or subpaths):

```ts
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { Form } from "@antelopejs/interface-dms/base/form";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { HttpMethod } from "@antelopejs/interface-dms/base/types";

@RegisterPage()
export class SubmitRecipePage extends PageController("submit-recipe", {
  displayName: "Submit Recipe",
  module: "cookbook",
}) {
  static form = Form({
    title: "Submit a Recipe",
    fields: [
      {
        id: "chef",
        label: "Chef Name",
        type: new DefaultDataTypes.StringType({ maxLength: 100 }),
      },
      { id: "email", label: "Email", type: new DefaultDataTypes.EmailType() },
    ],
    submitUrl: "/api/recipes",
    submitUrlMethod: HttpMethod.post,
    kind: "action", // "create" for a form making a row; omit for a record form (save bar)
  });
}
```

[REFERENCE.md](REFERENCE.md) has the block catalog (`Form`, `TableView`, the charts, layout containers, dashboard widgets, `CustomComponent`), nesting rules, the behavioral DSL (permissioned `.action()`s, `.watch()` reactivity) and patterns by topic.

**Custom UI is only the missing block.** A part with no DMS equivalent becomes one `CustomComponent` (from `@antelopejs/interface-dms/base/custom`) carrying `.meta({ name, description, icon })` with `$` keys, as **dms-best-practices** says (`docs/components/custom-component`).

## Feeding blocks with data

Blocks pull data from URLs. Declare routes with the `@antelopejs/interface-api` decorators (`Controller`, `Get`, `Post`, `@Parameter`, `@JSONBody`); return a plain object for 200 or throw `new HTTPResult(status, body)`. `GetModel(Model)` (from `@antelopejs/interface-database-decorators`) gives `get`, `getAll`, `insert`, `update` and `delete`. Routes under a controller that a page or DataController wraps **inherit** its auth (see **dms-auth**). A route declared on a page class is served under `/dms/pages`, not at the page's own path: name it with `pageRoutePath(slug, "/route")` from `@antelopejs/interface-dms/page` in a `fetchUrl` or `submitUrl`. A plain `Controller` the frontend calls sits under `/api/<module>/`.

A **`TableView` is normally backed by a `DataController`**: a class `extends DataController(TableClass, TableViewRoutes.All, Controller("/path"))` registered with `@RegisterDataController()` (both from `@antelopejs/interface-data-api`). `TableClass` is a `Table` declared with `@RegisterTable(name, schema)` from `@antelopejs/interface-database-decorators`. `TableViewRoutes` (from `@antelopejs/interface-dms/base/table-view`) has the presets `Get`, `List`, `Select`, `Count`, `New`, `Edit`, `Delete`, `Archive`, `Restore` and `All`. Field decorators: `@Column`, `@Select`, `@Exported`, `@ArchiveField`, `@Searchable` from `@antelopejs/interface-dms/base` (plus class-level `@ColumnGroup(id, config)`), `@Listable` and `@Sortable` from `@antelopejs/interface-data-api/metadata`. Read a real one first: `@antelopejs/interface-dms/data-controllers` (`members`); guide in `docs/components/data-controller`. Database rows carry **`_id`** as the primary key: return and type it as `_id`.

## DataTypes

A field's `type` is a **DataType instance**, `new DefaultDataTypes.StringType({ … })`; the same types drive TableView columns and filters. [REFERENCE.md](REFERENCE.md) lists the built-in types and how to register custom ones.

## Verify in the browser

The build typechecks `src/` only: it misses a Vue error in a custom component and a wrong URL. After editing pages, restart the project and open each page: `navigate_to_page` and `query_logs` when the MCP answers, the browser otherwise (see **dms-project**). A hand-written link to a module page includes the `/modules/<moduleId>` prefix (or reads `fullSlug` from the layout): a missing prefix 404s through the frontend catch-all even though the build is clean. The page is done when every block it shows has data and the browser console and server logs hold no error from it.
