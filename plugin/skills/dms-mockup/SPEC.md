# Mockup file formats

The formats of `mockups/<name>/spec.json` and `mockups/<name>/annotations.json`, for **dms-mockup** and **dms-mockup-build**. `<name>` matches `^[a-z0-9][a-z0-9-]{0,63}$`, and so does every page `id`. Never name a mockup `schema`: `/api/mockup/schema` answers the schema, so that mockup's routes never answer.

## Schema

`@antelopejs/dms` ships the JSON Schema of the spec at `node_modules/@antelopejs/dms/data/mockup-spec.schema.json`, and a running DMS serves the same schema, built from the blocks of the installed modules, at `GET /api/mockup/schema`. Point the spec's `$schema` at the file, so an editor checks it as the user types. When the schema and this page disagree, the schema wins. `node_modules/@antelopejs/dms/data/mockup-example/spec.json` is a two-page spec that compiles with no issue: model a new spec on it.

## spec.json

```json
{
  "$schema": "../../node_modules/@antelopejs/dms/data/mockup-spec.schema.json",
  "version": 1,
  "title": "Order desk",
  "pages": [
    {
      "id": "orders",
      "title": "Orders",
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

- `pages`: 1 to 50 pages. `options` is optional: `theme` (`light` or `dark`), `locale`, `padding` (default `true`).
- `fixtures`: a key (`^[A-Za-z0-9_-]{1,64}$`) to any JSON value, the data the page's blocks read.
- `tree`: the page's blocks, top to bottom, in the `DmsBlockPreview` tree format below.

The envelope is strict: a key this page does not list is an issue.

## Nodes

A node is `{ type, options?, children? }`; a child also takes `id`, `slot` (a `Tab` or `Card` slot) and `colSpan` (inside a `GridRow`). `type` is a block type of the catalog (it wins over a `componentName`) and `options` its factory options, with two exceptions:

- An option that holds a block, such as a `ChartCard`'s `chart`, is a child whose `id` is the option's name.
- A `Form` with `sections` keeps every field in `fields`, and each section lists its fields by id in `fieldIds`.

Name every child with an `id`: the builder and the roles editor key blocks by name. A block that only shows a figure can take its `static*` options (`staticValue`, `staticDelta`) in place of a fixture.

- **Fixture reference.** Any string option of the form `fixture:<key>`, at any depth, reads that key of the page's `fixtures`. Use it for every `fetchUrl`, so the block draws data with no route.
- **`TableView`** takes the options of `TableView.fromSource`: `fetchUrl: "fixture:<key>"` naming an array of rows, and `columns` keyed by row field, each with its `name` and its `type`, a data type id (`string`, `number`, `date`, `boolean`, `select`, …). Paging, search and sort work over the fixture; filters (tabs, quick filters, `queryParamFilters`) draw but do not narrow the rows, and a column takes no `display`.
- **`ResourceForm`** takes its `fields` and `fetchUrl: "fixture:<key>"` naming the record object, with no `submitUrl`.
- **Sketch.** `{ "type": "sketch", "options": { "html", "css"?, "height"?, "caption"? } }`, with no children: the static HTML and CSS of one custom part, drawn hatched, outlined and labelled _Custom_. `height` is 80 to 1200 px (default 320); `caption` (up to 200 characters) says what the part does. It runs in a sandbox with no script: the spec refuses `<script>`, embedding elements, `on*` handlers, `<meta http-equiv>`, `@import`, `javascript:` and `vbscript:` URLs, and any `url()`, `src` or `href` that is not a `data:` URL or an `#anchor`. Keep it to the element alone; the blocks around it stay blocks.

## Validation

`mockup_write_spec` with `{ "mockup": "<name>", "spec": { … } }` validates the spec, writes `spec.json` when it holds, and answers `{ ok, errors }`. Without that tool, `GET /api/mockup/<name>` answers the compiled state: `pages`, a `revision` that grows on each good read, and `issues`, each `{ path, message }` with `path` a JSON pointer into `spec.json` (`/pages/0/tree/1/children/0/options/title`). The spec validates when `issues` is empty. A node with bad options still draws what it can, so a page that looks right can still hold issues: read them.

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
