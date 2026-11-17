# Mockup file formats

The formats of `mockups/<name>/spec.json` and `mockups/<name>/annotations.json`, for **dms-mockup** and **dms-mockup-build**. `<name>` matches `^[a-z0-9][a-z0-9-]{0,63}$`, and so does every page `id`. Never name a mockup `schema`: `/api/mockup/schema` answers the schema, so that mockup's routes never answer.

## Schema

A running DMS serves the JSON Schema of the spec, built from the blocks of the installed modules, at `GET /api/mockup/schema`, and a two-page example spec that compiles with no issue at `GET /api/mockup/example`: model the pages on it. When the schema and this page disagree, the schema wins.

Fallback with no running DMS: `@antelopejs/dms` ships the same files at `node_modules/@antelopejs/dms/data/mockup-spec.schema.json` and `node_modules/@antelopejs/dms/data/mockup-example/spec.json`, but a project that installs its modules under `.antelope/cache` has no `node_modules/@antelopejs/dms`. When the schema file exists, point the spec's `$schema` at it, so an editor checks the spec as the user types; otherwise leave `$schema` out.

## spec.json

```json
{
  "$schema": "../../node_modules/@antelopejs/dms/data/mockup-spec.schema.json",
  "version": 1,
  "title": "Order desk",
  "categories": [
    { "id": "sales", "title": "Sales", "icon": "i-ph-storefront" }
  ],
  "pages": [
    {
      "id": "orders",
      "title": "Orders",
      "category": "sales",
      "options": { "theme": "light", "locale": "en", "padding": true },
      "fixtures": {
        "orders": [
          { "_id": "o1", "customer": "Acme", "total": 120, "status": "paid" },
          {
            "_id": "o2",
            "customer": "Globex",
            "total": 87.5,
            "status": "pending"
          }
        ],
        "revenue": {
          "value": 48210,
          "delta": 12.4,
          "series": [
            {
              "name": "Revenue",
              "data": [
                { "x": "2026-01-05T00:00:00.000Z", "y": 5800 },
                { "x": "2026-01-06T00:00:00.000Z", "y": 6400 }
              ]
            }
          ]
        }
      },
      "tree": [
        {
          "type": "ChartCard",
          "options": {
            "title": "Revenue",
            "fetchUrl": "fixture:revenue",
            "valueFormat": "currency",
            "currencyCode": "EUR"
          },
          "children": [
            {
              "id": "chart",
              "type": "ChartArea",
              "options": { "xaxisType": "datetime" }
            }
          ]
        },
        {
          "type": "TableView",
          "options": {
            "fetchUrl": "fixture:orders",
            "caption": "Orders",
            "columns": {
              "customer": {
                "name": "Customer",
                "type": "string",
                "sortable": true
              },
              "total": { "name": "Total", "type": "number", "sortable": true },
              "status": { "name": "Status", "type": "select" }
            }
          }
        },
        {
          "type": "sketch",
          "options": {
            "html": "<div class='map'>Delivery map</div>",
            "css": ".map{height:100%;display:grid;place-items:center}",
            "height": 240,
            "caption": "Live map of the drivers"
          }
        }
      ]
    }
  ]
}
```

- `pages`: 0 to 50 pages. An empty `pages` is valid: it is how a mockup starts. `options` is optional: `theme` (`light` or `dark`), `locale`, `padding` (default `true`).
- `categories` (optional): the menu's sections, in menu order, at most 50, each `{ id, title, icon? }` with `id` in the page `id` format. A page's `category` names one; a page without one is in the default _Pages_ section, where the dashboards stay. An unknown or repeated id is an issue. The sections follow **dms-page-design** _Group pages into sections_.
- `icon`, `description` and `headerActions` (optional, per page): the page header the DMS draws above the blocks, with `title`. `icon` is an icon name (`i-ph-receipt`), `description` one line under the title, `headerActions` the header's buttons, each `{ label, icon?, color?, variant? }`. A button holds no target: what it does is decided at build. Give every page an icon and a description, as **dms-page-design** _Name every page_ says.
- `fixtures`: a key (`^[A-Za-z0-9_-]{1,64}$`) to any JSON value, the data the page's blocks read, or to a `$generate` object that the server turns into rows ([Generated fixtures](#generated-fixtures)).
- `tree`: the page's blocks, top to bottom, in the `DmsBlockPreview` tree format below.
- `menu`, `parent` and `route` (optional, per page): a sub-page, such as a list's detail page, as _Links and sub-pages_ says.
- `livePage` and `liveRoutes` (optional, per page): set when the AI converts a live page into a mockup (`mockup_from_page`), which also fills `icon` and `description` from it, `livePage: { ref, version }` and `liveRoutes` a fixture key to the live route it stands for. **dms-mockup-build** reads them.
- `source` (optional): what created the spec: `claude-code` or `codex` for the harness, or `chat` for the host's chat. The host can override the value the harness sets.
- `built` (optional): written by **dms-mockup-build** after a build, `{ at, pages }`: `at` an ISO date, `pages` one `{ path, title? }` per page built, `path` its dashboard path.

The envelope is strict: a key this page does not list is an issue.

## Nodes

A node is `{ type, options?, children? }`; a child also takes `id`, `slot` (a `Tab` or `Card` slot) and `colSpan` (inside a `GridRow`). `type` is a block type of the catalog (it wins over a `componentName`) and `options` its factory options, with two exceptions:

- An option that holds a block, such as a `ChartCard`'s `chart`, is a child whose `id` is the option's name.
- A `Form` with `sections` keeps every field in `fields`, and each section lists its fields by id in `fieldIds`.

Name every child with an `id`: the builder and the roles editor key blocks by name. A block that only shows a figure can take its `static*` options (`staticValue`, `staticDelta`) in place of a fixture.

- **Fixture reference.** Any string option of the form `fixture:<key>`, at any depth, reads that key of the page's `fixtures`. Use it for every `fetchUrl`, so the block draws data with no route.
- **Page link.** Any string option of the form `page:<id>`, at any depth, links to that spec page, as _Links and sub-pages_ says.
- **`TableView`** takes the options of `TableView.fromSource`: `fetchUrl: "fixture:<key>"` naming an array of rows, a `caption`, and `columns` keyed by row field, each with its `name` and its `type`, a data type id (`string`, `number`, `date`, `boolean`, `select`, …). Paging, search, sort, tabs, quick filters, views and the board work over the fixture. A table with no `caption`, or a blank one, is an issue and its write is refused, except on a page with `livePage`. A column takes a `display`, and the table its board, tabs and views, as _Tables_ says. A table with tabs, `quickFilters` or `queryParamFilters` needs `capabilities.filter` when you write `capabilities` explicitly (the rule of `assertSourceFilters`, interface-dms `base/table-view/source.ts`); without `capabilities` the mockup compiler sets `filter: true` and validation passes.
- **`ResourceForm`** takes its `fields` and `fetchUrl: "fixture:<key>"` naming the record object, with no `submitUrl`.
- **Sketch.** `{ "type": "sketch", "options": { "html", "css"?, "height"?, "caption"? } }`, with no children: the static HTML and CSS of one custom part, drawn hatched, outlined and labelled _Custom_. `height` is 80 to 1200 px (default 320); `caption` (up to 200 characters) says what the part does. It runs in a sandbox with no script: the spec refuses `<script>`, embedding elements, `on*` handlers, `<meta http-equiv>`, `@import`, `javascript:` and `vbscript:` URLs, and any `url()`, `src` or `href` that is not a `data:` URL or an `#anchor`. Keep it to the element alone; the blocks around it stay blocks.

## Tables

A `TableView` takes the features **dms-page-design** _Tables_ decides, in the names `TableView` gives them:

```json
{
  "id": "orders-table",
  "type": "TableView",
  "options": {
    "fetchUrl": "fixture:orders",
    "caption": "Orders",
    "columns": {
      "customer": { "name": "Customer", "type": "string", "sortable": true },
      "status": {
        "name": "Status",
        "type": "select",
        "filterable": true,
        "display": {
          "kind": "badge",
          "items": [
            { "value": "pending", "label": "Pending", "tone": "warning" },
            { "value": "paid", "label": "Paid", "tone": "success" },
            { "value": "refunded", "label": "Refunded", "tone": "error" }
          ]
        }
      },
      "total": {
        "name": "Total",
        "type": "number",
        "sortable": true,
        "display": { "kind": "price", "currency": "EUR" }
      }
    },
    "tabsFrom": { "column": "status" },
    "kanban": { "groupByField": "status" },
    "defaultDisplay": "kanban",
    "views": {
      "items": [
        {
          "id": "large",
          "label": "Large orders",
          "count": true,
          "sort": [{ "field": "total", "desc": true }]
        }
      ],
      "layout": "strip"
    }
  }
}
```

- **Column `display`**, one of:
  - a badge, `{ "kind": "badge", "items": [{ "value", "label", "tone" }] }`, on a `string` or `select` column: a `select` column carries its values this way. `tone` is `neutral`, `primary`, `secondary`, `success`, `warning`, `error` or `info`;
  - a price, `{ "kind": "price", "currency": "EUR" }`, on a `number` column, with an ISO 4217 code;
  - a cell display, `{ "type", "options"? }`, `type` one of `identity`, `pills`, `relative_date`, `indicator`, `status_pill`, `two_line`, `progress`, `sparkline`, `duration`, `bytes`, `string` and `mono`, such as `{ "type": "identity", "options": { "subtitleField": "email" } }`.
- **`tabsFrom`**, `{ "column" }`: "All", then one tab per badge item, in its tone. The column is `filterable` with a badge `display`, and the table has no `tabs`. Hand-written `tabs` colour a tab with `textColor` and `iconColor`; any other key, `color` included, is an issue.
- **`kanban`**, `{ "groupByField", "columnMaxHeight"? }`, on a badge, `boolean` or `status` column. Its cards do not move in a mockup.
- **`grouped`**, `{ "groupByField", "by"?, "collapsible"?, "count"? }`, on a `sortable` column; `by` is `value`, `day` or `week`, and `day` and `week` need a `date` column.
- **Cards**: `"displays": [{ "id": "table" }, { "id": "cards" }]` and `"card": { "fields": [...] }`.
- **`defaultDisplay`**, `mobileDisplay` and a view's `display` name a display the table offers: `table`, `cards`, `kanban` or `grouped`.
- **`views`**, `{ "items", "layout"?, "defaultView"?, "userViews"? }`, each view `{ "id", "label", "icon"?, "count"?, "filters"?, "sort"?, "display"?, "density"? }`: a filter `{ "accessorKey", "mode", "value" }` (`mode` `is`, `include`, `greater_than`, …) on a `filterable` column, a sort `{ "field", "desc"? }` on a `sortable` one.

The Builder's `builder_map_resources` holds the same settings under its own names; only `display` matches the proposal's shape as it is:

| Spec                                 | `builder_map_resources`                |
| ------------------------------------ | -------------------------------------- |
| the page's `title` and the `caption` | the resource's `title`                 |
| the page's `category`                | the resource's `category`: its ref     |
| `tabsFrom: { column }`               | the resource's `tabs: { column }`      |
| `kanban.groupByField`                | `tableOptions.kanban.groupBy`          |
| `grouped.groupByField`               | `tableOptions.grouped.groupBy`         |
| `cards` in `displays`, `card.fields` | `tableOptions.cards.fields`            |
| `defaultDisplay`                     | `tableOptions.defaultDisplay`          |
| a view filter's `accessorKey`        | `tableOptions.views` filter's `column` |
| a view sort's `field`                | `tableOptions.views` sort's `column`   |

`mobileDisplay`, a cell display and a hand-written `tabs` have no counterpart there.

## Links and sub-pages

A string option `page:<id>`, at any depth of a block's options, links to the spec page of that id; an id no page has is an issue. It goes wherever a block takes a URL or a route:

- a row action's or a toolbar button's `target`: `rowActions.custom[].target` and `customButtons[].target`, `{ "type": "page", "url": "page:<id>" }`;
- a tab's `to`, a `NavCardGrid` or `TopListCard` item's `to`, a `StatGroup` cell's `to`, a card head action's `to`;
- a `Form`'s `backTo` and `redirectOnSuccess`.

A sketch holds no link: its `href` is a `#anchor` or a `data:` URL only, so put the link on a block beside it.

A sub-page is a page with a `parent`, the `id` of another page (no loop): a list's detail page, or a custom form page. `"menu": false` leaves it out of the sidebar, which lights its nearest listed parent while it is open. `"route": ":<name>"` (it needs a `parent`) makes it show one row: on it, `fixture:<key>` naming an ancestor's rows reads the row whose `_id`, else `id`, is the parameter, and the first row stands in when no link names one. A sub-page reads the fixtures of its ancestors it does not hold itself.

```json
{
  "version": 1,
  "pages": [
    {
      "id": "orders",
      "title": "Orders",
      "fixtures": {
        "orders": {
          "$generate": {
            "fields": {
              "_id": "id",
              "customer": "company",
              "total": { "money": [40, 900] }
            }
          }
        }
      },
      "tree": [
        {
          "id": "orders-table",
          "type": "TableView",
          "options": {
            "fetchUrl": "fixture:orders",
            "caption": "Orders",
            "columns": {
              "customer": { "name": "Customer", "type": "string" },
              "total": { "name": "Total", "type": "number" }
            },
            "rowClick": "single",
            "rowActions": {
              "custom": [
                {
                  "label": "Open",
                  "icon": "i-ph-arrow-right",
                  "isDefault": true,
                  "target": { "type": "page", "url": "page:order" }
                }
              ]
            },
            "customButtons": [
              {
                "label": "Report",
                "icon": "i-ph-chart-bar",
                "target": { "type": "page", "url": "page:report" }
              }
            ]
          }
        }
      ]
    },
    {
      "id": "order",
      "title": "Order",
      "menu": false,
      "parent": "orders",
      "route": ":id",
      "tree": [
        {
          "id": "order-form",
          "type": "ResourceForm",
          "options": {
            "fetchUrl": "fixture:orders",
            "backTo": "page:orders",
            "fields": [
              { "id": "customer", "label": "Customer", "type": "string" },
              { "id": "total", "label": "Total", "type": "number" }
            ]
          }
        }
      ]
    },
    {
      "id": "report",
      "title": "Order report",
      "menu": false,
      "parent": "orders",
      "tree": []
    }
  ]
}
```

A row action's link passes the row's id, read at the table's `rowIdKey` (`_id` by default). `"rowClick": "single"` with a custom row action marked `isDefault: true` opens it on a click on the row. A link from a page with a route to its own sub-page with a route keeps the row; any other link opens the sample row.

## Table forms

A mockup table is read-only: an action is on only when `rowActions` writes it, `add`, `edit` or `details`, each `true` or a row action config such as `{ "rule": { "field": "status", "equals": "draft" } }`. `formContainer` says where the forms open, as in the real `TableView`:

- `{ "type": "modal" }`, the default when `formContainer` is left out, or `{ "type": "drawer" }`: the add and edit forms are generated from the table's columns, and saving keeps nothing. `pages.new` and `pages.edit` take their `displayName` and `description` only. `details` needs the `page` type.
- `{ "type": "page", "pages": { ... } }`: each action on opens a spec page, `{ "urlSlug": "page:<id>", "customPage": true }`, which holds the custom form or the detail view. The edit and details pages need a `route`.

```json
{
  "version": 1,
  "pages": [
    {
      "id": "orders",
      "title": "Orders",
      "fixtures": {
        "orders": [{ "_id": "o1", "customer": "Acme", "total": 120 }]
      },
      "tree": [
        {
          "id": "orders-table",
          "type": "TableView",
          "options": {
            "fetchUrl": "fixture:orders",
            "caption": "Orders",
            "columns": {
              "customer": { "name": "Customer", "type": "string" },
              "total": { "name": "Total", "type": "number" }
            },
            "rowActions": { "add": true, "edit": true, "details": true },
            "formContainer": {
              "type": "page",
              "pages": {
                "new": { "urlSlug": "page:order-new", "customPage": true },
                "edit": { "urlSlug": "page:order-edit", "customPage": true },
                "details": { "urlSlug": "page:order", "customPage": true }
              }
            }
          }
        }
      ]
    },
    {
      "id": "order-new",
      "title": "New order",
      "menu": false,
      "parent": "orders",
      "tree": []
    },
    {
      "id": "order-edit",
      "title": "Edit order",
      "menu": false,
      "parent": "orders",
      "route": ":id",
      "tree": []
    },
    {
      "id": "order",
      "title": "Order",
      "menu": false,
      "parent": "orders",
      "route": ":id",
      "tree": []
    }
  ]
}
```

## Generated fixtures

A fixture value `{ "$generate": { "rows"?: number, "fields": { "<key>": <Kind> } } }` makes the server fill the rows, so you type the field list and not the data. `rows` is 1 to 200, default 8. The rows are the same on every read for one mockup, page and key.

`Kind` is one of:

- `"id"`, `"name"`, `"email"`, `"company"`, `"city"`, `"text"`, `"date"` (in the last 30 days, so a "This week" view has rows), `"boolean"`;
- `{ "number": [min, max] }` or `{ "money": [min, max] }`;
- a non-empty array of strings: one value per row (use it for statuses and categories).

```json
"fixtures": {
  "orders": {
    "$generate": {
      "fields": {
        "_id": "id",
        "customer": "company",
        "total": { "money": [40, 900] },
        "status": ["paid", "pending", "refunded"]
      }
    }
  }
}
```

`fixture:orders` then reads 8 rows. A value that must read true (a KPI headline, a total another page repeats) is a plain JSON fixture or a `static*` option. A hand-written date stays as written.

## Writing in steps

A mockup is written live, in saves small enough to show a change each. A save redraws the preview in under a second.

1. Create the mockup empty, with its menu sections when it has them: `mockup_write_spec` with `{ "mockup": "<name>", "spec": { "version": 1, "title": "Order desk", "source": "claude-code", "categories": [{ "id": "sales", "title": "Sales", "icon": "i-ph-storefront" }], "pages": [] } }`. Each page added then names its `category`.
2. Add a page as a skeleton, its blocks titled and its data generated: `mockup_patch_spec` with `{ "mockup": "<name>", "patch": [{ "op": "add", "path": "/pages/-", "value": { "id": "orders", "title": "Orders", "fixtures": { "orders": { "$generate": { "fields": { "customer": "company", "total": { "money": [40, 900] } } } } }, "tree": [{ "id": "orders-table", "type": "TableView", "options": { "fetchUrl": "fixture:orders", "caption": "Orders", "columns": { "customer": { "name": "Customer", "type": "string" }, "total": { "name": "Total", "type": "number" } } } }] } }] }`.
3. Fill a section: one patch of 2 or 3 operations on the blocks that belong together, `replace` on a node's `options` or `add` at `/pages/<i>/tree/-`, `<i>` the page's index.

A patch applies whole or not at all: a failed one leaves the spec as it was, so fix it and send it again. After an `add` or `remove` that shifts a node, re-read the pointers you still use.

## Validation

`mockup_write_spec` with `{ "mockup": "<name>", "spec": { … } }`, or `mockup_patch_spec` with `{ "mockup": "<name>", "patch": [ RFC 6902 operations ] }`, validates the resulting spec, writes `spec.json` when it holds, and answers `{ ok, errors }`, each error `{ path, message }`. A refused spec answers `ok: false`; a bad name, a failed patch operation or a missing target answers a tool error. Nothing is written in either case. Without that tool, `GET /api/mockup/<name>` answers the compiled state: `pages`, a `revision` that grows on each good read, and `issues`, each `{ path, message }` with `path` a JSON pointer into `spec.json` (`/pages/0/tree/1/children/0/options/title`). The spec validates when `issues` is empty. A node with bad options still draws what it can, so a page that looks right can still hold issues: read them.

## The preview

`/mockup?name=<name>` on the running DMS (`ajs project dev`, dev only) draws the spec and redraws it on every save; `&page=<id>` opens one page and `&width=mobile` the phone width (`desktop` by default). The user clicks an element there to comment on it.

## annotations.json

```json
{
  "version": 1,
  "annotations": [
    {
      "id": "k3f9",
      "page": "orders",
      "path": "/pages/0/tree/1",
      "text": "Add the order date",
      "status": "open",
      "createdAt": "2026-11-11T10:00:00.000Z"
    }
  ]
}
```

`path` is the JSON pointer of the node in `spec.json`. A resolved annotation has `status: "resolved"` and a `resolvedAt` date. After a spec edit that adds or removes a node before it, an open annotation's pointer can name a neighbour: match it by its text and page too.

Read and resolve them, by the first way available:

1. The DMS MCP: `mockup_annotations` with `{ "mockup": "<name>", "status": "open" }` (and `page` to narrow) lists them; `mockup_resolve_annotation` with `{ "mockup": "<name>", "id": "<id>" }` resolves one. Both work in Safe mode.
2. The HTTP API of the running DMS: `GET /api/mockup/<name>/annotations`, and `PATCH /api/mockup/<name>/annotations/<id>` with `{ "status": "resolved" }`.
3. The file itself, when no server runs: set `status` and `resolvedAt`, keep the rest as it is.
