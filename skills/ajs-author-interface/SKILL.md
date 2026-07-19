---
name: ajs-author-interface
description: Authoring or versioning an AntelopeJS interface package itself (@antelopejs/interface-*). Use when editing an interface's contract surface, defining a new interface, or deciding whether a change is breaking and which version to bump.
---

# Authoring & versioning interfaces

An interface is a **versioned contract** shipped as `@antelopejs/interface-<name>`. Its public surface IS the contract: the `exports` subpaths plus the `.d.ts` they point to. Changing that surface is changing the contract — treat it with the discipline of a public API.

## Anatomy of an interface package

```
interface-<name>/
  src/index.ts          # barrel (named re-exports in practice; AGENTS.md prefers `export * from`)
  src/<area>.ts         # contract surface, grouped by concern (one subpath each)
  src/antelope.test.ts  # test entry (referenced by package.json `antelopeJs.test`)
  dist/*.d.ts           # built contract — what consumers actually type-check against
  docs/                 # hand-written guides (numbered files or directories)
  skills/               # package-shipped skill(s) synced to consumers (package.json `antelopeJs.skills` + `files`) — update when the contract changes
  package.json          # `exports` + `typesVersions` define the subpath surface
```

Each `exports` subpath is an import consumers pin to — add subpaths deliberately, and keep each one cohesive. Inspect any existing interface's shape as a template:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" show <name>
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" contract <name> [subpath]
```

## Declaring contract members

At the boundary, the contract is built from core primitives (see `contract core`):

- `InterfaceFunction<Signature>()` — a callable the implementing module attaches to and the provider must implement. Its result is always resolved asynchronously (calls queue until a provider attaches), so design these as async/promise-returning — never a signature that implies a synchronous, provider-config-dependent return.
- `EventProxy` / `RegisteringProxy` — event and registration attachment points across the boundary.
- Exported `type`/`interface`/`class` — the data shapes that cross the boundary.

But an interface is **not limited to proxy points** — it can (and often should) ship real consumer-side code built over them: chainable builders, helpers, validation, convenience classes. The `database` interface is mostly `Table`/`Query`/`Datum` classes whose methods assemble work locally and only hit a proxy (`RunQuery`) at execution. The rule that enables clean attach/detach on reload isn't "no code" — it's that **the only things that actually cross to the provider are the proxy points**; everything else runs in the caller. Keep signatures explicit (no anonymous inline types — define named interfaces). Add TSDoc to every public member; that TSDoc is what consumers read via `contract`.

**Interfaces may build on other interfaces.** Importing another `@antelopejs/interface-*` package to compose contracts is expected (e.g. `data-api` builds on `api`, `api-util`, `core`, `database`, and `database-decorators` — as `peerDependencies`). When you do, that dependency's version becomes part of your own compatibility surface — a breaking change there can force a bump here.

## Versioning the contract surface

Versions are git tags (`v0.1.1`), cut with release-it (`.release-it.json`, changelog via the release-it-changelogen plugin). Classify every change by its effect on existing consumers:

| Change | Effect |
| --- | --- |
| Add a new optional member, new subpath, new event — existing code keeps compiling & behaving | additive |
| Remove/rename a member, change a signature, tighten a type, change runtime semantics of an existing call | **breaking** |
| Doc/comment/internal-only change, no surface delta | none |

**Reality check on the bump:** while an interface is pre-1.0 (`0.x`), semver signals *intent*, not a guarantee — breaking changes have shipped in the patch position (e.g. `interface-database` v0.1.0→v0.1.1 renamed `CROSS_TENANT`→`CROSS_INSTANCE`, a breaking surface change, as a patch bump). Until an interface hits 1.0, treat any non-additive change as breaking regardless of where the number lands, record it in `CHANGELOG.md`, and assume consumers must pin an exact version and re-verify on every bump.

Verify the surface delta mechanically before tagging. Read the *current* contract with the resolver, and diff the committed source against the previous tag. Note `dist/` is gitignored — only `src/` is in git, so diff `src/` (where the exported declarations and their TSDoc live), not the built `.d.ts`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-interface.mjs" contract <name> [sub]   # inspect the current surface
git -C <interface-repo> diff <prev-tag> HEAD -- src/                               # what changed since the last release
```

If the diff removes or changes any existing exported declaration, it's a breaking change. When in doubt, it's breaking.

## Shipping breaking changes without breaking consumers

Because consumers pin a version, prefer **additive evolution** over mutation:

- Add the new member alongside the old; deprecate the old with TSDoc `@deprecated` rather than deleting it in the same release.
- Reserve a real removal for a deliberate major release, and note it in `CHANGELOG.md`.
- A provider module must implement the full contract surface of the version it exports — when you add a required member, that's breaking for providers too, not just consumers.

## Conventions (enforced in these repos)

pnpm only; English-only; no `switch`/`case` (use maps/objects); functions ≤ ~40 lines; no magic values; no inline/anonymous types; no comments except TSDoc on public APIs; index files: AGENTS.md prefers `export * from './module'`, existing barrels mostly use named re-exports. Publishing rebuilds via the `prepack` hook, but build locally too (`pnpm build`) so `dist/*.d.ts` — the contract consumers see — stays current for local tooling.
