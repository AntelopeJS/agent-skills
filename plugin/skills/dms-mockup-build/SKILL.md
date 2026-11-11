---
name: dms-mockup-build
description: Builds the real AntelopeJS DMS pages from an approved mockup (mockups/<name>/spec.json): PageControllers through the builder MCP or TypeScript, real data in place of the fixtures, custom components for the sketches, then a side-by-side comparison with the mockup render until they match. Use when the user wants to build or implement a mockup, or turn its spec into pages.
---

# Building pages from a mockup

The spec is the contract: the pages it lists, their blocks in its order, their options, and a custom component for each sketch. [SPEC.md](../dms-mockup/SPEC.md) holds its format. Every page you write follows **dms-best-practices**; data pages also follow **dms-page-design**.

## Detect what the project has

- **The builder MCP and Safe mode**, as **dms-builder-mcp** _Detect what the project has_ says. With the builder MCP, build through it; without it, write the TypeScript with **dms-pages**.
- **A browser tool** that opens a URL and takes a screenshot: a browser MCP, agent-browser, Playwright. It drives step 4.
- **The asking tool**: `ask_user` in the dms-assistant chat, your harness's question tool elsewhere, else one closed question in chat.

## 1. Read the mockup

Read `mockups/<name>/spec.json` and its open annotations ([SPEC.md](../dms-mockup/SPEC.md) _annotations.json_). An open annotation is a change the user still wants: ask whether to apply it first with **dms-mockup**, or to build the spec as it stands.

## 2. Plan

Map every spec page and node, and present the plan before you write:

- **Page** → a `PageController`: `id` and title from the spec page, an icon and a description as **dms-page-design** _Name every page_ says, a category the user confirms.
- **Block** → the same `type` and options. Keep each child's `id` as the block's name.
- **Fixture** → the real data it stands for, by the first that holds:
  1. an existing resource or route serves it (`builder_list_resources`, the project's controllers): bind to it;
  2. rows of one entity: a new resource (`builder_create_resource`), its fields and types read from the fixture's rows, seeded with those rows only when the user wants sample data;
  3. a figure, a series or a ranking: a query on that resource (`builder_add_query`) whose `response` matches the block, as **dms-builder-mcp** _Data resources and queries_ says.
     A fixture none of these can serve goes in the plan as a question.
- **`TableView` over a fixture** → a `TableView` bound to the resource (`controller` = its ref), its columns from the spec's `columns`.
- **`ResourceForm` over a fixture** → a `ResourceForm` on the resource, with the spec's fields.
- **Sketch** → a `CustomComponent` with `.meta({ name, description, icon })`, its Vue drawn from the sketch's HTML and CSS with the DMS UI components and theme variables, its data from a route. In Safe mode this is out of reach: ask whether to turn Safe mode off for these components, or to leave each one as a `Placeholder` named after its caption.

The plan lists per page its blocks, the resources and queries to create, and the custom components. Write nothing before the user approves it.

## 3. Build

Per page, in the spec's order:

- **Builder MCP:** `builder_create_page`, then one `builder_compose_page` call with the page's whole tree, previewed first (`"preview": true`) as **dms-page-design** _Build a page in one call_ says. Create the resources and queries the page reads before the page.
- **Code:** write the page class, its routes and DataControllers with **dms-pages**, then run the typecheck.
- **Custom components:** with **dms-pages**, after the builder's write; then `builder_refresh` on the page when the builder MCP answers.

A page is built when it typechecks and `navigate_to_page` (or the browser) shows every block with data.

## 4. Compare and fix

For each page, put the spec's render and the real page side by side, at the same width and theme:

1. **With a browser tool:** screenshot `/mockup?name=<name>&page=<id>` and the real page, at the desktop width, then at the mobile width (`&width=mobile`, and the same viewport for the real page).
2. **Without one:** compare the spec's tree with `builder_page_structure` (or the page class), node by node, and ask the user to look at both pages.
3. List every **difference**: a block missing, extra or out of order, another type, another option (title, format, variant, span, columns), a sketch whose component looks otherwise, a block empty on the real page. Values that differ because real data replaced a fixture are no difference; a block empty where its fixture had data is one.
4. Fix each difference with the builder tools or a code edit, then compare again.

The page is done when a fresh comparison finds no difference, or only differences the user accepted.

## 5. Report

Report per page: the blocks built, the resources and queries created, the custom components, and every difference left with its reason. Leave `mockups/<name>/` in place: it is the record of what the user approved.
