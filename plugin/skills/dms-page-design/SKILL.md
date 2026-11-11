---
name: dms-page-design
description: Designs AntelopeJS DMS pages that show data. Use when building or changing an analytics, stats or dashboard page or a table page, choosing a chart or a KPI for some data, picking a page's period, naming a page and its icon, or deciding how a table displays (badges, prices, relation labels, status tabs, saved views, kanban, cards, footer totals, KPI cards above the table).
---

# Designing data pages

A data page answers the questions its owner asks about the data. Each block answers one
question, and its title says which ("Revenue per month", "Top 10 countries by revenue").
Build every page from the questions, the shapes below and the checks at the end, in that
order, so that two runs over the same data produce the same page.

This skill decides **what** to build; `dms-best-practices` still holds. The tools and their
arguments are in `dms-builder-mcp`, the code in `dms-pages`.

## Pick the path

- **The builder MCP answers** (`builder_catalog` is among your tools, see `dms-builder-mcp`
  _Detect what the project has_): every step below applies as written.
- **No builder MCP**: the shapes, layout, period, names and table features below still decide
  the page. Write it with `dms-pages`: a query becomes a route on the page
  (`pageRoutePath`), the period arrives as the request's `from` and `to`, and the table
  features are `TableView` options. There is no preview call: before you write a block, read
  its answer from the route (or the data it aggregates) for the default period, and apply the
  checks of _Build a page in one call_ to that answer. Open each page in the browser at the end.

## Pick the block from the data's shape

| The data                                                  | Block                                                          | Query                                                                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A measure or a row count over time                        | `ChartCard` around `ChartArea`, full width                     | `series`, `groupBy` the time axis, `bucket`, `response: "card"`                                                                                  |
| A second series over time (orders beside revenue)         | `ChartCard` around `ChartColumn` or `ChartLine`                | as above                                                                                                                                         |
| A column with 2 to 6 values (status, segment, media type) | `ChartCard` around `ChartDonut`, with `showSeriesLegend: true` | `series`, `groupBy` the column, `response: "card"`                                                                                               |
| A column with 7 or more values, a top N                   | A bare `ChartBar`, or a `TopListCard` with `showBar`           | `series`, `orderBy: "measure"`, `direction: "desc"`, `limit: 10`; `response: "card"` for the chart, `"items"` for the list                       |
| One figure with its trend (revenue, orders, customers)    | `KpiCard` with `showDelta`, `showSparkline`                    | `series` by the time axis (never `count` or `aggregate`, which answer no previous period and no sparkline), `response: "value"`, `compare: true` |
| Numbers used as categories (a rating 1 to 5, a year)      | `ChartCard` around `ChartColumn` with `xaxisType: "category"`  | `series`, `groupBy` the column                                                                                                                   |
| A status column on a table                                | Tabs on the `TableView`, plus a donut on the analytics page    | see _Tables_                                                                                                                                     |

- Put a chart in a `ChartCard`: it adds the headline figure. Through the builder its `chart` is a
  nested block value, `{ "$block": { "type": "ChartArea", "config": {} } }`. A horizontal
  `ChartBar` stays bare: inside a card its category labels read `NaN`.
- The `response` must match the block: `card` for a `ChartCard` or a bare chart, `value` for a
  `KpiCard`, `items` for a `TopListCard`. Any other pairing draws nothing.
- Compare periods on KPI cards and top lists (`compare: true`), never on a chart over time:
  the previous period's buckets are other categories, so they draw beside the period instead
  of under it.
- Sum a measure that adds up (a total, a quantity). Count rows for everything else. Never sum
  a unit price or a rate.
- Format money with `valueFormat: "currency"` and a `currencyCode` only when the data names its
  currency (a currency column, a comment). Otherwise use `valueFormat: "number"`: the default
  currency is the euro, and a wrong symbol is worse than none.
- Grouping by a foreign key shows ids. Group by the relation's own columns only; a breakdown by
  a related entity's name goes under _Not possible yet_ in your report.

## Lay out an analytics page

Add the blocks in this order. Every analytics page has items 1 to 4.

1. A `PageToolbar` holding a `PeriodSelector`, first on the page (see _Period_).
2. One `GridRow` of 3 or 4 `KpiCard`s, each bound to the period.
3. The main series over time, a full-width `ChartCard`.
4. A `GridRow` of two breakdowns: a bare `ChartBar` for the largest category column, and a
   `ChartDonut` or a `ChartColumn` for another column or a second measure over time.
5. A `TopListCard` for a second category column, when one exists.

Use at least 3 different chart kinds on the page when the data has the shapes for them. The
chart kinds are `ChartArea`, `ChartLine`, `ChartColumn`, `ChartBar` and `ChartDonut`; KPI cards
and top lists are not chart kinds. Use a second kind before you repeat one. A page of KPI cards
alone is never done.

Every card binds the page's period: `periodScope: "page"` on the block, and on its query
`where` filters on the time axis bound to the request,
`{ "field": "<time axis>", "op": "ge", "value": { "$param": { "name": "from" } } }` and
`"le"` with `"to"`. A card over a relation with no time axis stays unbound.

## Period

The default period is computed from the data's real dates, never assumed. Read the time
axis's `range` from the analysis, or profile that column. Then take the first rule that holds,
counting from today:

1. The data reaches into the last 30 days and spans at least 90 days: `last-90-days`,
   compared with `previous-period`.
2. The current year holds at least 3 months of data: `ytd`, compared with `previous-year`.
3. Last calendar year holds data: `last-year`, compared with `previous-year` when the year
   before it holds data too, else `none`.
4. Otherwise bind nothing to a period, leave the selector out, and say so in your report.

Set it on the selector: `defaultPreset`, `defaultComparison`, `presets` (the default, any
other preset whose window holds data, and `custom`) and `comparisons`. Leave `all` out of
`presets`: it sends no `from` or `to`, and every bound query fails without them.

Pick the bucket so the default window holds 8 to 31 points: `day` up to 31 days, `week` up to
about 7 months (a 90-day window is 13 weeks), `month` beyond. A time chart with fewer than 8 points reads as a curve with no story. An axis
chart (area, line, column, bar) over time takes `xaxisType: "category"`, unless a preview's
`x` values are epoch milliseconds, which take `xaxisType: "datetime"`. A donut or pie takes
no axis option.

## Name every page

Every page you create or map gets a title, an icon and a description; a raw relation name is
never a title.

- **Title**: what the owner calls the content, in their words and plural for lists ("Support
  tickets", not "support_ticket"; "Sales", not "orders stats"). Drop technical prefixes and
  suffixes (`tbl_`, `_v2`). An analytics page is named for the area it covers ("Sales",
  "Customers", "Overview"). Two pages never share a title: when a table page is already
  "Customers", its analytics page is "Customer insights".
- **Icon**: a Phosphor icon, `i-ph-<name>`, that a reader links to the content at a glance
  (`i-ph-users` for people, `i-ph-package` for goods, `i-ph-receipt` for invoices,
  `i-ph-chart-line-up` for an analytics page). Two pages in one menu never share an icon.
- **Description**: one sentence on what the page holds or answers, from the data
  ("Every order with its payment and shipping status").
- **Order**: the main analytics page first (`order: 0`), then the most used lists. Keep a
  table page's order at 100 or more unless it must sit among the dashboards.

Set them with `builder_create_page` on new pages, per resource in `builder_map_resources`
(`title`, `icon`, `description`, `order`), or with `builder_configure_page` afterwards.

## Tables

A table page is a working tool: the reader finds a row, sees its state, and acts. Read the
relation's columns with `builder_resource_structure` (and the proposal's profiles when there
is one), then give the table every feature its data supports, and none it does not. Each
rule below names the shape that earns the feature; decide from the columns and their values,
never from the relation's name.

**Columns.** A primary key gets no display and is never a row's label. A boolean keeps its
default display (no badge). A column that a view filters on, a tab splits on, or a footer
`where` reads must be `filterable` in the mapping; one that a view sorts on, `sortable`.
Keep the Builder's proposed displays unless the column's meaning says otherwise:
a column with few distinct values (a status, a type, a channel, a priority, under about 12
values) shows coloured badges, one tone per value (green for done or good, amber for waiting,
red for failed or lost, grey for closed or neutral); free text (a subject, a note, a name)
never shows badges, even when the sample repeats. A money column shows a price. A relation
column (a `customer_id`, an `order_id`) is titled by its target ("Customer") and shows the
target's label, never the raw number: map the target relation with a label first, then send
the relation column as a relation. Raw id columns stay off the list. Send each field's `display` and the relation's `tabs` in `builder_map_resources`.

**Tabs.** A single-choice column with 2 to 6 values that splits the rows into states people
work through (a status, a stage) gives one tab per value after "All". One tab column per table.

**Saved views** (`views`). Add 2 to 4 views when a recurring question is a fixed filter on the
table: rows waiting for action (a status that means "to do"), recent rows (a date
`greater_than` `{{now-7d}}` or `{{now-30d}}`), rows assigned to the reader (an owner column
equal to `{{user.id}}`), outliers worth a look (a stock or a score under a threshold read from
the profile, a high amount). Each view has a short label that states the question
("Awaiting shipment", "This week", "Low stock"), a sort that puts the first row to handle on
top, and `count: true` when the number itself matters. Keep views and tabs from repeating each
other: views for questions that cross columns or dates, tabs for the plain split by state.

**Display modes.** Offer another display when the data reads better that way, and make it the
default only when it is the main way to work the table:

- **Kanban** (`kanban.groupBy`) when a single-choice status or stage column describes a flow
  rows move through, with 3 to 7 values and rows that are handled one by one (tickets, tasks,
  deliveries, applications). Not for a column that only classifies (a country, a category).
  Kanban works on a read-only table: it shows the flow without moving cards. Leave `draggable`
  off unless the table is editable.
- **Cards** (`cards.fields`) when each row is an entity people recognise by a few fields
  rather than compare across many columns (a product, a person, a place): 3 to 5 fields, the
  label first, then the badge and the key figure.
- **Grouped** (`grouped`) when rows are read by day or week (a log, bookings, events): group by
  the main date column with `by: "day"` or `"week"`.

**Footer totals** (`footer.summary`). When the table has an additive money or quantity column,
show its `sum`, and a `count` of rows; add a `count` with a `where` on a status value when that
number is what the reader checks ("Refunded"). Never sum a unit price, a rate or a score.

**KPI cards above the table.** When the relation has a measure or a state worth tracking (an
amount, rows waiting, a share of a status), put a `GridRow` of 3 or 4 `KpiCard`s above the
`TableView`, each answering one question the table's reader asks ("Revenue this month",
"Awaiting shipment", "Refund rate"), with the series and `compare` rules above. A lookup list
(a reference table, tags, settings) gets none.

Set displays, views and footer per resource as `tableOptions` in `builder_map_resources`, or on
an existing page with `builder_configure_table_view`. A refused choice comes back as
`invalid_config` with the setting it names: fix that one and send again.

## Build a page in one call, and check it first

Build every page, or every set of blocks added to a page, with one `builder_compose_page` call:
the blocks as an ordered tree (containers carry `children`), each data block with its `query`
inline (same fields as `builder_add_query`). It writes everything at once and typechecks once.
Use the single-block tools only for a small fix afterwards.

1. Call it first with `"preview": true` and the default period's `from` and `to` as `args`.
   It writes nothing and answers each block's status. Change or drop every block marked
   `empty`, `zero` or `error` (another measure, the whole history for a card that should not
   follow the period), then preview again. Never write a block over an empty answer.
2. Call it again without `preview` to write. A refusal lists every refused block by pointer:
   fix those and call again; nothing was written.
3. KPI cards above a table: `pageRef` of the table page, `placement: { "before": "table" }`,
   and the `GridRow` of `KpiCard`s as `blocks`. A later remap keeps them.
4. After the last page, check each page as `dms-builder-mcp` _Verify_ says, and fix any block
   that shows no data or an error.
5. Your report names every block that still shows no data, and why.

The page is done when every block has data in the default period, the page meets the
layout above, it has a title, an icon and a description, and each table uses every feature
its data supports.
