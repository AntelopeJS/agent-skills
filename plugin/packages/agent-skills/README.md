# @antelopejs/agent-skills

Finds the agent skills that AntelopeJS packages ship. The Claude Code and Codex plugin of [AntelopeJS/agent-skills](https://github.com/AntelopeJS/agent-skills) and the dms-assistant module both call it, so they see the same skills.

A package ships skills by declaring `antelopeJs.skills` in its `package.json`: directories (relative to the package root) whose subdirectories each hold a `SKILL.md`. This package decides which packages count and which copy of each wins. Reading the skills inside the directories, and naming them, stays with the caller.

```js
import { collectSkillPackages } from "@antelopejs/agent-skills";

const packages = collectSkillPackages({
  modules: [{ dir: "/app/.antelope/cache/dms", id: "dms" }],
  project: "/app",
  installed: ["/app/node_modules/@antelopejs/core"],
  onWarning: (message) => console.warn(message),
});
```

Each result is `{ name, version, dir, skillDirs, kind }`. `skillDirs` are absolute and inside `dir`.

## Priority

Candidates are ordered, and the first one to carry a package name keeps it:

1. the `modules`, in the order given, then the `installed` directories whose `package.json` sets `antelopeJs.implements`;
2. the `dependencies` and `optionalDependencies` of every module, resolved from the module's real path through `node_modules/<dep>` in its ancestors;
3. the `dependencies`, `optionalDependencies` and `devDependencies` of `project`, resolved the same way;
4. the `installed` directories.

A module or dependency with a readable manifest and a name reserves that name even when it ships no skills, so the copy a runtime runs always hides an installed copy. A package without a `name` falls back to the module `id`, or to the dependency's own name, and is skipped when it has neither.

Only packages with at least one skill directory are returned. A skill directory outside its package is dropped and reported through `onWarning`. A missing or malformed `package.json` reads as absent and never throws.

## Workflow skills

The package also carries the DMS workflow skills of the `antelopejs` plugin (`dms-pages`, `dms-best-practices`, `dms-builder-mcp`, `dms-page-design`, `dms-external-database`, `dms-mockup`, `dms-mockup-build`), copied from `plugin/skills/` when it is packed. They teach building in the DMS and ship with no module, so a runtime that loads them gives its agent the same guidance as the plugin.

```js
import { workflowSkillsDir } from "@antelopejs/agent-skills";
```

`workflowSkillsDir` is the absolute path of their directory: one subdirectory per skill, each holding a `SKILL.md`. The package does not declare them in `antelopeJs.skills`, so the plugin's sync never links them a second time into a project that installs this package. A source checkout has the directory only while the package is packed.

## Requirements

Node.js 20.19 or later. The package is an ES module with no dependencies and no top-level `await`, so a CommonJS caller loads it with `require()`.
