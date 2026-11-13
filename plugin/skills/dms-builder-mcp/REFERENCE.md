# dms-builder-mcp reference

## Data resources (Table + DataAPI)

A **resource** is the data layer a table/form displays: a Database `Table`+`Model`
and a matching `DataAPI` controller at `/api/<name>`, generated as decorator classes
kept in sync — never hand-write them. The resource ops (and the `controller` binding
they feed) require a builder engine version that implements them: if one returns
`request_failed` (the host answered `unknown_op`) or `builder_unavailable`, the
installed engine doesn't support it — explain the limitation instead of retrying.

1. **Read first.** `builder_list_resources`; `builder_resource_structure <ref>` for
   fields + `version` hash. Hand-edited or relation fields come back `opaque` —
   the builder tools cannot reconfigure those.
2. **Create** with `builder_create_resource` (`name`, `fields`, optional `seeds` — each
   seed row supplies its own `_id`; never declare `_id`, it is auto-managed). It
   scaffolds a `<name>/{database,data-api,index}.ts` folder and wires the nearest barrel.
   - `location` — where the folder goes (omit for `src/<name>/`): a dir string
     relative to the src root, `{ category: <CategoryRef> }` (mirrors that category's
     page placement; prefer for a resource shared by one section), or
     `{ page: <PageRef> }` (nests beside that page; prefer for a one-page resource).
     Pass exact refs from `builder_list_pages`, never guess.
   - `routes` — which DataAPI endpoints to expose (omit for the full set): `list`,
     `get`, `create`, `edit`, `delete`, `select` (relation-picker options), `archive`
     (soft delete + undo), `export`. Pass a subset whenever a resource is not a full
     CRUD table — a singleton edit form wants `["get","edit"]`, a read-only listing
     `["list","get"]` — and keep the view in sync: drop the `TableView` `rowActions`
     whose routes you left out, or bind a `Form` instead for a singleton.
3. **Edit fields** with `builder_add_field` / `builder_configure_field <ref>#<field>` /
   `builder_remove_field`; field name is immutable (rename = remove + add). **Delete**
   with `builder_delete_resource` (refused in Safe mode): removes the files, unwires the barrel, and by default
   clears the resource's database table so a name reuse re-seeds cleanly rather than
   showing stale rows (`keepData: true` to keep them).
4. **Fields are semantic aspects, not decorators:** `dataType`, `label`, `listable`
   (default true), `searchable`, `sortable`, `filterable`, `access`
   (`read`|`readwrite`, default `readwrite`), `required`, `indexed`, `order`. Names
   colliding with a DataController route or model property (`_id`, `model`, `get`,
   `list`, `select`, `count`, `new`, `edit`, `delete`, `archive`, `restore`,
   `exportStart`, `exportStatus`, `exportDownload`) are rejected with `invalid_config`.

**Displaying a resource on a page is a builder step**: create and populate the
resource, then `builder_add_block` a `TableView` with `controller` = the resource `ref`
and display options in `config`. Relation columns work via `$ref` (see
"DataType, component and reference values" in SKILL.md).

## Queries (computed data a DataAPI can't serve)

A **query** is a derived-data endpoint on a _page_: a GET route serving an aggregate or one
point per group, backed by a generated method on the resource's model. The DataAPI serves
rows; a query serves what a KPI card, a chart or a ranked list reads.

1. **Read the templates.** `builder_query_templates` returns each template's `id`, what it
   computes, its `output` kind, and its `params` schema. Never guess an id or a param key —
   an unrecognised key is rejected.
2. **Add the query** with `builder_add_query` on the page that will display it (not the
   resource's page). It compiles the template into a model method and a page route in one
   atomic op and returns `{ query, route }`.
3. **Wire the block to it.** `route` is the full URL — pass it as the card's `fetchUrl`.
   There is no reference sentinel for queries yet, so wire the returned string; if you later
   move the endpoint, update the card in the same turn.
4. **Read back** with `builder_page_structure` — a page's `queries` array reports each one's
   `name`, `endpoint`, `resource`, `modelMethod`, `template` and `params`.
5. **Reconfigure / remove** with `builder_configure_query` (only the keys you patch change)
   and `builder_remove_query` (drops the route, and the model method once nothing calls it).

**Params** are documented by each template's own `params` schema from
`builder_query_templates` — every key, every value shape, down to the enums. Read it rather
than guessing; an unrecognised key is rejected.

The one idea worth stating here, because it is what makes a query reusable: a filter value
can be **bound to a request parameter** instead of baked into the chain
(`{ "$param": { "name": "min" } }`), so one query answers `?min=25` and `?min=100`
rather than needing a query per threshold. Bake the value in when it is part of what the
query _means_ (in-stock rows), bind it when the caller chooses (a price threshold). The
`name`/`in` you give a `$param` shape the route, not the model: the route reads the value
from that source and hands it to the model method, whose own parameter is named for you.

```json
{
  "page": "/catalog/books",
  "name": "inStockValue",
  "resource": "book",
  "template": "aggregate",
  "params": {
    "op": "sum",
    "field": "price",
    "where": [{ "field": "inStock", "op": "eq", "value": true }]
  }
}
```

→ `{ "query": "/catalog/books@inStockValue", "route": "/catalog/books/stats/in-stock-value" }`,
serving `{ "value": 110.48 }`.

**What you don't have to manage.** The route is auth-gated by the page, automatically —
a query is never public. Queries wanting the identical chain share one model method, and a
query whose chain diverges from a method others still use gets its own rather than editing
theirs — which is why a `modelMethod` may not match its query's name (`inStockCount2`). All
of that is handled for you: reconfiguring or removing one query never changes what another
page's query returns.

**Endpoints are a default, not a namespace.** `/stats/<kebab-name>` unless you pass
`endpoint`; any path is fine as long as it starts with `/` and the page doesn't already
serve it. One coupling: a `$param` with `in: "param"` reads a path segment, so its
`endpoint` must declare a matching `:name` (`in: "query"`, the default, needs nothing).

**Opaque queries.** Read-back is purely structural: the builder recognizes a query by its
shape, so anything it can parse it can edit. A query is opaque **only when it no longer
parses** — not merely because a human touched it. An in-grammar edit (a changed threshold, an
added filter) is simply re-read and stays editable. `opaqueReason` is `unparseable_route` (the
GET wrapper isn't the `return { value: await model.m(...) }` shape) or `unparseable_chain` (the
model method isn't a chain any template accepts — hand-written differently, edited out of the
grammar, or emitted by a newer builder). `builder_configure_query` refuses an opaque query with
`opaque_target`, but it stays visible and `builder_remove_query` still works: the builder can
always remove what it cannot edit. To reshape an opaque query, edit its code with dms-pages (outside Safe mode), then `builder_refresh` to clear the builder's caches — or bring
its body back within the chain grammar and the builder picks it up again.
