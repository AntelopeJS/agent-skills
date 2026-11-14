---
name: dms-mockup-build
description: Builds the real AntelopeJS DMS pages from an approved mockup (mockups/<name>/spec.json): PageControllers through the builder MCP or TypeScript, real data in place of the fixtures, custom components for the sketches (or updates the live page a converted mockup page names), then a verify and fix loop against the mockup (page_verify, at most three rounds) that reports every page left failing. Use when the user wants to build or implement a mockup, or turn its spec into pages.
---

# Building pages from a mockup

The spec is the contract: the pages it lists, their blocks in its order, their options, and a custom component for each sketch. [SPEC.md](../dms-mockup/SPEC.md) holds its format. Every page you write follows **dms-best-practices**; data pages also follow **dms-page-design**.

## Detect what the project has

- **The builder MCP and Safe mode**, as **dms-builder-mcp** _Detect what the project has_ says. With the builder MCP, build each new page through it with one `builder_compose_page` call; without it, write the TypeScript with **dms-pages**.
- **`page_verify`** among your tools (the DMS development MCP): it opens each page in a headless browser and reports its render against the mockup, its data, errors, interactions and permissions. It drives step 4. Without it, step 4 falls back to the visual comparison, with **a browser tool** that opens a URL and takes a screenshot (a browser MCP, agent-browser, Playwright) when you have one.
- **`mockup_apply_to_page`** among your tools: it writes a converted mockup page back to its live page and lists what it left to wire, as _Pages converted from a live page_ says.
- **`preview_blocks`** among your tools: step 4 shows each comparison through it.
- **The asking tool**: `ask_user` in the dms-assistant chat, your harness's question tool elsewhere, else one closed question in chat.

## 1. Read the mockup

Read `mockups/<name>/spec.json` and its open annotations ([SPEC.md](../dms-mockup/SPEC.md) _annotations.json_). An open annotation is a change the user still wants: ask whether to apply it first with **dms-mockup**, or to build the spec as it stands.

## 2. Plan

Map every spec page and node, and present the plan before you write:

- **Converted page:** a spec page with `livePage: { ref, version }` was converted from the live page at `livePage.ref` (a route). Read that page with `builder_page_structure` (without the builder MCP, its page class) and plan the changes that turn it into the spec page (blocks to configure, move, remove or add), not a new `PageController`; its fixtures whose key is in the spec page's `liveRoutes` keep reading those live routes (_Live route_ below). A **live sketch**, a Custom sketch whose `id` names a block of the live page, stands for code the conversion could not express: keep that block as it is, with no component to write and no Safe mode question. Check its version first, as _Pages converted from a live page_ says: a stale page goes in the plan as stopped, with no changes. With `mockup_apply_to_page` among your tools, the plan still lists every change and says that the tool writes the page first, and that you build only the changes its `wiring` answer lists.
- **Page** → a `PageController` (with `RegisterPage`, from `@antelopejs/interface-dms/page`): `id` and title from the spec page, an icon and a description as **dms-page-design** _Name every page_ says, a category the user confirms.
- **Block** → the same `type` and options. Keep each child's `id` as the block's name; a child whose `id` names a block option (a `ChartCard`'s `chart`) becomes that option.
- **Live route:** on a converted page, a `fixture:<key>` whose key is in the page's `liveRoutes` reads that route: the block's fetch option (such as `fetchUrl`) takes it in place of the fixture's `static*` option, and a live `TableView` or `ResourceForm` keeps its `controller`; a block the spec adds follows the _Fixture_ rules. This comes before the _Fixture_, `TableView` and `ResourceForm` rules.
- **Fixture**, or a `static*` option → the real data it stands for, by the first that holds:
  1. an existing resource or route serves it (`builder_list_resources`, the project's controllers): bind to it;
  2. rows of one entity: a new resource (`builder_create_resource`), its fields and types read from the fixture's rows, seeded with those rows only when the user wants sample data;
  3. a figure, a series or a ranking: a query on that resource (`builder_add_query`) whose `response` matches the block, as **dms-builder-mcp** _Data resources and queries_ says.
     A fixture none of these can serve goes in the plan as a question.
- **`TableView` over a fixture** → a `TableView` bound to the resource (`controller` = its ref), its columns from the spec's `columns`.
- **`ResourceForm` over a fixture** → a `ResourceForm` on the resource, with the spec's fields.
- **Sketch** → a `CustomComponent` (from `@antelopejs/interface-dms/base/custom`) with `.meta({ name, description, icon })`, its Vue drawn from the sketch's HTML and CSS with the DMS UI components and theme variables, its data from a route. In Safe mode this is out of reach: ask whether to turn Safe mode off for these components, or to leave each one as a `Placeholder` named after its caption.

The plan lists per page:

- **Build (`builder_compose_page`):** for a new page, `builder_create_page`, then one `builder_compose_page` call with the whole tree; for a converted page, the block changes on `livePage.ref`, through `mockup_apply_to_page` first when you have it; without the builder MCP, the page class.
- **Blocks:** in the spec's order, with their options.
- **Data (`liveRoutes`):** per fixture, its route from `liveRoutes` on a converted page, else the resource or query it binds to; the resources and queries to create.
- **Components (`CustomComponent`):** a `CustomComponent` for each sketch other than a live sketch, or its `Placeholder` in Safe mode.

Write nothing before the user approves it.

## 3. Build

Per page, in the spec's order:

- **Builder MCP:** for a new page, `builder_create_page`, then one `builder_compose_page` call with the page's whole tree, previewed first (`"preview": true`) as **dms-page-design** _Build a page in one call_ says. Create the resources and queries the page reads before the page.
- **Code:** write the page class, its routes and DataControllers with **dms-pages**, then run the typecheck. Page code imports from `@antelopejs/interface-dms` and the other interface packages **dms-pages** names, never from `@antelopejs/dms`, which exports no page API.
- **Custom components:** with **dms-pages**, after the builder's write; then `builder_refresh` on the page when the builder MCP answers.

A page is built when it typechecks and, checked as **dms-builder-mcp** _Verify_ says, shows every block with data.

### Pages converted from a live page

`livePage.version` is the `version` (a hash of the page's source file) that `builder_page_structure` answered at conversion. Compare it with the `version` of `builder_page_structure` on `livePage.ref` for every converted page, when you plan and again before the first write of the build, resources and queries included. A different `version` means the page changed in code since "Edit as mockup": the page is **stale**. Write nothing to it, and ask the user one question that says so and offers to convert it again (`mockup_from_page` with `{ pageRef: livePage.ref, replace: true }`, which discards the mockup's edits) or to build anyway. After a new conversion, start again at step 1. Build anyway only on the user's explicit go: read the structure again and apply the mockup's edits by block name only. The spec's other pages build as planned. Without the builder MCP there is no `version` to compare: build through the code and tell the user the page could not be checked.

**With `mockup_apply_to_page`** among your tools, call it for each converted page before any other write for that page, its resources and queries included: `mockup_apply_to_page({ mockup: "<name>", page: "<spec page id>" })`. It checks the version again itself; your compare before the first write of the build stays.

- `{ ok: true, outcome: "applied", livePage: { ref, version }, stamped, preserved, written, added, removed, wiring }`: the tool wrote the page in one write. It kept the unchanged blocks and the live sketches byte for byte, wrote the option, order, slot and span edits, added and removed blocks, named each new block after its node's `id` (`revenue-2` becomes `revenue_2`), and, with `stamped: true`, recorded `livePage.version` in the spec and gave each new node that had no `id` the name it was written under. `stamped: false` comes with a `message`: the spec changed during the write and its version was left as it was; tell the user that `message`. `preserved`, `written`, `added` and `removed` hold builder paths. Read the page again with `builder_page_structure`, then build only the `wiring` entries with the builder tools and the rules of step 2, and do not redo what the tool wrote. Each entry, `{ pointer, id?, type?, reason, kept? }`, is a spec node the tool did not write, with everything under it (a `parent` entry is about its `kept` block, and a `placement` entry's node was written): `pointer` is its place in `spec.json`, `id` and `type` the node's, and `kept`, when set, the builder path of the live block left as it was there. Edit the `kept` block when there is one, else add the node. By `reason`:
  - `data`: the node reads data the live page does not serve. Wire it to a route or a query, as _Fixture_ says.
  - `custom-component`: a new or edited sketch, or one put in place of a block. Build it as a custom component, as _Sketch_ says.
  - `table`: a table added, retyped, or whose columns, rows or source changed. Bind it to its resource with `builder_configure_table_view`.
  - `held-block`: a block held in an option of its parent (a `ChartCard`'s `chart`) changed or was removed. Configure that option on the parent.
  - `move`: a live block moved to another parent. Move it from `kept` with `builder_move_block`.
  - `parent`: `kept` is a block the mockup removed, left in place because a block inside it could not move out (that block's `move` entry). Remove `kept` once that block is moved.
  - `locked`: a change the page's source locks (an option set in code, the type of such a block, the order, slot or span of its children). Make it in the page class.
  - `type`: a type the builder cannot write there. Build it as a custom component or in the page class.
  - `name`: a new block's `id` gives it the name of another block at its place. Give the node an `id` of its own with `mockup_patch_spec`, then add the block.
  - `placement`: a `slot` or `colSpan` on a top-level block, which the builder lays out in order only. The block was written without it: tell the user, or set it in the page class.

  With an empty `wiring`, nothing is left to write on that page; the built check above and step 4 still apply.

- `{ ok: false, error: "stale", livePage, currentVersion }`: the page is stale, as above, and nothing was written. Building anyway writes the whole page yourself, without the tool.
- `{ ok: false, error: "not_linked" }`: the spec page records no `livePage`, so it is no converted page. Build it with the builder tools as a _Page_ of step 2.
- `{ ok: false, error, message, errors }` with `not_found` (the mockup, the spec page or the live page does not exist), `invalid` (`errors` holds the spec's schema issues or the builder's refusal of the draft, each with its `path`) or `unreadable` (the builder cannot read the page): write nothing to that page, tell the user the `message` and each of the `errors`, and ask. For `invalid` on the spec's schema, offer to fix the spec with **dms-mockup**, then call the tool again. Never create the live page.

Without the tool, write the page yourself. An existing block whose fixture key is in `liveRoutes` reads its live route (_Live route_). Change its existing blocks with `builder_configure_block`, `builder_move_block` and `builder_remove_block`; add the spec's new blocks with `builder_add_block`, or with `builder_compose_page` on that `pageRef` and a `placement`, previewed first (`"preview": true`). Without the builder MCP, edit the existing page class.

Every write of yours to a converted page, a `wiring` entry included, updates the page at `livePage.ref`, never another: no `builder_create_page`. Move a live sketch's neighbours around it, never the block itself. A builder tool's `stale` answer (your read of the structure is outdated): read the page again with `builder_page_structure` and retry. A builder tool's `not_found` answer for the page: ask the user; never create it.

After the last round of step 4, stamp each converted page you wrote yourself (a `wiring` entry, a fix, or the whole page without the tool) with its new version; a page only `mockup_apply_to_page` wrote, answering `stamped: true`, keeps the tool's stamp. Read the version with a fresh `builder_page_structure` and write it with `mockup_patch_spec`: `{ "mockup": "<name>", "patch": [{ "op": "replace", "path": "/pages/<i>/livePage/version", "value": "<version>" }] }`, `<i>` the page's index in the spec. Without `mockup_patch_spec`, set that field in `spec.json`. Without the builder MCP, stamp nothing.

## 4. Verify and fix

A **round** verifies pages, then fixes what failed. Keep going while a page fails, up to **three rounds**: round 1 verifies every page of the plan, each later round the pages that failed before and every page a fix changed, and after the third verify you fix nothing more. A page passes when its last verify, leaving out the lines of its live sketches, finds no failure (with `page_verify`, `ok` or failing only on those lines) and no difference from the mockup, or only differences the user accepted. A page of the plan that was never built, or does not typecheck, fails with that error. A **difference** is a block missing, extra or out of order, another type, another option (title, format, variant, span, columns), a sketch whose component looks otherwise, or a block empty on the real page. Values that differ because real data replaced a fixture are no difference; a block empty where its fixture had data is one. A live sketch's lines are never differences nor fix targets: its sketch with no counterpart, its live block in `extraPageBlocks` or in a failure line. Report them under the live sketches kept, outside `<n>`.

**With `page_verify`**, per page:

1. Call `page_verify({ page: "<route>", mockup: "<name>", mockupPage: "<spec page id>" })`, with the route as `list_pages` answers it, or `livePage.ref` for a converted page, a concrete one for `:params` (such as `/orders/42`). Keep the defaults: the owner, desktop and mobile, writes held back. The first call can take minutes while it installs its browser. An answer without `pages`: check the route with `list_pages` and call once more; if it still has none, verify that page without `page_verify`.
2. Read `pages[].failures` first: one line per failed check (a block in error or empty, a console error, a failed request, an interaction, a permission, a mockup block with no counterpart), and `notes`. Then read `pages[].render.mockup`: absent, or `unavailable` set, means the page was not compared, so compare it as without `page_verify` (by its tree when the dashboard has no `/mockup` viewer); otherwise each `extraPageBlocks` entry other than a live sketch's block is a difference, so is a relative order of the matched blocks that differs from their order in the desktop viewport's `render.viewports[].blocks`, and the `mockupScreenshot` and `pageScreenshot` of each matched block show the option differences the tool does not check.
3. Fix each failure where it starts: the route, resource or query a block in error reads (its `data[].source`), the block tree with the builder tools, or the code.

**Without `page_verify`**, compare visually. The pages are compared with the mockup but not tested, and the summary line of step 5 says so with its suffix: `(compared visually, page_verify is not available)`, or `(compared by tree, page_verify is not available)` without a browser tool:

1. **With a browser tool:** screenshot `/mockup?name=<name>&page=<id>` and the real page, at the desktop width, then at the mobile width (`&width=mobile`, and the same viewport for the real page).
2. **Without one:** compare the spec's tree with `builder_page_structure` (or the page class), node by node, and ask the user with the asking tool to look at the page.
3. Fix each difference with the builder tools or a code edit.

A page compared by its tree fails until the user confirms it.

When `preview_blocks` is among your tools, call it each time you compare a page with the mockup, with the page's tree as built (`static*` options in place of its data) and the mockup as `reference`: `{ url: "/mockup?name=<name>&page=<id>", caption: "Mockup <name>, page <id>" }`. Every `preview_blocks` call of the build carries that reference: the dms-assistant build dialog draws the latest preview beside it. Elsewhere, show the user what the tool answers.

## 5. Report

Open with one summary line, the same in the dms-assistant chat and in any harness: `<passing>/<planned> pages pass, <n> errors`, such as `3/3 pages pass, 0 errors`, even when nothing was built (`0/3 pages pass, 3 errors`). `<planned>` counts the pages of the approved plan, built or not; `<n>` counts the failure lines and differences of the last verify, one per distinct block or check, accepted differences and live sketches' lines excluded, plus one for each failing page that has none (a typecheck error, a page the user has not confirmed, a stale page left unbuilt). When `page_verify` did not compare some pages with the mockup, end the line with how they were compared: without `page_verify`, `(compared visually, page_verify is not available)`, or `(compared by tree, page_verify is not available)` without a browser tool; otherwise `(<k> of <planned> compared visually: <why>)` or `(<k> of <planned> compared by tree: <why>)`, where `<why>` is the `unavailable` text or the answer without `pages`.

Then list every page still failing after the last round, never fewer: its route, each failure line or difference, the error behind it (the console text, the failed request with its status, the typecheck error, a stale page with both versions), and its screenshots: the page's `render.viewports[].screenshot`, the block's `render.viewports[].blocks[].screenshot`, `pageScreenshot` and `mockupScreenshot`, all project-relative, or your own screenshots in the visual comparison. Then the `notes` that qualify a pass (a role checked as the owner, writes held back), and the differences the user accepted, each with its reason.

Then, per page: the blocks built (for a converted page, the blocks configured, moved, removed and added, and the live sketches kept; when `mockup_apply_to_page` wrote the page, read them from its `written`, `added` and `removed`, and the live sketches among its `preserved`), the resources and queries created, and the custom components.

Record the build on the spec: `mockup_patch_spec` with `{ "mockup": "<name>", "patch": [{ "op": "add", "path": "/built", "value": { "at": "<ISO date>", "pages": [{ "path": "<dashboard path>", "title": "<title>" }] } }] }`, one entry per page the build wrote, or set `built` in `spec.json` without that tool. In the same patch, link each new page to the page it was built into, so the Mockups page marks the mockup Out of sync once that page changes: `{ "op": "add", "path": "/pages/<i>/livePage", "value": { "ref": "<pageRef>", "version": "<version>" } }`, `<i>` the spec page's index, `ref` and `version` as a fresh `builder_page_structure` on the built page answers them. A converted page keeps its stamp of step 3. Without the builder MCP, link nothing. Leave `mockups/<name>/` in place: it is the record of what the user approved.
