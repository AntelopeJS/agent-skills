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
        },
        "weekly": {
          "series": [
            {
              "name": "Revenue",
              "data": [
                { "x": "2026-01-05T00:00:00.000Z", "y": 31200 },
                { "x": "2026-01-12T00:00:00.000Z", "y": 28900 }
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
          "id": "weekly-revenue",
          "type": "ChartBar",
          "options": {
            "fetchUrl": "fixture:weekly",
            "xaxisType": "datetime",
            "datetimeFormat": "dd MMM",
            "valueFormat": "currency",
            "currencyCode": "EUR"
          }
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
- `categories` (optional): the menu's sections, in menu order, at most 50, each `{ id, title, icon? }` with `id` in the page `id` format. A page's `category` names one; a page without one is in the default _Pages_ section, where the dashboards stay. An unknown or repeated id is an issue. The sections follow **dms-page-design** _Group pages into sections_. The viewer draws the app's own menu too: a section whose `title` is an app section's (case and spaces aside) is drawn as that section, the app's pages first, and the default section joins the app's _Pages_.
- `sidebar` (optional): the sidebar widgets, as _Sidebar widgets_ says.
- `data` (optional): the connected database the app reads, `{ connection, access? }`, as _Connection access_ says.
- `custom`, `html`, `css`, `height` and `states` (optional, per page): a custom page, as _Custom pages_ says.
- `icon`, `description` and `headerActions` (optional, per page): the page header the DMS draws above the blocks, with `title`. `icon` is an icon name (`i-ph-receipt`), `description` one line under the title, `headerActions` the header's buttons, each `{ label, icon?, color?, variant? }`. A button holds no target: what it does is decided at build. Give every page an icon and a description, as **dms-page-design** _Name every page_ says.
- `fixtures`: a key (`^[A-Za-z0-9_-]{1,64}$`) to any JSON value, the data the page's blocks read, or to a `$generate` object that the server turns into rows ([Generated fixtures](#generated-fixtures)).
- `tree`: the page's blocks, top to bottom, in the `DmsBlockPreview` tree format below.
- `menu`, `parent` and `route` (optional, per page): a sub-page, such as a list's detail page, as _Links and sub-pages_ says.
- `livePage` and `liveRoutes` (optional, per page): set when the AI converts a live page into a mockup (`mockup_from_page`, with `into` for an existing mockup), which also fills `icon` and `description` from it, `livePage: { ref, version }` and `liveRoutes` a fixture key to the live route it stands for. A converted page's data blocks read samples shaped as each block reads them, and the viewer draws it on live data by default (the _Real data_ switch picks samples). **dms-mockup-build** reads them.
- `source` (optional): what created the spec: `claude-code` or `codex` for the harness, or `chat` for the host's chat. The host can override the value the harness sets.
- `built` (optional): written by **dms-mockup-build** after a build, `{ at, pages }`: `at` an ISO date, `pages` one `{ path, title? }` per page built, `path` its dashboard path.

The envelope is strict: a key this page does not list is an issue.

## Nodes

A node is `{ type, options?, children? }`; a child also takes `id`, `slot` (a `Tab` or `Card` slot) and `colSpan` (inside a `GridRow`). `type` is a block type of the catalog (it wins over a `componentName`) and `options` its factory options, with two exceptions:

- An option that holds a block, such as a `ChartCard`'s `chart`, is a child whose `id` is the option's name.
- A `Form` with `sections` keeps every field in `fields`, and each section lists its fields by id in `fieldIds`.

Name every child with an `id`: the builder and the roles editor key blocks by name. A chart whose categories are dates or weeks (a `ChartBar` of revenue per week) takes `xaxisType: "datetime"` with a `datetimeFormat` (`dd MMM`), its `x` values ISO timestamps, and `valueFormat: "currency"` with `currencyCode: "EUR"` for the values only: without the datetime axis the week labels read as amounts. A block that only shows a figure can take its `static*` options (`staticValue`, `staticDelta`) in place of a fixture.

- **Fixture reference.** Any string option of the form `fixture:<key>`, at any depth, reads that key of the page's `fixtures`. Use it for every `fetchUrl`, so the block draws data with no route.
- **Page link.** Any string option of the form `page:<id>`, at any depth, links to that spec page, as _Links and sub-pages_ says.
- **`TableView`** takes the options of `TableView.fromSource`: `fetchUrl: "fixture:<key>"` naming an array of rows, a `caption`, and `columns` keyed by row field, each with its `name` and its `type`, a data type id (`string`, `number`, `date`, `boolean`, `select`, …). Paging, search, sort, tabs, quick filters, views and the board work over the fixture. A table with no `caption`, or a blank one, is an issue and its write is refused, except on a page with `livePage`. A column takes a `display`, and the table its board, tabs and views, as _Tables_ says. A table with tabs, `quickFilters` or `queryParamFilters` needs `capabilities.filter` when you write `capabilities` explicitly (the rule of `assertSourceFilters`, interface-dms `base/table-view/source.ts`); without `capabilities` the mockup compiler sets `filter: true` and validation passes.
- **`ResourceForm`** takes its `mode`, its `fields` and `fetchUrl: "fixture:<key>"` naming the record object, with no `submitUrl`. `mode` is `view` on a detail page, which shows the record read-only, `edit` on an edit page and `new` on a new page. On a table's row pages (`formContainer.pages`), a details page whose form is not in `mode: "view"`, or an edit page whose form is, is an issue.
- **Sketch.** `{ "type": "sketch", "options": { "html", "css"?, "height"?, "caption"?, "states"? } }`, with no children, as _Sketches_ says.

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
  - a rating (1 to 5) is a badge, with a tone per value (1 and 2 `error`, 3 `warning`, 4 and 5 `success`), never a cell display;
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
- a `Form`'s `backTo` and `redirectOnSuccess`;
- an `<a href="page:<id>">` in a sketch, as _Sketches_ says.

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
            "mode": "view",
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

A mockup table is read-only: an action is on only when `rowActions` writes it, `add`, `edit` or `details`, each `true` or a row action config such as `{ "rule": { "field": "status", "equals": "draft" } }`. `formContainer` says where the forms open, as in the real `TableView`; **dms-page-design** _Records, forms and links_ picks it:

- `{ "type": "modal", "size"? }`, the default when `formContainer` is left out, `size` `sm` to `5xl` or `full` (default `xl`), or `{ "type": "drawer", "direction"? }`, from the `bottom` (the default) or the `right`: the add, edit and details forms are generated from the table's columns, the details form read-only, as the real `TableView`'s, and saving keeps nothing. `pages.new`, `pages.edit` and `pages.details` take their `displayName` and `description` only.
- `{ "type": "page", "pages": { ... } }`: each action on opens a spec page, `{ "urlSlug": "page:<id>", "customPage": true }`, which holds the custom form or the detail view, a `ResourceForm` in the page's `mode`. The edit and details pages need a `route`.

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
      "tree": [
        {
          "id": "order-details",
          "type": "ResourceForm",
          "options": {
            "mode": "view",
            "fetchUrl": "fixture:orders",
            "fields": [
              { "id": "customer", "label": "Customer", "type": "string" },
              { "id": "total", "label": "Total", "type": "number" }
            ]
          }
        }
      ]
    }
  ]
}
```

### Field groups and sections

A column's `group` and the table's `columnGroups` group the generated forms' fields, as `@Column({ group })` and `@ColumnGroup(id, config)` do: each group `{ label, description?, orientation?, order? }`, keyed by its id, gathered where its first column stands. A generated form has no sections.

```json
{
  "id": "customers-table",
  "type": "TableView",
  "options": {
    "fetchUrl": "fixture:customers",
    "caption": "Customers",
    "columns": {
      "name": { "name": "Name", "type": "string", "order": 1 },
      "email": {
        "name": "Email",
        "type": "string",
        "order": 2,
        "group": "contact"
      },
      "phone": {
        "name": "Phone",
        "type": "string",
        "order": 3,
        "group": "contact"
      }
    },
    "columnGroups": {
      "contact": { "label": "Contact", "orientation": "horizontal" }
    },
    "rowActions": { "add": true, "edit": true, "details": true },
    "formContainer": { "type": "drawer", "direction": "right" }
  }
}
```

A `ResourceForm` or a `Form` takes `sections`, each `{ id, label, description?, icon?, fields }`, with `sectionNav` `side`, `jump` or `none`, and field groups `{ id, label?, fields }` among a section's `fields`:

```json
{
  "id": "customer-details",
  "type": "ResourceForm",
  "options": {
    "mode": "view",
    "fetchUrl": "fixture:customers",
    "sectionNav": "jump",
    "sections": [
      {
        "id": "general",
        "label": "General",
        "icon": "i-ph-identification-card",
        "fields": [
          { "id": "name", "label": "Name", "type": "string" },
          {
            "id": "contact",
            "label": "Contact",
            "fields": [
              { "id": "email", "label": "Email", "type": "string" },
              { "id": "phone", "label": "Phone", "type": "string" }
            ]
          }
        ]
      }
    ]
  }
}
```

## Archive mode

`"archiveMode": true` draws the table as the real one in archive mode: a _Show archived_ toggle, Archive and Edit on the rows not archived, Restore on the archived ones. It draws no Duplicate or Delete. A row is archived when its `isArchived` is `true`; a fixture with no `isArchived` gets its last quarter archived. `archivedCountLabel` is the count while the archived rows show, `{count}` standing for their number. `rowActions.archive` or `rowActions.restore` at `false` turns one off. Either turned on without `archiveMode` is an issue.

```json
{
  "id": "invoices-table",
  "type": "TableView",
  "options": {
    "fetchUrl": "fixture:invoices",
    "caption": "Invoices",
    "columns": {
      "number": { "name": "Number", "type": "string" },
      "total": { "name": "Total", "type": "number" }
    },
    "archiveMode": true,
    "archivedCountLabel": "{count} archived invoices",
    "rowActions": { "edit": true, "details": true },
    "formContainer": { "type": "drawer", "direction": "right" }
  }
}
```

## Connection access

A mockup over a connected database names the connection and its access at the top level, `access` being `read` (the default) or `read-write`, as `builder_mapping` answers it:

```json
{
  "version": 1,
  "title": "CRM desk",
  "data": { "connection": "crm", "access": "read" },
  "pages": []
}
```

With `read`, each option that writes rows is an issue at its pointer, and the save is refused: on a `TableView`, `rowActions` `add`, `edit`, `delete`, `archive`, `restore` or `duplicate` turned on, `archiveMode: true` and `kanban.draggable: true`; a `ResourceForm` in any `mode` but `view`. `rowActions.details` and an action at `false` stay allowed. With `read-write`, or no `data`, nothing is restricted, and the mockup proposes the write actions that **dms-page-design** _Records, forms and links_ decides from each relation's `writes`. **dms-external-database** _Connection access_ says when the access may change.

## Sketches

A sketch is the static HTML and CSS of one custom part, drawn hatched, outlined and labelled _Custom_. Keep it to the element alone; the blocks around it stay blocks.

- `html` is required; `height` is 80 to 3000 px (default 320); `caption` (up to 200 characters) says what the part does.
- It runs in a sandbox with no script: the spec refuses `<script>`, embedding elements, `on*` handlers, `<meta http-equiv>`, `@import`, `javascript:` and `vbscript:` URLs, any `url()` or `src` that is not a `data:` URL, any `href` that is not a `data:` URL, an `#anchor` or a page link, and any `target` the sketch writes.
- **Page link.** `<a href="page:<id>">`, on an HTML `<a>`, links to that spec page; an id no page has is an issue at the sketch's `html`. The link is followed in the viewer's Preview only: while editing, a click on the sketch selects it.
- **States.** `states` maps a name to another markup of the same part, drawn in place of `html` with the same `css`, `height` and `caption`: its empty, error or loading design. A name matches `^[a-z][a-z0-9-]{0,31}$` and is not `default`, which is `html` itself; a sketch holds at most 8 states. Each is checked as `html` is, page links included. The viewer's _State_ picker draws one, and a comment pinned while a state is drawn keeps its `state`.

```json
{
  "version": 1,
  "pages": [
    {
      "id": "orders",
      "title": "Orders",
      "tree": [
        {
          "id": "delivery",
          "type": "sketch",
          "options": {
            "html": "<ol class=\"steps\"><li>Ordered</li><li>Packed</li></ol><a href=\"page:order\">Open the order</a>",
            "css": ".steps{display:flex;gap:12px}",
            "height": 160,
            "caption": "Delivery journey",
            "states": {
              "empty": "<p>No delivery yet.</p>",
              "error": "<p role=\"alert\">The carrier did not answer.</p>"
            }
          }
        }
      ]
    },
    {
      "id": "order",
      "title": "Order",
      "menu": false,
      "parent": "orders",
      "tree": []
    }
  ]
}
```

## Custom pages

A page with `"custom": true` is one whole-page sketch, drawn inside the real layout, and the build splits it into blocks (**dms-best-practices** _Custom pages are blocks_): the sidebar and the page header stay the dashboard's own, fed by its `title`, `icon`, `description` and `headerActions`. It takes the sketch's `html` (required), `css`, `height` (80 to 3000 px, default 800) and `states` at the page's level, under the rules of _Sketches_, and its `tree` is absent or `[]`. An `html`, `css`, `height` or `states` on a page of blocks is an issue. A comment on a custom page is a comment on the page.

```json
{
  "version": 1,
  "pages": [
    {
      "id": "board",
      "title": "Board",
      "icon": "i-ph-kanban",
      "custom": true,
      "html": "<div class=\"lanes\"><section><h2>To do</h2><a href=\"page:card\">Fix the invoice</a></section></div>",
      "css": ".lanes{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}",
      "height": 1200,
      "states": { "empty": "<p>No card yet.</p>" }
    },
    {
      "id": "card",
      "title": "Card",
      "menu": false,
      "parent": "board",
      "tree": []
    }
  ]
}
```

## Sidebar widgets

`sidebar.widgets` sketches up to 10 widgets of the dashboard's sidebar that no module provides yet, such as a plan card or a help box, drawn in order below the dashboard's own widgets on every page. Each is `{ id, title?, html, css?, height? }`: `id` matches `^[a-z0-9][a-z0-9-]{0,63}$` and is unique among the widgets, `title` is its caption, `height` is 80 to 1200 px (default 120), and `html` and `css` follow the rules of _Sketches_. A widget cannot be selected or commented in the viewer: edit it in `spec.json`.

```json
{
  "version": 1,
  "sidebar": {
    "widgets": [
      {
        "id": "plan",
        "title": "Your plan",
        "html": "<div class=\"plan\"><strong>Pro</strong><span>3 of 10 seats left</span></div>",
        "css": ".plan{display:flex;flex-direction:column;gap:4px;padding:10px}",
        "height": 96
      }
    ]
  },
  "pages": []
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

`fixture:orders` then reads 8 rows. A value that must read true (a KPI headline, a total another page repeats) is a plain JSON fixture, read through `fixture:<key>` like generated rows; keep series and item lists out of `static*` options, so each block's options stay flat. A hand-written date stays as written.

## Fixture shapes

A block reads the value of its `fixture:<key>` as written, so the value has the block's own shape. A `KpiCard` or `ChartCard` fixture's `delta` and `previousValue` show on the built page only when it has a `PeriodSelector`: give them only on a page that has one, and leave them out elsewhere. Only a `TableView` reads an array of rows (and so a `$generate` fixture); every other block below reads an object, and an array there draws no data.

| Block                                                                           | Shape of the fixture                                                                                                                                                                                 | Example                                                                                                                    |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `KpiCard`                                                                       | `{ value, delta?, previousValue?, sparkline?, caption? }`                                                                                                                                            | `{ "value": 48210, "delta": 12.4, "previousValue": 42900, "sparkline": [5, 6, 8] }`                                        |
| `ChartCard` (its chart child reads it)                                          | `{ value?, delta?, previousValue?, series, comparisonSeries? }`, `series` a list of `{ name, data }`, never bare `{ x, y }` points; a donut or pie child draws the first series, `x` the slice label | `{ "value": 1512, "series": [{ "name": "Orders", "data": [{ "x": "Web", "y": 928 }, { "x": "Mobile app", "y": 354 }] }] }` |
| Chart blocks (`ChartArea`, `ChartDonut`, …) on their own, outside a `ChartCard` | `{ series }`: named series, or one `{ x, y }` point per group; a donut or pie reads one series, `x` the slice label                                                                                  | `{ "series": [{ "x": "Paid", "y": 62 }, { "x": "Pending", "y": 25 }, { "x": "Refunded", "y": 13 }] }`                      |
| `TopListCard`                                                                   | `{ items }`, each `{ id, title, value, description?, valueLabel?, delta?, sparkline?, icon?, avatar?, to? }`                                                                                         | `{ "items": [{ "id": "p1", "title": "Pro plan", "value": 320, "description": "Subscriptions" }] }`                         |
| `StatGroup`                                                                     | `{ items }`, each `{ eyebrow, value, detail?, detailTone?, icon?, tone?, to? }`                                                                                                                      | `{ "items": [{ "eyebrow": "Open orders", "value": 42, "detail": "+5 today", "icon": "i-ph-receipt" }] }`                   |
| `TableView`                                                                     | an array of rows keyed by the column fields, each with an `_id` (or `id`); `$generate` fits                                                                                                          | `[{ "_id": "o1", "customer": "Acme", "total": 120, "status": "paid" }]`                                                    |
| `ResourceForm`                                                                  | one record object keyed by the form's field ids                                                                                                                                                      | `{ "customer": "Acme", "total": 120, "status": "paid" }`                                                                   |
| `ActivityFeed`                                                                  | `{ items, count? }`, each `{ title, date?, time?, meta?, detail?, icon?, tone?, unread?, to? }`                                                                                                      | `{ "items": [{ "title": "Order paid", "date": "2026-01-06T09:30:00Z", "icon": "i-ph-check" }] }`                           |
| `KeyValueList`                                                                  | `{ items }`, each `{ label, value, type?, detail?, tone?, to?, currency? }`                                                                                                                          | `{ "items": [{ "label": "Plan", "value": "Pro" }] }`                                                                       |
| `NavCardGrid`                                                                   | `{ items }`, each `{ title, icon, to, description?, state?, stateTone?, tag?, readout? }`                                                                                                            | `{ "items": [{ "title": "Orders", "icon": "i-ph-receipt", "to": "page:orders" }] }`                                        |
| `Meter`                                                                         | `{ value, max?, segments?, hint?, valueLabel? }`                                                                                                                                                     | `{ "value": 7, "max": 10, "hint": "Seats used" }`                                                                          |

## Writing in steps

A mockup is written live, in saves small enough to show a change each. A save redraws the preview in under a second.

1. Create the mockup empty, an existing app's included, with its menu sections when it has them: `mockup_write_spec` with `{ "mockup": "<name>", "spec": { "version": 1, "title": "Order desk", "source": "claude-code", "categories": [{ "id": "sales", "title": "Sales", "icon": "i-ph-storefront" }], "pages": [] } }`. Each page added then names its `category`.
2. To change an existing page, `mockup_from_page` with `{ "pageRef": "/orders", "into": "<name>" }` converts it into the mockup at its real section and order (`replace: true` converts again a page already in it); never copy it by hand. Otherwise add a page as a skeleton, its blocks titled and its data generated: `mockup_patch_spec` with `{ "mockup": "<name>", "patch": [{ "op": "add", "path": "/pages/-", "value": { "id": "orders", "title": "Orders", "fixtures": { "orders": { "$generate": { "fields": { "customer": "company", "total": { "money": [40, 900] } } } } }, "tree": [{ "id": "orders-table", "type": "TableView", "options": { "fetchUrl": "fixture:orders", "caption": "Orders", "columns": { "customer": { "name": "Customer", "type": "string" }, "total": { "name": "Total", "type": "number" } } } }] } }] }`.
3. Fill a section: one patch of 2 or 3 operations on the blocks that belong together, `replace` on a node's `options` or `add` at `/pages/<i>/tree/-`, `<i>` the page's index.

A patch applies whole or not at all: a failed one leaves the spec as it was, so fix it and send it again. An input refused as not parseable JSON never reached the mockup: split it into two smaller patches instead of sending it again. After an `add` or `remove` that shifts a node, re-read the pointers you still use with `mockup_read_spec` (`{ "mockup": "<name>", "path": "/pages/0/tree" }`), never with a `test` operation or a temporary key.

## Validation

`mockup_write_spec` with `{ "mockup": "<name>", "spec": { … } }`, or `mockup_patch_spec` with `{ "mockup": "<name>", "patch": [ RFC 6902 operations ] }`, validates the resulting spec, writes `spec.json` when it holds, and answers `{ ok, errors }`, each error `{ path, message }`. A refused spec answers `ok: false`; a bad name, a failed patch operation or a missing target answers a tool error. Nothing is written in either case. Without that tool, `GET /api/mockup/<name>` answers the compiled state: `pages`, a `revision` that grows on each good read, and `issues`, each `{ path, message }` with `path` a JSON pointer into `spec.json` (`/pages/0/tree/1/children/0/options/title`). The spec validates when `issues` is empty. A node with bad options still draws what it can, so a page that looks right can still hold issues: read them. An issue that names a value outside an enum's allowed values lists them: use the closest one, say so in your reply (a badge tone `pink` becomes `warning`), and ask the user only when none is close.

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
