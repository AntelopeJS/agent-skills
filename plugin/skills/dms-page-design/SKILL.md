---
name: dms-page-design
description: Designs AntelopeJS DMS pages that show data. Use when building or changing an analytics, stats or dashboard page or a table page, choosing a chart or a KPI for some data, picking a page's period, naming a page and its icon, grouping an app's pages into menu sections, giving a list its details view and forms, linking pages together, or deciding how a table displays (badges, prices, relation labels, status tabs, saved views, kanban, cards, footer totals, KPI cards above the table).
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
  features are `TableView` options. There is no preview call: before you write a block, call
  its route for the default period and check only whether it answers no rows, zeros or an
  error, as _Build a page in one call_ checks a preview's status. Open each page in the browser at the end.

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
- Format money with `valueFormat: "currency"` and a `currencyCode` only when the schema names
  its currency (a code in a column's comment or name, such as `total_usd`) or the integrator does. A
  `currency` column says the rows carry a currency, never which one: ask the integrator. Otherwise use `valueFormat: "number"`: the default
  currency is the euro, and a wrong symbol is worse than none.
- Grouping by a foreign key shows ids. Group by the relation's own columns only; a breakdown by
  a related entity's name goes under _Not possible yet_ in your report.

## The analytics dashboard

An app over an external database always has an analytics dashboard, asked for or not: every
plan, mockup and build over that data proposes and builds it.

- It holds `KpiCard`s and charts over real aggregates of the relations: sums of their measures
  and row counts, over their time axis and their category columns. A build reads each one
  through a query on a mapped relation, never a `static*` value; a mockup's fixtures stand for
  those queries.
- It is laid out as _Lay out an analytics page_ says and sits first in the menu (`order: 0`),
  outside every section.
- An app of 3 or more sections may also give each section a dashboard of its own, first in
  that section.

An app over a database is not done without that dashboard, or with one whose figures are not
aggregates of the data.

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

You never read the data's dates: the analysis and the profiles give a time axis, never its
first or last date. Set the selector to fixed presets, counted from today: `defaultPreset`
`last-90-days`, `defaultComparison` `previous-period`, `presets` `last-30-days`,
`last-90-days`, `ytd`, `last-year` and `custom`, and `comparisons` `previous-period`,
`previous-year` and `none`. Leave `all` out of `presets`: it sends no `from` or `to`, and every
bound query fails without them.

When the preview marks every bound block `empty` over the default window, the data may stop
earlier: preview again with `last-year` as the default, compared with `none`. When that is
empty too, bind nothing to a period, leave the selector out, and say so in your report. A
period the user names wins over both.

Pick the bucket so the default window holds 8 to 31 points: `day` up to 31 days, `week` up to
about 7 months (a 90-day window is 13 weeks), `month` beyond. A time chart with fewer than 8 points reads as a curve with no story. An axis
chart (area, line, column, bar) over time takes `xaxisType: "category"`: a bucketed series
answers its periods as labels. Use `"datetime"` only for a route you wrote yourself that
answers timestamps, and in a mockup, where a chart grouped by week or date (a `ChartBar` of
revenue per week) takes `xaxisType: "datetime"` with a `datetimeFormat` (`dd MMM`), plus
`valueFormat: "currency"` and `currencyCode: "EUR"` for the values only: the category axis
never takes the value format, or its week labels read as amounts. A donut or pie takes no axis option.

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

## Group pages into sections

An app of 6 or more pages is grouped into 2 to 5 **sections** by job, each titled in the
owner's words with an icon of its own: Sales (Orders, Payments, Coupons), Catalog (Products,
Categories), Customers (Customers, Reviews, Support tickets). Each section holds 2 to 6 pages;
a page with no partner joins the nearest section. The main dashboard sits on top, outside every
section: it stays in the category it is created in. A section's own dashboard (_The analytics
dashboard_) sits first in its section. An app of fewer pages has no sections. You decide the sections; the user edits them.
A page that belongs in a section the project has already goes there: in a mockup, a section of
that exact title, which the viewer draws as the app's own.

A section is a menu category: `builder_create_category` (`name`, `displayName`, `icon`,
`order`, `module`, and `section: true` for a sidebar section, a `RootCategory`) answers its `ref`, which `builder_create_page` takes as `category`,
`builder_map_resources` per resource as `category` (create the section first, in the tables'
`module`), and `builder_configure_page` in `{ "category": "<ref>" }` to move a page there.

## Tables

A table page is a working tool: the reader finds a row, sees its state, and acts. Read the
relation's columns with `builder_resource_structure` (and the proposal's profiles when there
is one), then give the table every feature its data supports, and none it does not. Each
rule below names the shape that earns the feature; decide from the columns' types, traits and
distinct counts, never from the relation's name. You never read a row's values: a value you
name comes from the schema, as a native enum's label.

**Caption.** Every table has a caption, the title above its rows: its page's title for the
page's main table, the question it answers otherwise ("Orders awaiting shipment").

**Columns.** A primary key gets no display and is never a row's label. A boolean keeps its
default display (no badge). A column that a view filters on, a tab splits on, or a footer
`where` reads must be `filterable` in the mapping; one that a view sorts on, `sortable`.
Keep the Builder's proposed displays unless the column's meaning says otherwise:
a column with few distinct values (a status, a type, a channel, a priority, under about 12
values) shows coloured badges. Leave its `display` out: the Builder proposes the badge, its
items and their tones itself. Send a badge only over a native enum, one item per label the
schema declares, one tone per label (green for done or good, amber for waiting, red for failed
or lost, grey for closed or neutral). Free text (a subject, a note, a name) never shows badges,
even when it has few distinct values: send `"display": null` on it when the Builder proposed
one. A money column shows a price only in a known currency: a price with no `currency` draws euros.
Leave its `display` out when the price the Builder proposes carries a `currency`. When it
carries none, or the Builder left the column plain, send
`{ "kind": "price", "currency": "<code>" }` with a code the schema or the integrator names;
with none, send `"display": null`, which leaves it a number. A relation
column (a `customer_id`, an `order_id`) is titled by its target ("Customer") and shows the
target's label, never the raw number: map the target relation with a label first, then send
the relation column as a relation. Raw id columns stay off the list. A `display` you do send, and the relation's `tabs`, go in `builder_map_resources`.
A cell display (`mono`, `two_line`, `identity`, `progress`...), `group`, `isVisible`, `size` and `cellWrap` go in the same `fields`, else `builder_configure_field`: no code needed, Safe mode included.

**Tabs.** A single-choice column with 2 to 6 values that splits the rows into states people
work through (a status, a stage) gives tabs when the column is drawn as a badge, by the
Builder or over a native enum: send `tabs: { "column": "<column>" }`, and the table draws
"All", then one tab per item of the column's badge. You name no value. When the mapping answers
`display_dropped` for that column, the table has no tabs: say so in your report. One tab
column per table.

**Saved views** (`views`). Add 2 to 4 views when a recurring question is a fixed filter on the
table: recent rows (a date `greater_than` `{{now-7d}}` or `{{now-30d}}`), rows assigned to the
reader (an owner column equal to `{{user.id}}`), rows waiting for action (a native enum label
that means "to do"), and outliers worth a look as a sort, with no threshold (the lowest stock
first, the highest amount first). Each view has a short label that states the question
("Awaiting shipment", "This week", "Low stock"), a sort that puts the first row to handle on
top, and `count: true` when the number itself matters. Keep views and tabs from repeating each
other: views for questions that cross columns or dates, tabs for the plain split by state.

**Display modes.** Offer another display when the data reads better that way. The default
display (`defaultDisplay`) is the kanban for a status workflow, the cards for a catalogue whose
rows carry an image, and the table otherwise:

- **Kanban** (`kanban.groupBy`) when a single-choice status or stage column drawn as a badge
  (by the Builder or over a native enum) describes a flow
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
show its `sum`, and a `count` of rows; add a `count` with a `where` on a native enum label when
that number is what the reader checks ("Refunded"). Never sum a unit price, a rate or a score.

**KPI cards above the table.** When the relation has a measure or a state worth tracking (an
amount, rows waiting, a share of a status, the last two over a native enum label), put a `GridRow` of 3 or 4 `KpiCard`s above the
`TableView`, each answering one question the table's reader asks ("Revenue this month",
"Awaiting shipment", "Refund rate"), with the series and `compare` rules above. A lookup list
(a reference table, tags, settings) gets none. A card's change figure (`delta`, `previousValue`) shows only on a page with a `PeriodSelector`: on a table page without one the card shows no change figure; add a `PeriodSelector` only when the user wants change figures.

Set displays, views and footer per resource as `tableOptions` in `builder_map_resources`, or on
an existing page with `builder_configure_table_view`. Through `builder_configure_table_view`
a refused choice comes back as `invalid_config` with the setting it names (for an enum value, the allowed ones: take the closest yourself and mention it in your reply, as **dms-builder-mcp** _Errors_ says): fix that one and
send again. Through `builder_map_resources` it comes back as a `page_not_written` warning.

## Records, forms and links

An app clicks through: from a figure to its rows, from a row to its record, and back.

- **A record needs a details view.** A list whose records the reader acts on (opens, edits,
  approves, follows up) gets one; a lookup list (tags, settings, reference data) gets none.
- **Pick each table's details view and its add and edit forms.** When the user named none,
  pick the most usable one per table from the tables below, and state each choice in your plan
  or summary ("Customers: details, add and edit in a right drawer"). A mockup shows
  it, so the user can change it. The real `TableView` with no `formContainer` opens a page per
  form: write the chosen container explicitly, with `builder_configure_block` on the table or
  in the page class.

  | Details view                                                | When                                            |
  | ----------------------------------------------------------- | ----------------------------------------------- |
  | `{ "type": "modal" }`, `size` `sm` to `full` (default `xl`) | about 8 fields or fewer, a quick look           |
  | `{ "type": "drawer", "direction": "right" }`                | reading a row while the list stays in view      |
  | `{ "type": "drawer" }` (`direction: "bottom"`, the default) | wide content, such as line items or a sub-table |
  | `{ "type": "page" }`, a generated page                      | a long record, or one people share by link      |

  | Add and edit forms                           | When                    |
  | -------------------------------------------- | ----------------------- |
  | `{ "type": "modal" }`                        | up to about 6 fields    |
  | `{ "type": "drawer", "direction": "right" }` | 7 to 15 fields          |
  | `{ "type": "page" }`, a generated page       | long or sectioned forms |

  One table has one `formContainer`: when its details view and its forms point at different
  containers, take the one for the forms when people edit rows, else the one for the details.

- **Group the fields.** Related fields (contact, address, billing) share a group. A generated
  form groups the columns `@ColumnGroup(id, config)` and `@Column({ group })` declare; a mockup
  writes a column's `group` and the table's `columnGroups`. A `ResourceForm` or a `Form` takes
  `sections` (`{ id, label, description?, icon?, fields }`) with `sectionNav` `side`, `jump` or
  `none`, and field groups `{ id, label?, fields }` inside them.
- **A custom details page is the user's call.** A details page of blocks, such as a `StatGroup`
  or `KpiCard`s above a `ResourceForm` in `mode: "view"`, or the record's related lists, is
  never chosen unasked. When it would clearly help, suggest it in one sentence ("a details page
  could show the order's KPIs above the record, want it?") and build it only on a yes: a
  sub-page of the list, left out of the menu, that opens on a click on its row, built as
  **dms-best-practices** _Custom pages are blocks_ says.
- **Turn on only the actions the reader takes.** A connected database's table writes only on a
  `read-write` connection, as **dms-external-database** _Connection access_ says. On one,
  propose each table's write actions from its `writes` and its shape, and the integrator
  confirms them in the plan:
  - **Transactions are never erased.** Sales, orders and their lines, invoices, credit notes,
    refunds, stock movements: no delete and no archive, whatever `writes` allows. Add and edit
    where `writes` allows them and the reader records them by hand (an order's status, a
    note).
  - **Logs stay read-only.** Payments, log, event, history and audit tables: no write action.
  - **Entities and lookups** (customers, products, categories, tags) get add and edit where
    `writes.insert` and `writes.update` allow them.
  - **Delete only a row nothing depends on**: where `writes.delete` allows it and no other
    table references this one through a foreign key (an incoming relation in the analysis or
    in `database_describe`). A referenced table gets no delete; it gets the archive below
    when it has an archive column, and neither otherwise.
  - An action `writes` forbids is not proposed; the plan says which and why, and why a table
    gets no delete or archive.
- **Archive in place of delete** when records must not be erased but may leave the lists
  (people, products, a referenced lookup), never on a transaction:
  `archiveMode: true` on the `TableView` gives Archive and Restore: archive, edit and duplicate
  on active rows, restore and delete on archived ones, behind a _Show archived_ toggle. The
  archive field is `isArchived` (`@ArchiveField` in code). Only on a table that writes rows, so
  over a connected database only on `read-write`, and only where the table has an archive
  column (`archived`, `is_archived`, `archived_at`). A table with none gets no archive.
- **Link pages together.** Every summary links to what it summarises: a KPI or a card to the
  table it counts, a dashboard tile to its page, a detail page back to its list, a toolbar
  button to the page it opens. `KpiCard` takes no link: a figure that links is a `StatGroup`
  cell (`to`), or sits in a `Card` whose head action (`actions: [{ label, to }]`) opens the
  table.

A mockup writes these as [SPEC.md](../dms-mockup/SPEC.md) _Links and sub-pages_, _Table
forms_ and _Archive mode_ say.

## Build a page in one call, and check it first

Build every page, or every set of blocks added to a page, with one `builder_compose_page` call:
the blocks as an ordered tree (containers carry `children`), each data block with its `query`
inline (same fields as `builder_add_query`). It writes everything at once and typechecks once.
Use the single-block tools only for a small fix afterwards.

1. Call it first with `"preview": true` and the default period's `from` and `to` as `args`.
   It writes nothing and answers each block's status: decide from that status, never from the
   figures a preview holds. Change or drop every block marked
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
