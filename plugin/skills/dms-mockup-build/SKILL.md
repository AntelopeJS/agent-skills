---
name: dms-mockup-build
description: Builds the real AntelopeJS DMS pages from an approved mockup (mockups/<name>/spec.json): PageControllers through the builder MCP or TypeScript, real data in place of the fixtures, custom components for the sketches, then a verify and fix loop against the mockup (page_verify, at most three rounds) that reports every page left failing. Use when the user wants to build or implement a mockup, or turn its spec into pages.
---

# Building pages from a mockup

The spec is the contract: the pages it lists, their blocks in its order, their options, and a custom component for each sketch. [SPEC.md](../dms-mockup/SPEC.md) holds its format. Every page you write follows **dms-best-practices**; data pages also follow **dms-page-design**.

## Detect what the project has

- **The builder MCP and Safe mode**, as **dms-builder-mcp** _Detect what the project has_ says. With the builder MCP, build through it; without it, write the TypeScript with **dms-pages**.
- **`page_verify`** among your tools (the DMS development MCP): it opens each page in a headless browser and reports its render against the mockup, its data, errors, interactions and permissions. It drives step 4. Without it, step 4 falls back to the visual comparison, with **a browser tool** that opens a URL and takes a screenshot (a browser MCP, agent-browser, Playwright) when you have one.
- **`preview_blocks`** among your tools: step 4 shows each comparison through it.
- **The asking tool**: `ask_user` in the dms-assistant chat, your harness's question tool elsewhere, else one closed question in chat.

## 1. Read the mockup

Read `mockups/<name>/spec.json` and its open annotations ([SPEC.md](../dms-mockup/SPEC.md) _annotations.json_). An open annotation is a change the user still wants: ask whether to apply it first with **dms-mockup**, or to build the spec as it stands.

## 2. Plan

Map every spec page and node, and present the plan before you write:

- **Page** → a `PageController`: `id` and title from the spec page, an icon and a description as **dms-page-design** _Name every page_ says, a category the user confirms.
- **Block** → the same `type` and options. Keep each child's `id` as the block's name; a child whose `id` names a block option (a `ChartCard`'s `chart`) becomes that option.
- **Fixture**, or a `static*` option → the real data it stands for, by the first that holds:
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

A page is built when it typechecks and, checked as **dms-builder-mcp** _Verify_ says, shows every block with data.

## 4. Verify and fix

A **round** verifies pages, then fixes what failed. Run at most **three rounds**: round 1 verifies every page of the plan, each later round the pages that failed before and every page a fix changed, and after the third verify you fix nothing more. A page passes when its last verify reports it `ok` and finds no difference from the mockup, or only differences the user accepted. A page of the plan that was never built, or does not typecheck, fails with that error. A **difference** is a block missing, extra or out of order, another type, another option (title, format, variant, span, columns), a sketch whose component looks otherwise, or a block empty on the real page. Values that differ because real data replaced a fixture are no difference; a block empty where its fixture had data is one.

**With `page_verify`**, per page:

1. Call `page_verify({ page: "<route>", mockup: "<name>", mockupPage: "<spec page id>" })`, with the route as `list_pages` answers it (a concrete one for `:params`, such as `/orders/42`). Keep the defaults: the owner, desktop and mobile, writes held back. The first call can take minutes while it installs its browser. An answer without `pages`: check the route with `list_pages` and call once more; if it still has none, verify that page without `page_verify` and report why.
2. Read `pages[].failures` first: one line per failed check (a block in error or empty, a console error, a failed request, an interaction, a permission, a mockup block with no counterpart), and `notes`. Then read `render.mockup`: `unavailable` set means the page was not compared, so compare it as without `page_verify`; otherwise each `extraPageBlocks` entry is a difference, so is a `pagePath` order that differs from the `mockupPath` order, and the `mockupScreenshot` and `pageScreenshot` of each matched block show the option differences the tool does not check.
3. Fix each failure where it starts: the route, resource or query a block in error reads (its `data[].source`), the block tree with the builder tools, or the code.

**Without `page_verify`**, compare visually and tell the user that `page_verify` is not available, so the pages were compared with the mockup but not tested:

1. **With a browser tool:** screenshot `/mockup?name=<name>&page=<id>` and the real page, at the desktop width, then at the mobile width (`&width=mobile`, and the same viewport for the real page).
2. **Without one:** compare the spec's tree with `builder_page_structure` (or the page class), node by node, and ask the user to look at both pages. A page fails until the user confirms it.
3. Fix each difference with the builder tools or a code edit.

When `preview_blocks` is among your tools, call it each time you compare a page with the mockup, with the page's tree as built (`static*` options in place of its data) and the mockup as `reference`: `{ url: "/mockup?name=<name>&page=<id>", caption: "Mockup <name>, page <id>" }`. Every `preview_blocks` call of the build carries that reference: the dms-assistant build dialog draws the latest preview beside it. Elsewhere, show the user what the tool answers.

## 5. Report

Open with one summary line, the same in the dms-assistant chat and in any harness: `<passing>/<planned> pages pass, <n> errors`, such as `3/3 pages pass, 0 errors`. `<planned>` counts the pages of the approved plan, built or not; `<n>` counts the failure lines and differences of the last verify, each once, accepted differences excluded. Without `page_verify`, add `(compared visually, page_verify is not available)`.

Then list every page still failing after the last round, never fewer: its route, each failure line or difference, the error behind it (the console text, the failed request with its status, the typecheck error), and its screenshots: the page's `render.viewports[].screenshot`, and the block's `pageScreenshot` and `mockupScreenshot`, all project-relative. Then the `notes` that qualify a pass (a role checked as the owner, writes held back), and the differences the user accepted, each with its reason.

Then, per page: the blocks built, the resources and queries created, and the custom components. Leave `mockups/<name>/` in place: it is the record of what the user approved.
