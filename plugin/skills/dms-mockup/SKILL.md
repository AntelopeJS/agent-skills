---
name: dms-mockup
description: Mocks up AntelopeJS DMS apps in mockups/<name>/spec.json before any page is built: interviews the user, matches every wish to a DMS block or a custom sketch, and applies the user's annotations on the mockup. Use when the user wants to mock up, sketch or prototype a DMS app or page, start an app from scratch, or has commented on a mockup.
---

# DMS mockups

A mockup is `mockups/<name>/spec.json` in the project: the pages of an app as trees of real DMS blocks, with **fixtures** standing in for their data and **sketch** nodes standing in for the custom parts. The dev-only `/mockup` page of the running DMS draws the spec with the real renderer and redraws it on every save, with no typecheck and no reload. The user comments on any element there; the comments land in `mockups/<name>/annotations.json`. [SPEC.md](SPEC.md) holds the file formats.

The mockup is done when the user approves it. Building the real pages from it is **dms-mockup-build**.

## Detect what the project has

- **The block catalog.** With the builder MCP (`builder_catalog` among your tools, see **dms-builder-mcp**), `builder_catalog`. Without it, the catalog of the running DMS (`GET /api/block-preview/types`, or the spec schema at `GET /api/mockup/schema`), else the schema file `@antelopejs/dms` ships ([SPEC.md](SPEC.md) _Schema_). The running DMS lists the blocks of the installed modules too; the file lists the core blocks only.
- **The preview.** `/mockup?name=<name>` answers while `ajs project dev` runs. When it does not, write and validate the spec all the same, show the user each page as a text outline (one line per block, sketches marked _Custom_), and tell them `ajs project dev` turns it into a live preview.
- **Annotations.** When `mockup_annotations` is among your tools, it lists them and `mockup_resolve_annotation` resolves one. Without them, use the HTTP API of the running DMS, else edit `mockups/<name>/annotations.json` directly ([SPEC.md](SPEC.md) _annotations.json_).
- **Writing the spec.** When `mockup_write_spec` and `mockup_patch_spec` are among your tools, every write of the spec goes through them: `mockup_write_spec` creates the mockup (and rewrites it only when the user asks to start over), `mockup_patch_spec` (RFC 6902 operations) makes every other change. Both validate and write `spec.json` only, and Safe mode allows them, as it allows `mockup_resolve_annotation`. Without them, write the file directly.
- **The asking tool**: `ask_user` in the dms-assistant chat, your harness's question tool elsewhere (`AskUserQuestion` in Claude Code), else one closed question in chat. Batch questions: up to 4 per call.

## 1. Interview

Collect the user's **wishes**: each thing a screen must show or let someone do. Ask, in as few rounds as the answers allow:

- what the app is for, and who opens it (roles);
- the pages, and for each the question it answers or the job it does;
- the data each page shows: entities, their main fields, the figures that matter;
- the actions: create, edit, approve, export, …;
- a reference: a screenshot, a Figma frame, another product. When there is one, frame it once as **dms-best-practices** _Design-fidelity protocol_ step 1 says.

When the project already has a database or resources (`builder_list_resources`, `database_connections`), read their names and fields first, never their rows, and ask only what they do not answer. Data pages follow **dms-page-design**: its shapes, layout and naming rules decide the blocks of an analytics or table page.

The interview is done when every page has a purpose, its data and its actions, and every wish names the page it lives on.

## 2. Check every wish against the catalog

For each wish, find the closest DMS block or composition in the catalog, with the mapping table of **dms-best-practices** [REFERENCE.md](../dms-best-practices/REFERENCE.md). Then:

- **A block covers it** (through its options or a composition): use it. A difference the theme or the options handle is no question.
- **Nothing covers it, or the user asked for exactly this look**: propose the choice as **dms-best-practices** _Before any custom block_ says, with the closest DMS option beside a **sketch** of the custom part, one closed question per element or batch: _Keep the DMS block_ / _Adjust it through its options_ / _Build a custom block_. Only _Build a custom block_ puts a sketch in the spec.

This step is done when every wish maps to a block, a composition, or a sketch the user chose.

## 3. Write the spec live

The user watches the mockup fill in `/mockup?name=<name>`, so write it in small saves, never as one big spec: each save redraws the viewer in under a second, while one call that types the whole spec shows nothing until it ends and, when it fails validation, loses all of it. Follow [SPEC.md](SPEC.md) _Writing in steps_:

1. **Create it empty.** `mockup_write_spec` with `pages: []`, the `title` and the `source` (`claude-code` in Claude Code, `codex` in Codex, left out when you cannot tell which harness runs you). `<name>` is kebab case, from the app or the area: `crm`, `stock-dashboard`. Give the user the link `/mockup?name=<name>` now, before any page exists.
2. **Add the pages one at a time**, each as a skeleton: one `mockup_patch_spec` with `add` at `/pages/-`, the page with all its blocks in reading order, each with an `id` and a title, and its data as `$generate` fixtures.
3. **Fill each page section by section**: 2 or 3 related blocks per patch (the KPI row, then the table, then the form). Never one call per block, never the whole spec in one call.
4. **Data.** Use `$generate` with the default 8 rows. Write hand values only where a figure must read true: a KPI headline, a total repeated on another page. Keep entities, names and figures coherent across pages, and over existing resources use the columns and types they declare.
5. **Sketches.** One per custom part the user chose, kept to that element.
6. **A failed patch** costs only that patch: its `errors` name the nodes. Fix it and send it again, never rewrite the spec.

Texts are in the user's language. Without `mockup_write_spec` and `mockup_patch_spec`, edit `spec.json` in the same order, one save per step: the file empty first, then each page, then each section.

Validate every save: `mockup_write_spec` and `mockup_patch_spec` answer their `errors`; otherwise `GET /api/mockup/<name>` answers every issue with the JSON pointer of its node ([SPEC.md](SPEC.md) _Validation_); without a running DMS, check the file against the schema. The step is done when the last save has no issue and every page of the interview exists.

## 4. Iterate on annotations

When the user says they commented, or asks what is left, list the open annotations. For each one:

1. Find the node it is pinned on, and the wish behind it. `mockup_annotations` answers each annotation's block with its JSON pointer and its node: patch from those, and read `spec.json` only for what they do not show. Read the spec with the mockup tools or the file tools, never with a shell command: Safe mode refuses shell commands.
2. Change the spec. A request the DMS blocks cannot meet goes through step 2 again, never straight to a sketch.
3. Resolve the annotation, and note what changed for the report.

Save after each batch, as one `mockup_patch_spec` call when it is among your tools: the preview redraws on its own. A patch that fails, or a spec it leaves invalid, is not written: fix it and send it again. Report the annotations you resolved and those you left open, with the question each one raises.

The mockup is done when no annotation is open and the user approves it. Then offer **dms-mockup-build**.
