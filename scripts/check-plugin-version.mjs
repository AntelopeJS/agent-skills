#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { fieldOf } from "../plugin/scripts/lib/safe-read.mjs";
import { isText } from "../plugin/scripts/lib/values.mjs";

const EXIT = { ok: 0, failed: 1, usage: 2 };
const RELEASED_REF = "origin/main";
const PLUGIN_DIR = "plugin";
const MANIFEST = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;
const PACKAGE_DIR = `${PLUGIN_DIR}/packages/agent-skills/`;
/** The files of `@antelopejs/agent-skills` the plugin runs; the rest of the package ships only in its own npm release. */
const PACKAGE_RUNTIME = new Set([`${PACKAGE_DIR}index.mjs`]);
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const USAGE = `Usage: check-plugin-version [--released <ref>] [dir]

Fails when the checkout at dir (default cwd) changes a file the plugin ships
under ${PLUGIN_DIR}/ since it left <ref> (default ${RELEASED_REF}, the released
plugin) while the version in ${MANIFEST} is not greater than the one at <ref>.
`;

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * @param {string} path a repository-relative path under the plugin folder
 * @returns {boolean} whether an installed copy of the plugin runs or reads it
 */
function isShipped(path) {
  return !path.startsWith(PACKAGE_DIR) || PACKAGE_RUNTIME.has(path);
}

/**
 * @param {string} root
 * @param {string} ref
 * @returns {string | null} the commit ref names, or null when this checkout lacks it
 */
function commitOf(root, ref) {
  try {
    return git(root, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]).trim();
  } catch {
    return null;
  }
}

/**
 * @param {string} root
 * @param {string} released
 * @returns {string} where the checkout left the released history, or the released commit when a shallow clone cannot tell
 */
function branchPoint(root, released) {
  try {
    return git(root, ["merge-base", released, "HEAD"]).trim();
  } catch {
    return released;
  }
}

/**
 * @param {string} root
 * @param {string} base
 * @returns {string[]} the shipped paths that differ between base and the working tree, untracked files included
 */
function changedShippedPaths(root, base) {
  const changed = git(root, [
    "-c",
    "core.quotepath=off",
    "diff",
    "--name-only",
    "--no-renames",
    base,
    "--",
    PLUGIN_DIR,
  ]);
  const untracked = git(root, [
    "-c",
    "core.quotepath=off",
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    PLUGIN_DIR,
  ]);
  return `${changed}${untracked}`.split("\n").filter(Boolean).filter(isShipped);
}

/**
 * @param {unknown} version
 * @returns {number[] | null} major, minor and patch
 */
function parseVersion(version) {
  const match = isText(version) ? version.match(SEMVER_RE) : null;
  return match ? match.slice(1).map(Number) : null;
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @returns {boolean}
 */
function isGreater(left, right) {
  const index = left.findIndex((part, at) => part !== right[at]);
  return index !== -1 && left[index] > right[index];
}

/**
 * @param {string} root
 * @param {string} ref
 * @returns {string[]}
 */
function check(root, ref) {
  const commit = commitOf(root, ref);
  if (!commit)
    return [
      `cannot read ${ref}, the released plugin; fetch it (git fetch origin main) or name another commit with --released.`,
    ];
  const shipped = changedShippedPaths(root, branchPoint(root, commit));
  if (shipped.length === 0) return [];
  const releasedVersion = fieldOf(
    JSON.parse(git(root, ["show", `${commit}:${MANIFEST}`])),
    "version",
  );
  const currentVersion = fieldOf(
    JSON.parse(readFileSync(join(root, MANIFEST), "utf8")),
    "version",
  );
  const released = parseVersion(releasedVersion);
  const current = parseVersion(currentVersion);
  if (!released || !current)
    return [
      `${MANIFEST}: version must be MAJOR.MINOR.PATCH here (${String(currentVersion)}) and at ${ref} (${String(releasedVersion)}).`,
    ];
  if (isGreater(current, released)) return [];
  return [
    `${MANIFEST}: version ${String(currentVersion)} is not greater than ${String(releasedVersion)} at ${ref}, but this branch changes the plugin; installed copies update only when version grows. Bump it (patch for a fix, minor for a new skill or behaviour, major for a breaking change) in both plugin manifests and package.json, and add a CHANGELOG.md entry. Changed:`,
    ...shipped.map((path) => `  ${path}`),
  ];
}

function parseCommandLine() {
  return parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      released: { type: "string", default: RELEASED_REF },
    },
    allowPositionals: true,
  });
}

/**
 * @returns {number}
 */
function main() {
  /** @type {ReturnType<typeof parseCommandLine> | null} */
  let args;
  try {
    args = parseCommandLine();
  } catch {
    args = null;
  }
  if (!args || args.values.help || args.positionals.length > 1) {
    process.stdout.write(USAGE);
    return args?.values.help ? EXIT.ok : EXIT.usage;
  }
  const root = resolve(args.positionals[0] ?? process.cwd());
  const failures = check(root, args.values.released);
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  return failures.length ? EXIT.failed : EXIT.ok;
}

process.exit(main());
