# dms-best-practices reference

Material for [SKILL.md](SKILL.md): mapping design elements to DMS blocks, the mockup comparison, the Safe mode question, and the text fallback. The block catalog is the source of truth: `builder_catalog` with the builder MCP, `ListBlockTypes()` from `@antelopejs/interface-dms/base/block-types`, or https://dms.antelopejs.com/docs/components (one page per block).

## Design element → DMS block

| In the design                                    | DMS block                                                                                                                                                                                                     | Usual visible differences                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Big number with a trend arrow                    | `KpiCard` (`variant: "stat"` for the compact look)                                                                                                                                                            | Sparkline is a line, not bars                    |
| Several small figures in a strip                 | `StatGroup` (`layout: "joined"` or `"cards"`)                                                                                                                                                                 | One shared card vs separate tiles                |
| Chart with a headline value                      | `ChartCard` + a chart (`ChartArea`, `ChartLine`, `ChartColumn`…)                                                                                                                                              | Legend placement, comparison style               |
| Bare chart                                       | `ChartLine` / `ChartArea` / `ChartBar` / `ChartColumn` / `ChartDonut` / `ChartPie` / `ChartRadialBar` / `ChartHeatmap` / `ChartScatter` / `ChartRadar` / `ChartMixed` / `ChartRangeArea` / `ChartCandlestick` | Axis labels, tooltip look                        |
| Ranked list, leaderboard                         | `TopListCard`                                                                                                                                                                                                 | Bar position, rank badge style                   |
| Date range picker                                | `PeriodSelector` (`variant: "segmented"` for pills)                                                                                                                                                           | Preset labels                                    |
| Live / pause switch                              | `LiveToggle`                                                                                                                                                                                                  | Pill vs segmented                                |
| Context bar of a page with a period or live data | `pageToolbar()` (a `PageToolbar` holding the `LiveToggle` and `PeriodSelector`)                                                                                                                               | Leading blocks, `size`                           |
| Table, list with actions                         | `TableView` over a DataController (`displays` for cards / kanban)                                                                                                                                             | Column widths, row height (`density`)            |
| Detail facts of a record                         | `KeyValueList`                                                                                                                                                                                                | Value alignment                                  |
| Recent events, audit log                         | `ActivityFeed`                                                                                                                                                                                                | Day separators vs relative times                 |
| Usage bar, quota                                 | `Meter`                                                                                                                                                                                                       | Bar thickness (`size`)                           |
| Notice, alert strip                              | `Banner`                                                                                                                                                                                                      | Wash vs flat background                          |
| Strip under the dashboard header, across pages   | `RegisterLayoutBanner` (backend): the app's pages by default, `scope: "everywhere"` for a workspace-wide state                                                                                                | Not inside `/modules` unless scoped `everywhere` |
| Empty / first-run screen                         | `EmptyState` (or `Guard` around blocks)                                                                                                                                                                       | Illustration vs icon well                        |
| Links to sub-pages as cards                      | `NavCardGrid`                                                                                                                                                                                                 | Card height                                      |
| Code snippet                                     | `CodeBlock`                                                                                                                                                                                                   | Theme of the highlighting                        |
| Panel with a title and actions                   | `Card`                                                                                                                                                                                                        | Head layout                                      |
| Settings card with rows                          | `Section` + `FieldRow`                                                                                                                                                                                        | Label column width (`layout`)                    |
| Form, settings form                              | `Form` / `ResourceForm`                                                                                                                                                                                       | Field layout (`fieldsOrientation`, sections)     |
| Tabs                                             | `Tab` (`variant: "pill" \| "link"`)                                                                                                                                                                           | Tab style                                        |
| Columns / rows of panels                         | `Grid` + `GridRow`, `HStack` / `VStack` / `Spacer`                                                                                                                                                            | Exact gutters                                    |

Nothing matches — a canvas, a map, a bespoke visualization — → a custom block, under the rules of SKILL.md.

## Mockup comparison

Build or update a mockup through **dms-mockup**, with the user's design as the mockup's reference: the closest DMS block as the page's tree and, for the custom block, a sketch in the spec. The user annotates the mockup, then **dms-mockup** applies the annotations. Then ask with the asking tool (`ask_user` in the dms-assistant chat):

```ts
ask_user({
  questions: [
    {
      header: "Revenue tile",
      question: "Keep the DMS KPI card, adjust it, or build a custom block?",
      options: [
        {
          label: "Keep the DMS block",
          description:
            "KpiCard as mocked up; themed, permissioned, editable in the builder",
        },
        {
          label: "Adjust it through its options",
          description:
            "Same block, e.g. the compact variant; tell me what to change",
        },
        {
          label: "Build a custom block",
          description:
            "A Vue component matching the sketch, declared with .meta(); the rest stays blocks",
        },
      ],
    },
  ],
});
```

## Safe mode: a custom block is out of reach

The builder tools cannot write Vue. Show the closest composition in a mockup through **dms-mockup** (the text table when there is no mockup tooling), then:

```ts
ask_user({
  questions: [
    {
      header: "Seat map",
      question:
        "Safe mode cannot build a custom block. Use the closest DMS composition, or turn Safe mode off for this block only?",
      options: [
        {
          label: "Use the DMS composition",
          description: "A Grid of KpiCard per zone, as mocked up",
        },
        {
          label: "Turn Safe mode off for this block",
          description:
            "Only the seat map becomes custom, with .meta(); then Safe mode again",
        },
      ],
    },
  ],
});
```

## Text fallback (no mockup tooling)

One table per batch of components, then one closed question per row:

| Your design                                   | DMS block                          | Visible difference                |
| --------------------------------------------- | ---------------------------------- | --------------------------------- |
| Revenue tile with bars under the figure       | `KpiCard` with a sparkline         | A line instead of bars            |
| Orders table with avatars in the first column | `TableView` with `IdentityDisplay` | None beyond spacing — no question |

> Revenue tile: keep the DMS block, adjust it through its options, or build a custom block?

When the custom option is hard to picture, add its sketch as a short markup snippet under the table (a few lines of HTML, no styling detail). Leave rows whose only difference is theme-level (colors, spacing, fonts) out of the questions.
