---
name: ajs-cli
description: Running the `ajs` CLI. Use when creating, running, building, testing, or managing modules in an AntelopeJS project, or when the user asks what an `ajs` command does.
---

# The `ajs` CLI

`ajs` is the entry point to the AntelopeJS core. Three command groups: `project`, `module`, `config`. Run any command with `--help` for current flags — this skill covers the workflows. **Always pnpm**, never npm/yarn, in these projects.

## Projects

```bash
ajs project init <path>      # new project: antelope.config.ts + a first module (scaffolds one or imports an existing one)
ajs project dev              # load & connect all modules, run (alias: ajs project run)
ajs project dev --watch      # hot-reload on change  (-w)
ajs project dev -e production    # select an environment from the config (env var: ANTELOPEJS_LAUNCH_ENV)
ajs project dev -i           # REPL against the running project
ajs project dev --inspect    # enable the Node inspector (default 127.0.0.1:9229); combine with -w to debug
ajs project build            # download modules, validate the module graph, write .antelope/build/build.json
ajs project start            # launch from the build artifact (skips download + graph validation) — production
ajs project logging          # view/configure logging (subcommands: show, set)
```

`dev` validates and wires the module graph every run; `start` trusts a prior `build`. Use `build` + `start` in production/CI, `dev --watch` while developing. Both `dev` and `start` accept `-c, --concurrency <number>`.

## Modules in a project

```bash
ajs project modules list                 # show configured modules + their sources (alias: ls)
ajs project modules add <modules...>     # add modules you name explicitly (-m, --mode package|git|local|dir; default package = npm)
ajs project modules remove <modules...>  # remove from config (alias: rm; -f, --force)
ajs project modules update               # update modules to their latest versions (--dry-run; optional module filter)
ajs project modules install              # detect & resolve unresolved imports; install module deps
```

`modules install` (not `add`) is how you fix **unresolved imports**: it finds the interfaces no loaded module provides, lists the implementing modules from the registry manifest, prompts you to pick one, and writes it into `antelope.config`. `add` only adds modules you name — it does no interface resolution.

## Authoring a module

```bash
ajs module init <path>       # scaffold a module from a template (proposes interfaces to install)
ajs module test [path]       # run the module's tests via Mocha (-f, --file <path> to target specific files)
```

`ajs module test` reads the module's `antelopeJs.test` entry (e.g. `src/antelope.test.ts`) as a test *config*, then discovers `.test.ts`/`.spec.ts` files under the `test` folder (or the config's `folder`) plus interface tests. `init` and `test` are the only `ajs module` subcommands.

A module's `package.json` carries an `antelopeJs` block (it can also live in a dedicated `antelope.module.json`). The interface-relevant fields are `implements` (the interface packages this module *provides*, e.g. `["@antelopejs/interface-database"]`) and `test` (the test entry); other fields: `defaultConfig`, `baseUrl`, `paths`, `moduleAliases`. Interfaces a module *consumes* are ordinary `dependencies` (or `optionalDependencies`), not a manifest field — see **ajs-consume-interface**. `ajs module init` sets this up; after editing deps, run `ajs project modules install` to resolve.

## Config

```bash
ajs config show|get|set|reset    # CLI settings; the only key is `git` (the interfaces registry URL)
```

The interfaces registry defaults to `https://github.com/AntelopeJS/interfaces.git`; a non-official URL triggers a warning. Override per-command with `-g, --git <url>` (env var: `ANTELOPEJS_GIT`) where supported (`modules install`, `module init`).

## Common flags

`--verbose[=channels]` is the top-level option (`ANTELOPEJS_VERBOSE`) that raises log level. `-p, --project <path>` (or `ANTELOPEJS_PROJECT`, targets a project dir) and `-e, --env` (`ANTELOPEJS_LAUNCH_ENV`, selects an environment) are options on the individual commands that accept them, not a single global namespace. When a command misbehaves, re-run with `--verbose` before guessing.

If `ajs` warns it is outdated, the CLI ships as the global `@antelopejs/core` package — the warning suggests `npm install -g @antelopejs/core@latest`. It is harmless otherwise.
