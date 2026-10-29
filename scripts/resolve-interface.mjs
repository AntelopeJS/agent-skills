#!/usr/bin/env node
/**
 * Layer 3 resolver for the AntelopeJS knowledge plugin.
 *
 * Interface contracts are *data*, not prose: they live in the versioned packages
 * that ship them. This script reads that source of truth on demand so the skills
 * never hand-maintain (and never stale) per-interface docs.
 *
 * Two shapes of interface are supported:
 *   1. Dedicated interface packages — `@<scope>/interface-<name>`, e.g.
 *      `@antelopejs/interface-database` in the public scope, or
 *      `@acme/interface-payments` in any other scope. The whole package is one
 *      interface; its `exports` subpaths are its parts.
 *   2. Host-package interfaces — exposed as SUBPATHS of a host package, e.g.
 *      `@acme/dms-host/interfaces/<group>` or a module's singular
 *      `@acme/broker/interface`. One host package hosts many interface
 *      "groups" under `<baseUrl>/interfaces/<group>/`.
 *
 * Nothing beyond the framework's public `@antelopejs` scope is hardcoded.
 * Additional scopes are DISCOVERED from the project the script runs in: every
 * dependency (or optionalDependency) in the cwd's package.json matching
 * `@<scope>/interface-*` contributes its scope, and `AJS_INTERFACE_SCOPES`
 * (comma-separated) adds more. Host packages are discovered too: a package is a
 * host when its package.json sets `antelopeJs.dms` or exports `./interfaces/*`
 * subpaths — candidates come from the project's dependencies (looked up in
 * node_modules and the CLI's `.antelope/cache`), a scan of `.antelope/cache`
 * itself, a directory walk of AJS_DMS_DIR / the cwd, and `AJS_DMS_PACKAGES`.
 *
 * Source of truth is the registry (npm) — no local checkout required. Published
 * tarballs ship the built `.d.ts`, so the script fetches `<pkg>@<version>` on
 * demand, caches the extracted tarball, and reads it. `npm` honours the user's
 * `.npmrc`, so scopes served from private registries resolve too — the script
 * never needs to know which registry a scope lives on. A locally present copy
 * is used as an offline fast-path when available, never required.
 *
 * Naming the interface:
 *   database | interface-database | @antelopejs/interface-database  (kind 1)
 *   payments                    (kind 1, tried across discovered scopes)
 *   @acme/interface-payments    (kind 1, explicit scope)
 *   @acme/dms-host/interfaces/dms-base         (kind 2, full)
 *   @acme/dms-host/interfaces/dms-base/form    (kind 2, a part)
 *   @acme/broker/interface                     (kind 2, singular)
 *   dms-host:dms-base    (kind 2 shorthand — <host-short-name>:<group>)
 *   dms-base             (bare — resolved against discovered host packages)
 * Any of the above may carry `@<version>` on the package (default: dist-tag latest).
 *
 * Flags: --remote (force a fresh npm fetch), --offline (local only, no network),
 *        --json (machine output for list/show).
 * Env: AJS_INTERFACE_SCOPES (extra npm scopes to try for bare names, comma-sep),
 *      AJS_INTERFACES_DIR (extra local interface-package roots, colon-sep),
 *      AJS_DMS_PACKAGES (extra host package names, comma-sep),
 *      AJS_DMS_DIR (local host source roots to scan, colon-sep),
 *      AJS_RESOLVER_CACHE (tarball cache dir), AJS_RESOLVER_OFFLINE=1 (= --offline).
 *
 * Usage:
 *   resolve-interface.mjs list                       Interfaces on npm + any local (incl. hosts)
 *   resolve-interface.mjs show <name>[@version]      Metadata + export subpaths + exported symbols
 *   resolve-interface.mjs contract <name>[@version] [subpath]   Print the raw .d.ts for a part ('.' default)
 *   resolve-interface.mjs versions <name>            Published versions + dist-tag latest
 *   resolve-interface.mjs implementations <name>     Known implementations (registry manifest; n/a for host interfaces)
 */

import {
  cmdContract,
  cmdImplementations,
  cmdList,
  cmdShow,
  cmdVersions,
} from "./lib/resolver/commands.mjs";
import { fail, flags } from "./lib/resolver/support.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a) => !a.startsWith("--"));
const json = flags.has("--json");

const COMMANDS = {
  list: () => cmdList(json),
  show: () => cmdShow(positional[0], json),
  contract: () => cmdContract(positional[0], positional[1]),
  versions: () => cmdVersions(positional[0]),
  implementations: () => cmdImplementations(positional[0]),
};

const handler = COMMANDS[cmd];
if (!handler) {
  fail(
    `unknown command '${cmd ?? ""}'. One of: ${Object.keys(COMMANDS).join(", ")}`,
  );
}
if (cmd !== "list" && !positional[0])
  fail(`'${cmd}' requires an interface name`);
await handler();
