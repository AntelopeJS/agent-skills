# Reference: external database

## Connecting

One `builder_configure_project` call. Replace the names, and `<version>` with the range the
integrator gave you:

```json
{
  "steps": [
    {
      "op": "AddModule",
      "id": "postgres-erp",
      "entry": {
        "source": {
          "type": "package",
          "package": "@antelopejs/postgres",
          "version": "<version>"
        },
        "config": { "mode": "external", "statementTimeoutMs": 30000 },
        "env": { "url": "ERP_DATABASE_URL" },
        "exportPriority": { "@antelopejs/interface-database": -1 }
      }
    },
    {
      "op": "CreateLocalModule",
      "id": "erp-tables",
      "path": "modules/erp-tables",
      "connection": "erp",
      "entry": {
        "importOverrides": [
          {
            "interface": "@antelopejs/interface-database",
            "source": "postgres-erp"
          }
        ]
      }
    },
    {
      "op": "ConfigureModule",
      "id": "dms",
      "entry": {
        "importOverrides": [
          {
            "interface": "@antelopejs/interface-database-catalog",
            "source": "postgres-erp",
            "id": "erp"
          }
        ]
      }
    },
    {
      "op": "ConfigureModule",
      "id": "dms",
      "entry": {
        "importOverrides": [
          {
            "interface": "@antelopejs/interface-database",
            "source": "<project database module>"
          }
        ]
      }
    },
    {
      "op": "ConfigureModule",
      "id": "dms-database",
      "entry": {
        "importOverrides": [
          {
            "interface": "@antelopejs/interface-database",
            "source": "<project database module>"
          },
          {
            "interface": "@antelopejs/interface-database",
            "source": "postgres-erp",
            "id": "erp"
          },
          {
            "interface": "@antelopejs/interface-database-catalog",
            "source": "postgres-erp",
            "id": "erp"
          }
        ],
        "config": { "externalConnections": { "erp": { "access": "read" } } }
      }
    }
  ]
}
```

- **Step 1** is the client's database as an external instance of its engine's module. Its URL
  comes from the variable. Its `exportPriority` of -1 ranks it below the project's own database,
  so a module that does not pin `@antelopejs/interface-database` keeps the project's.
- **Step 2** is the module the tables are generated into. It is bound to that instance, and
  `connection` records that it holds the tables of `erp`.
- **Step 3** gives the builder and the `database_*` tools the connection `erp`, the same id for
  both. It configures the module that serves the DMS MCP: `dms`. A project whose builder tools
  still come from `dms-builder` and `dms-assistant` takes one such step for each of them instead.
- **Step 4** keeps the DMS on the project's own database. The DMS module is the one that provides
  `@antelopejs/interface-dms`. Step 2 pins `@antelopejs/interface-database` and uses the DMS, so
  the DMS inherits that pin and would be reached with two bindings. Its `source` is the module
  core picks by default among the modules of `antelope.config.ts` that provide
  `@antelopejs/interface-database` before this call (a module's `package.json` lists what it
  provides under `antelopeJs.implements`): the highest `exportPriority` for it (0 when unset),
  the alphabetically first id on a tie. Never assume `mongodb`. Leave the step out when the DMS
  module already pins `@antelopejs/interface-database`, provides it itself, or no module
  provided it before this call. When an `environments` entry of the configuration sets an
  `exportPriority`, or a provider's priority is not a plain number, stop and ask the integrator
  which module the DMS uses.
- **Step 5** registers the connection with `dms-database`, the module whose Data browser and
  write routes read its access, under the same id, after the project's own database. `access` is
  always `"read"`: `builder_configure_project` refuses to raise one, and SKILL.md _Connection
  access_ raises it afterwards. Leave the step out when the project has no `dms-database`
  module.

For MySQL, MariaDB, MongoDB and RethinkDB, step 1 changes, and the other steps name its id in
place of `postgres-erp`.

MySQL and MariaDB share one module, `@antelopejs/mysql`, which tells them apart when it connects.
Its URL holds the database as its path: `mysql://user:password@host:3306/erp`.

```json
{
  "op": "AddModule",
  "id": "mysql-erp",
  "entry": {
    "source": {
      "type": "package",
      "package": "@antelopejs/mysql",
      "version": "<version>"
    },
    "config": { "mode": "external", "statementTimeoutMs": 30000 },
    "env": { "url": "ERP_DATABASE_URL" }
  }
}
```

For MongoDB and RethinkDB, the `disabledExports` entry keeps the external instance from ever
serving the raw client other modules ask for:

```json
{
  "op": "AddModule",
  "id": "mongodb-erp",
  "entry": {
    "source": {
      "type": "package",
      "package": "@antelopejs/mongodb",
      "version": "<version>"
    },
    "config": { "mode": "external", "statementTimeoutMs": 30000 },
    "env": { "url": "ERP_DATABASE_URL", "database": "ERP_DATABASE_NAME" },
    "exportPriority": { "@antelopejs/interface-database": -1 },
    "disabledExports": ["@antelopejs/interface-mongodb"]
  }
}
```

```json
{
  "op": "AddModule",
  "id": "rethinkdb-erp",
  "entry": {
    "source": {
      "type": "package",
      "package": "@antelopejs/rethinkdb",
      "version": "<version>"
    },
    "config": { "mode": "external", "statementTimeoutMs": 30000 },
    "env": { "url": "ERP_DATABASE_URL" },
    "exportPriority": { "@antelopejs/interface-database": -1 },
    "disabledExports": ["@antelopejs/interface-rethinkdb"]
  }
}
```

The RethinkDB URL holds the database as its path: `rethinkdb://user:password@host:28015/erp`.

## The proposal

`builder_analyse_database` answers it once the job is done:

```json
{
  "connection": "erp",
  "module": "erp-tables",
  "database": {
    "engine": "postgresql 17.5",
    "role": "erp_reader",
    "writes": "none"
  },
  "resources": [
    {
      "relation": "sales.customers",
      "tableView": { "value": true, "rule": "R6", "kind": "default" },
      "writable": { "value": false, "rule": "W1", "kind": "default" },
      "label": { "value": "name", "rule": "L1", "kind": "default" },
      "title": { "value": "Customers", "rule": "L2", "kind": "default" },
      "fields": [
        {
          "column": "segment",
          "native": "sales.segment",
          "accepts": ["string"],
          "declared": { "value": "string", "rule": "F3", "kind": "fact" },
          "filterable": { "value": true, "rule": "FL", "kind": "default" },
          "profile": { "traits": ["enum-like"], "distinct": 4 }
        }
      ],
      "leftOut": [
        {
          "column": "password_hash",
          "reason": "named like a secret",
          "rule": "F2"
        }
      ],
      "writes": { "insert": false, "update": false, "delete": false }
    }
  ],
  "excluded": [
    {
      "relation": "sales.people",
      "reason": "SELECT is granted on some columns only",
      "rule": "R1"
    }
  ],
  "open": [
    {
      "id": "purpose:legacy.t_cst",
      "kind": "purpose",
      "relation": "legacy.t_cst",
      "question": "What does legacy.t_cst hold?",
      "options": ["…"],
      "proposed": null,
      "resource": { "relation": "legacy.t_cst", "…": "…" },
      "open": [
        { "id": "reference:legacy.t_cst.c05", "kind": "reference", "…": "…" }
      ]
    }
  ]
}
```

The rules, in the order they apply to a relation:

| Rule | When                                              | Then                                              |
| ---- | ------------------------------------------------- | ------------------------------------------------- |
| R1   | the catalog says unmappable                       | excluded                                          |
| R4   | a framework's or a migration tool's table         | excluded                                          |
| R3   | no rows                                           | excluded                                          |
| R2   | no key                                            | stats only                                        |
| R5   | keyed by its two references                       | stats only: a link table                          |
| R6   | keyed, with a label candidate                     | TableView                                         |
| R7   | keyed, no label, referenced                       | TableView labelled by its key, and a `label` item |
| R8   | keyed, no label, not referenced, with a time axis | stats only: events or a log                       |
| R9   | anything else                                     | a `purpose` item                                  |

For columns: F1 and F2 leave out a column no type reads and one named like a secret, F3 proposes
the first accepted declaration, F4 makes a reference the database declares a relation column
(PostgreSQL, MySQL and MariaDB), F5 one found whole by `CheckReference`. L1 chooses labels, L2 titles, FL the four flags, W1 read-only.

## Plan

```markdown
## Database

erp · postgresql 17.5 · role erp_reader (read only) · 42 relations: 9 TableViews, 6 stats only, 18 excluded, 3 open

## Changes to the Builder's proposal

- legacy.t_cst (purpose) → TableView "Customers": its comment says "clients"; label `c02`, a short unique text
- sales.events (R8, stats only) → TableView: named and commented as calendar events people edit
- sales.orders: editable, as asked; the role here writes nothing

## Questions

- How does revenue trend, and how does it compare with last year? (sales.orders, sum of total, by ordered_at)
- Which statuses do orders end in? (sales.orders, count, by status)
- Which countries buy most? (sales.orders, sum of total, by country)

## Analytics pages

### Sales (sales.orders): the dashboard, first in the menu, outside the sections

- Period: by ordered_at, default last-90-days vs previous-period; presets last-30-days, last-90-days, ytd, last-year, custom
- Toolbar: PageToolbar › PeriodSelector
- KPIs: revenue (sum of total) · orders (count) · units (sum of quantity), each with delta and sparkline
- ChartCard › ChartArea: revenue per month
- ChartCard › ChartDonut: orders by status (5 values)
- ChartCard › ChartBar: top 10 countries by revenue
- TopListCard: top 10 cities by orders

## Sections

- Sales (i-ph-storefront): Orders, Payments, Coupons
- Catalog (i-ph-package): Products, Categories
- Customers (i-ph-users): Customers, Reviews, Support tickets

## Left open

- label:legacy.t_ord — no column names an order; the integrator picks one in the Builder

## Not possible yet

- Revenue per customer name: needs the customer's name beside each order
```

## Mapping

The proposal's values, without their rules, plus what you changed:

```json
{
  "module": "erp-tables",
  "connection": "erp",
  "resources": [
    {
      "relation": "sales.customers",
      "label": "name",
      "title": "Customers",
      "category": "pages.customers",
      "tableView": true,
      "writable": true,
      "fields": [
        { "column": "name", "searchable": true, "sortable": true },
        { "column": "segment", "filterable": true },
        { "column": "email" },
        { "column": "created_at", "sortable": true }
      ]
    },
    {
      "relation": "sales.orders",
      "title": "Orders",
      "category": "pages.sales",
      "tableView": true,
      "writable": false,
      "tabs": { "column": "status" },
      "fields": [
        { "column": "status", "filterable": true },
        { "column": "ordered_at", "sortable": true },
        { "column": "total", "display": null },
        {
          "column": "customer_code",
          "relation": "sales.customers",
          "label": "Customer"
        }
      ]
    },
    {
      "relation": "sales.audit_log",
      "tableView": false,
      "writable": false,
      "fields": [{ "column": "at" }, { "column": "action" }]
    }
  ],
  "excluded": [
    {
      "relation": "sales.people",
      "reason": "SELECT is granted on some columns only"
    }
  ]
}
```

- `declared` defaults to the column's `accepts[0]`. Set it only to take another accepted
  declaration, and always for a column a `field-type` item asked about: give the answer as its
  `declared`.
- Leave `display` out to keep the one the Builder proposes: it reads a badge's items and a
  price's currency from the column at map time, so you send no value. Send a display only to
  change it: a price with a `currency` the schema or the integrator names, a badge only over a
  native enum's labels. A proposed price with no `currency` draws euros: send it a `currency`,
  or `null`. Send `tabs` as a column name (`{ "column": "status" }`). `null` turns either off.
- `category` is the ref `builder_create_category` answered for the page's section, made with
  this call's `module`. Left out, a new page goes in the connection's category.
- Key columns are added for you.
- A relation column's target must be in the same call, with a `label`, or mapped in the module
  before.
- Two spellings, never mixed:
  - a relation is `schema.name` (`erp.audit_log`) in `relation` fields;
  - a resource ref is `<connection>/<schema>/<relation>` in kebab case (`erp/erp/audit-log`) in
    `builder_add_query`'s `resource`.

  Every mapped relation has a ref, `tableView: false` ones included. MapResources answers each
  one's ref.
