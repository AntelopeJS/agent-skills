---
name: dms-external-database
description: Connects an AntelopeJS DMS project to a client's existing database, runs the builder's analysis of it, settles what the analysis could not decide from the catalog and aggregates, generates TableViews through the builder, names them and gives each the table features its data supports, and always builds an analytics dashboard first in the menu. Use when the user wants pages over a database the project does not own, PostgreSQL, MySQL, MariaDB, MongoDB or RethinkDB ("plug in our client's Postgres", "connect their MySQL database", "map their Mongo database", "generate the admin for this database", "finish the mapping the builder proposed").
---

# Pages over a client's existing database

The Builder analyses the database by itself: from the catalog and the profiles, fixed rules
propose a mapping and name every choice's rule. Your work is what those rules cannot do: answer
the questions they left open, revisit the defaults the names and comments contradict, and plan the
analytics pages from the data. You never start from scratch.

You work through the `database_*` and `builder_*` tools of the DMS MCP only. You never read rows
of the client's database: the catalog and aggregates are what you have, and they are enough. The
database's URL lives in the project's `.env`: read neither `.env` nor the environment, print
neither, and write no credential yourself. The dms-assistant chat also refuses file tools on
`.env`; elsewhere nothing does, so this rule is yours to hold.

## Before you start

Settle what the project has, as `dms-builder-mcp` _Detect what the project has_ says.

- **No `database_connections` or `builder_analyse_database` among your tools**: this flow needs
  them, and no code edit replaces the analysis. Tell the integrator the builder MCP answers while
  `ajs project dev` runs, ask them to start it and reload the MCP servers, and stop until it
  answers.
- **In the dms-assistant chat**: analysing and settling run in plan mode, and the integrator
  presses **Run** on your plan before anything is written.
- **Anywhere else** (Claude Code, Codex): there is no **Run** button. Present the plan, and write
  nothing until the integrator approves it in the session. A mapping that removes pages, a
  deletion or a project configuration change is refused once with what it would do: show that to
  the integrator, and repeat the identical call only after they confirm it.

The flow is **connect → analyse → settle → validate → apply → check**. Analysing and settling
read only. Nothing is written before the integrator approves your plan.

## 1. Connect

Call `database_connections`.

- **A connection is listed** with an `engine`: use its id and go to 2.
- **An entry answers `error`**: say what it says (an owned instance, the catalog not enabled, a
  role that cannot read) and stop.
- **A database tool answers `unreachable_connection`**: the DMS MCP reaches only the catalog
  connection `dms` imports. The connection exists, but step 4 of REFERENCE.md _Connecting_ is
  missing: propose that step alone, with the same approval and restart.
- **Nothing is listed**: the project is not connected yet. Ask the integrator which engine the
  database runs: PostgreSQL, MySQL or MariaDB, MongoDB, or RethinkDB. Propose one
  `builder_configure_project` call with that engine's steps in REFERENCE.md _Connecting_. Pick
  the names with the integrator, for example connection `erp`, provider module `postgres-erp`
  (`mysql-erp`, `mongodb-erp`, `rethinkdb-erp`), generated module `erp-tables`, variable
  `ERP_DATABASE_URL`, and for MongoDB `ERP_DATABASE_NAME`. Ask the integrator for the version of
  the engine's module to install (`@antelopejs/postgres`, `@antelopejs/mysql` for MySQL and
  MariaDB alike, `@antelopejs/mongodb`, `@antelopejs/rethinkdb`): you cannot look it up. The user
  approves the diff. Safe mode refuses `builder_configure_project`: ask the integrator to turn it
  off for this one call.
  - Then tell the integrator to put the URL in `.env` (`ERP_DATABASE_URL=postgres://…`,
    `mysql://…/<database>` for MySQL and MariaDB, `mongodb://…`, or `rethinkdb://…/<database>`;
    for MongoDB also `ERP_DATABASE_NAME`), or in the builder's _Database_ workspace when the
    project has one, which writes it there, and to restart the project. Every deployed
    environment needs the same variables, set where that environment keeps its secrets, never in
    git.
  - Recommend an account that can only read for the analysis: a PostgreSQL role with SELECT, a
    MySQL or MariaDB account granted SELECT on the database directly (the module does not see a
    grant through a role), a MongoDB user with the built-in `read` role, a RethinkDB user with
    `read` permission.
  - Stop here: the connection exists only after the restart.

The builder and you each have a connection to the database, under the same id: the builder for
its analysis and mapping, you for your probing.

## 2. Analyse

`builder_analyse_database` with the connection and the generated module.

- It answers the proposal, or, when profiling takes longer, the job's progress and `id`: call it
  again with `job` until the proposal is in.
- A `schemas` open item means the database is large: ask the integrator which schemas matter and
  analyse again with `schemas`. On MySQL and MariaDB a schema is a database.
- Relations the module mapped or excluded before are not proposed again. On a module mapped
  already, the proposal is what is left.

Read the proposal as REFERENCE.md _The proposal_ explains: every choice has a `rule` and a `kind`.
A `fact` follows from the catalog; leave it. A `default` is a judgement; check it.

## 3. Settle

Through the read-only tools (in plan mode, in the dms-assistant chat). Probe lightly: a targeted `database_profile` of a few
columns, a `CheckReference` in `references`, a `database_describe` of one relation. Never a
profile of the whole database again: the Builder did it.

- **Open items**, one by one:
  - `purpose`: what a relation holds. Decide from its name, comment, columns and profile:
    entities to list (a TableView), facts to count (stats only), or nothing to show (excluded).
    The item carries the relation as it would be mapped, and in its own `open` the questions
    that mapping leaves. Answer those only when you map the relation.
  - `label`: which column names a row. Prefer a name or title, then a code or number people
    recognise.
  - `reference`: a column found almost whole in another relation's key. Check it with
    `CheckReference` on the column; make it a relation column only at containment 1.
  - `field-type`: a field of a document database whose sampled values have several types, none
    covering enough of them (`int 60% | string 40%`). Pick the declaration that reads what
    the field means, from its name and its shares, or leave it out. Unanswered, it stays out.
  - Where nothing tells you, say so and leave the item open: the integrator answers it in the
    builder. Do not guess.
- **Defaults worth revisiting.** For example a table rule R8 calls a log whose name and comment
  say it holds entities, a label rule L1 chose that a comment contradicts, or a title taken from a
  cryptic name.
- **Document databases** (MongoDB, RethinkDB) declare no field types and no references: the
  catalog reads types from a sample, and every reference comes from a name and a `CheckReference`,
  never from the database. An embedded document is one field: its subfields are not mappable, and
  neither is an array of ids as a relation.
- **Editable.** Every TableView is proposed read-only. Make one editable only where the integrator
  wants it; show `writes` beside it, so a read-only role in this environment is visible.
- **Pages people can work with.** Load the `dms-page-design` skill. For every TableView, plan
  from its columns, profiles and categories, as _Name every page_ and _Tables_ there say: a
  title, an icon and a description; the tabs, saved views, display modes, footer totals and
  KPI cards its data supports. Decide each from the data, and leave out what the data does
  not support.
- **The analytics dashboard,** which the analysis does not make. Every run ends with one,
  first in the menu, even when the integrator only asked for the tables. Plan it from the data:
  1. **Inspect.** For each relation, read from the proposal its rows, its `time-axis` columns
     with their `range`, its `measure` columns, and its `enum-like` columns with their
     `categories`. Profile a column the proposal leaves without them, such as the main date
     column's range. Write each range down: the period rule needs the last date.
  2. **Ask.** Write the 4 to 8 questions the owner of this data asks every week: how revenue
     or volume trends, what sells, who buys, where, and how it compares with last year. Each
     question names the relation, the measure (a sum of a `measure` column or a row count)
     and the grouping (the time axis or a column of the same relation).
  3. **Plan pages.** The relation with a time axis, a measure and the most rows is the main
     fact relation. It gets the dashboard, named for its area ("Sales", or "Overview" when it
     also carries the other relations' headline figures), holding every question about it.
     Another relation gets its own analytics page only when it has its own time axis and at
     least 100 rows. When no relation has a time axis, the dashboard still exists: KPI cards
     of counts and sums, and breakdowns by the category columns, with no period selector.
  4. **Choose blocks** for each question with `dms-page-design`, and its default period from
     the main time axis's real range.
- **The minimum.** Your plan, and the pages you write, meet all of these:
  - one analytics dashboard, first in the connection's menu (`order: 0`), opened by a toolbar
    with a period selector when the data has dates;
  - every page with a title in the owner's words, an icon and a description, never the raw
    relation name;
  - every table given the tabs, views, display modes, footer totals and KPI cards its data
    supports, as `dms-page-design` _Tables_ decides;
  - at least 3 different chart kinds on it when the data has the shapes for them;
  - a default period computed from the data's real dates, never assumed;
  - every page built with one `builder_compose_page` call, previewed first, and every block whose
    preview is empty, zero or failed dropped or changed;
  - every page checked as `dms-builder-mcp` _Verify_ says before you report.
- **Not possible yet:** breakdowns by a related entity's name, such as revenue per customer.
  Templates read one relation, so they would show ids. List them under _Not possible yet_,
  never as pages.

Write your plan (`ExitPlanMode` in plan mode, a message otherwise) in the format of REFERENCE.md _Plan_: what you change in the
proposal and why, the questions and the analytics pages that answer them, the open items you
leave, and what is not possible yet.

## 4. Validate

The integrator answers in chat or with "suggest a change". Revise the plan and present it
again. Write nothing before they approve it (**Run** in the dms-assistant chat).

## 5. Apply

Work in this order, so the most visible result lands first: map the tables, build the
dashboard and check it, then add KPI rows above tables, then any second analytics page.

1. `builder_map_resources` in batches of 3 or 4 relations per call, TableViews and stats-only
   relations alike; the relations decided against go in `excluded` on the first call
   (REFERENCE.md _Mapping_). One call with every relation of a large database can abort.
   - Send the proposal's choices as they stand where you changed nothing, plus per resource
     the `title`, `icon`, `description` and `tableOptions` you planned.
   - On `invalid_config`, fix the choice it names and call again: a refused call writes nothing.
     When the same choice is refused twice, drop it (send the relation without that display or
     option) and say so in your report, rather than trying more variants.
   - It answers each relation's `ref`, which queries name it by, `category`, the connection's
     category ref (`pages.<connection>`), and `leftOut`: carry those into your report.
2. Per analytics page, one `builder_compose_page` call with `create` (`name`, `displayName`,
   `module` set to the generated module, `category` set to the `category` MapResources
   answered, an icon, a description, and `order: 0` for the dashboard, 1, 2… for the next
   ones) and every block in the order `dms-page-design` lays out, each data block with its
   query inline. Preview first, then write, as `dms-page-design` _Build a page in one call_
   says.
   - Queries read the mapped resources by their refs (`<connection>/<schema>/<relation>`).
3. Per table page that gets KPI cards above its table, one `builder_compose_page` call with
   `placement: { "before": "table" }`, previewed first. A table option MapResources refused
   comes back as a warning: fix it with `builder_configure_table_view`.

To change a relation later, read its current choices with `builder_mapping`, then call
`builder_map_resources` with that relation alone, its included columns as they are and only your
change made: a mapped relation is rewritten from the choices sent, and its page follows.

## 6. Check

- Navigate only once every page is written. Pages register when the host reloads the generated
  module: under `ajs project dev` its watcher rebuilds the module after your writes.
- `navigate_to_page` for each page. If it answers `unknown_route`, the reload has not happened.
  - Read `query_logs` once, for a reload error.
  - Then tell the integrator the pages appear once the module reloads. Do not wait, retry or
    investigate further.
- `query_logs` for registration warnings (lossy fields, unserved indexes) and for the errors of
  the routes the pages called.
- On each analytics page, check every block as `dms-builder-mcp` _Verify_ says, fix or remove
  each one that shows no data or an error, and check again, as in `dms-page-design` _Build a page in one call, and check it first_.

Then report:

- what the builder mapped by its rules, and what you changed;
- the pages made, with each analytics page's default period and the date range it came from,
  and per table the features you gave it and why;
- every block that still shows no data, and why;
- what was left out and why;
- the open items left, which the integrator finds in the builder's _Database_ workspace;
- the variable every deployment must set.

## Guardrails

- Never write a URL, password or token into a tool call, the config or a page.
- Never map into the project's own module: only into the module bound to the connection.
- `builder_create_resource`, `builder_add_field` and table-side `builder_configure_field` are
  refused in that module: its tables are the database's.
- `builder_delete_resource` there never deletes the client's rows.
