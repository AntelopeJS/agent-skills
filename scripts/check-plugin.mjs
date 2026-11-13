#!/usr/bin/env node

import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { parseFrontmatter } from "./lib/frontmatter.mjs";
import { fieldOf } from "../plugin/scripts/lib/safe-read.mjs";
import { isRecord, isText } from "../plugin/scripts/lib/values.mjs";

const EXIT = { ok: 0, failed: 1, usage: 2 };
const PLUGIN_DIR = "plugin";
const PLUGIN_SOURCE = `./${PLUGIN_DIR}`;
const ROOT_MANIFEST = "plugin.json";
const CLAUDE_MANIFEST = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;
const CODEX_MANIFEST = `${PLUGIN_DIR}/.codex-plugin/plugin.json`;
const PACKAGE_MANIFEST = "package.json";
const CLAUDE_MARKETPLACE = ".claude-plugin/marketplace.json";
const CODEX_MARKETPLACE = ".agents/plugins/marketplace.json";
const CLAUDE_HOOKS = `${PLUGIN_DIR}/hooks/hooks.json`;
const CODEX_HOOKS_PATH = "./hooks/codex-hooks.json";
const CODEX_HOOKS = `${PLUGIN_DIR}/hooks/codex-hooks.json`;
const COMMANDS_DIR = `${PLUGIN_DIR}/commands`;
const SKILLS_DIR = `${PLUGIN_DIR}/skills`;
const SKILL_FILE = "SKILL.md";
const CONTEXT_FILE = "CLAUDE.md";
const SKIPPED_DIRS = new Set(["node_modules"]);
const TEXT_FILE_RE = /\.(?:md|json|mjs|cjs|js|ts|sh|ya?ml|toml|txt)$/;
const PLUGIN_SKILLS = [
  "dms-best-practices",
  "dms-builder-mcp",
  "dms-external-database",
  "dms-mockup",
  "dms-mockup-build",
  "dms-page-design",
  "dms-pages",
  "interface",
  "new-module",
  "skills",
  "sync-skills",
];
const TOOL_SPECIFIC_RE = /\$ARGUMENTS|\$\d|\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/;
const FRONTMATTER_LINES_RE = /^---\r?\n([\s\S]*?)\r?\n---/;
const ALLOWED_TOOLS_KEY = "allowed-tools";
const TOP_LEVEL_KEY_RE = /^([A-Za-z0-9_-]+):(?: (.*))?$/;
const RULE_LINE_RE = /^ {2}- (?:'(Bash\([^'#]+\))'|(Bash\([^'"#]+\)))$/;
const BASH_RULE_RE = /^Bash\((.*)\)$/;
const ARGS = String.raw`(?: [^"'\`$;&|<>()]+)?`;
const SCRIPT_RULE_RE = new RegExp(
  String.raw`^node "\$\{(?:CLAUDE_SKILL_DIR\}/\.\./\.\.|CLAUDE_PLUGIN_ROOT\})/scripts/([\w-]+\.mjs)"${ARGS}$`,
);
const PROGRAM_RULE_RE = new RegExp(
  String.raw`^([a-z][\w-]*) [a-z][\w-]*${ARGS}$`,
);
/** The programs whose subcommands a skill may pre-approve: the CLIs the skills drive, none of which runs arbitrary code. */
const ALLOWED_PROGRAMS = new Set(["ajs"]);
const LAUNCHER_RE =
  /(?:^|[\s`"'(])(npx|bunx|uvx|pnpm dlx|yarn dlx|pipx run|uv run)\s/m;
const USAGE = `Usage: check-plugin [dir]

Checks that the plugin under dir/${PLUGIN_DIR} (dir defaults to cwd) loads the
same way in Claude Code and Codex and holds nothing the Claude plugin directory
review holds. Prints each failure and exits 1 when there is one.
`;

/**
 * @param {string} root
 * @param {string} path
 * @param {string[]} failures
 * @returns {unknown}
 */
function readJson(root, path, failures) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    failures.push(
      `${path}: cannot read it as JSON (${error instanceof Error ? error.message : "unreadable"})`,
    );
    return null;
  }
}

/**
 * @param {string} root
 * @param {string[]} failures
 */
function checkManifests(root, failures) {
  for (const path of [ROOT_MANIFEST, `${PLUGIN_DIR}/${ROOT_MANIFEST}`])
    if (existsSync(join(root, path)))
      failures.push(
        `${path}: Codex reads a root manifest before .codex-plugin/plugin.json; with the agent-plugins.org $schema it loads no hooks, without it Codex falls back to .claude-plugin/plugin.json. Delete it.`,
      );
  /** @type {[string, unknown][]} */
  const manifests = [CLAUDE_MANIFEST, CODEX_MANIFEST, PACKAGE_MANIFEST].map(
    (path) => [path, readJson(root, path, failures)],
  );
  const [[, claude], [, codex]] = manifests;
  if (claude && fieldOf(claude, "hooks") !== undefined)
    failures.push(
      `${CLAUDE_MANIFEST}: "hooks" must be absent; the Claude plugin directory holds a hook that runs a script it cannot follow.`,
    );
  const codexHooks = fieldOf(codex, "hooks");
  if (codex && codexHooks !== CODEX_HOOKS_PATH)
    failures.push(
      `${CODEX_MANIFEST}: "hooks" must be "${CODEX_HOOKS_PATH}", not ${JSON.stringify(codexHooks)}.`,
    );
  const read = manifests.filter(([, data]) => data);
  const versions = new Set(read.map(([, data]) => fieldOf(data, "version")));
  if (versions.size > 1)
    failures.push(
      `version differs across manifests (${read.map(([path, data]) => `${path} ${String(fieldOf(data, "version"))}`).join(", ")}); installed copies update only when it changes.`,
    );
}

/**
 * @param {unknown} marketplace
 * @param {(entry: unknown) => unknown} sourceOf
 * @returns {unknown[]} the sources that are not the plugin directory
 */
function strayMarketplaceSources(marketplace, sourceOf) {
  const plugins = fieldOf(marketplace, "plugins");
  if (!Array.isArray(plugins) || plugins.length === 0) return [undefined];
  return plugins.map(sourceOf).filter((source) => source !== PLUGIN_SOURCE);
}

/** Where each marketplace names the folder of its plugin entries. */
const MARKETPLACES = [
  {
    path: CLAUDE_MARKETPLACE,
    sourceOf: (/** @type {unknown} */ entry) => fieldOf(entry, "source"),
  },
  {
    path: CODEX_MARKETPLACE,
    sourceOf: (/** @type {unknown} */ entry) =>
      fieldOf(fieldOf(entry, "source"), "path"),
  },
];

/**
 * @param {string} root
 * @param {string[]} failures
 */
function checkMarketplaces(root, failures) {
  for (const { path, sourceOf } of MARKETPLACES) {
    const marketplace = readJson(root, path, failures);
    if (!marketplace) continue;
    for (const source of strayMarketplaceSources(marketplace, sourceOf))
      failures.push(
        `${path}: a plugin source must be "${PLUGIN_SOURCE}", not ${String(JSON.stringify(source))}; the repository root holds contributor files the plugin directory reviews as plugin content.`,
      );
  }
}

/**
 * Reads the allowed-tools rules in the one form this check accepts, and every
 * other frontmatter line it cannot place: each top-level line is a bare
 * `key:` or `key: value`, and allowed-tools is a block list of `  - Bash(…)`
 * lines with no comment or blank line. A rule a YAML parser would read can
 * therefore never be skipped here.
 * @param {string} text
 * @returns {{ rules: string[], unreadable: string[] }}
 */
function readAllowedTools(text) {
  const lines = (text.match(FRONTMATTER_LINES_RE)?.[1] ?? "").split(
    /\r\n|\r|\n/,
  );
  /** @type {string[]} */
  const rules = [];
  /** @type {string[]} */
  const unreadable = [];
  let inList = false;
  for (const line of lines) {
    if (inList || !/^\s|^$/.test(line)) {
      const key = line.match(TOP_LEVEL_KEY_RE);
      if (key) {
        inList = key[1] === ALLOWED_TOOLS_KEY;
        if (inList && (key[2] ?? "").trim() !== "") unreadable.push(line);
        continue;
      }
    }
    if (!inList && /^\s|^$/.test(line)) continue;
    const item = inList ? line.match(RULE_LINE_RE) : null;
    if (item) rules.push(item[1] ?? item[2]);
    else unreadable.push(line);
  }
  return { rules, unreadable };
}

/**
 * @param {string} root
 * @param {string} rule
 * @returns {boolean} whether the rule names one command of the plugin or one subcommand of a CLI the skills drive
 */
function isExactRule(root, rule) {
  const command = rule.match(BASH_RULE_RE)?.[1] ?? "";
  const script = command.match(SCRIPT_RULE_RE);
  if (script) return existsSync(join(root, PLUGIN_DIR, "scripts", script[1]));
  return ALLOWED_PROGRAMS.has(command.match(PROGRAM_RULE_RE)?.[1] ?? "");
}

/**
 * @param {string} root
 * @param {string} path
 * @param {string} text
 * @param {string[]} failures
 */
function checkAllowedTools(root, path, text, failures) {
  const { rules, unreadable } = readAllowedTools(text);
  for (const line of unreadable)
    failures.push(
      `${path}: frontmatter line ${JSON.stringify(line)} is not a bare "key: value" or, under allowed-tools, a "  - Bash(<rule>)" item; write one rule per line, with no comment, blank line, tag or anchor.`,
    );
  for (const rule of rules.filter((entry) => !isExactRule(root, entry)))
    failures.push(
      `${path}: allowed-tools "${rule}" pre-approves more than one command; name a plugin script (Bash(node "\${CLAUDE_SKILL_DIR}/../../scripts/x.mjs" show *)) or a subcommand of ${[...ALLOWED_PROGRAMS].join(", ")} (Bash(ajs module init *)).`,
    );
}

/**
 * @param {string} root
 * @param {string} name
 * @param {string[]} failures
 */
function checkSkill(root, name, failures) {
  const path = `${SKILLS_DIR}/${name}/${SKILL_FILE}`;
  if (!existsSync(join(root, path))) {
    failures.push(`${path}: missing.`);
    return;
  }
  const text = readFileSync(join(root, path), "utf8");
  const { data, body } = parseFrontmatter(text);
  if (data.name !== name)
    failures.push(`${path}: "name" must be "${name}", the directory name.`);
  if (!data.description) failures.push(`${path}: "description" is missing.`);
  const placeholder = body.match(TOOL_SPECIFIC_RE);
  if (placeholder)
    failures.push(
      `${path}: "${placeholder[0]}" is expanded by one tool only; take arguments from the request and reach scripts relative to the skill directory.`,
    );
  checkAllowedTools(root, path, text, failures);
}

/**
 * @param {string} root
 * @param {string[]} failures
 */
function checkSkills(root, failures) {
  if (existsSync(join(root, COMMANDS_DIR)))
    failures.push(
      `${COMMANDS_DIR}/: Codex has no plugin commands and turns them into duplicate skills; write ${SKILLS_DIR}/<name>/${SKILL_FILE} instead.`,
    );
  const present = existsSync(join(root, SKILLS_DIR))
    ? readdirSync(join(root, SKILLS_DIR))
    : [];
  for (const name of present.filter((entry) => !PLUGIN_SKILLS.includes(entry)))
    failures.push(
      `${SKILLS_DIR}/${name}: the plugin ships only ${PLUGIN_SKILLS.join(", ")}; a module's own API skill ships with the module and reaches projects through the sync, so a copy here would shadow the version a project installs.`,
    );
  for (const name of PLUGIN_SKILLS) checkSkill(root, name, failures);
}

/**
 * @param {unknown} group
 * @returns {boolean}
 */
function isHookGroup(group) {
  return (
    isRecord(group) &&
    Array.isArray(group.hooks) &&
    group.hooks.every(
      (hook) => isRecord(hook) && isText(hook.type) && isText(hook.command),
    )
  );
}

/**
 * @param {string} root
 * @param {string[]} failures
 */
function checkHooks(root, failures) {
  if (existsSync(join(root, CLAUDE_HOOKS)))
    failures.push(
      `${CLAUDE_HOOKS}: the Claude plugin directory holds hooks that run a script it cannot follow unless the organization is Verified; delete it and sync through the sync-skills skill.`,
    );
  const codex = readJson(root, CODEX_HOOKS, failures);
  if (!codex) return;
  const events = fieldOf(codex, "hooks");
  const isHooksFile =
    isRecord(events) &&
    Object.values(events).every(
      (groups) => Array.isArray(groups) && groups.every(isHookGroup),
    );
  if (!isHooksFile) failures.push(`${CODEX_HOOKS}: not shaped as a hooks file`);
}

/**
 * @param {string} dir
 * @param {string} relative
 * @returns {Generator<{ path: string, symlink: boolean }>}
 */
function* walk(dir, relative) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const path = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) yield { path, symlink: true };
    else if (entry.isDirectory()) yield* walk(join(dir, entry.name), path);
    else yield { path, symlink: false };
  }
}

/**
 * @param {string} root
 * @param {string[]} failures
 */
function checkContent(root, failures) {
  if (!lstatSync(join(root, PLUGIN_DIR), { throwIfNoEntry: false })) return;
  if (existsSync(join(root, PLUGIN_DIR, CONTEXT_FILE)))
    failures.push(
      `${PLUGIN_DIR}/${CONTEXT_FILE}: a plugin's ${CONTEXT_FILE} is never loaded; ship that context as a skill.`,
    );
  for (const { path, symlink } of walk(join(root, PLUGIN_DIR), PLUGIN_DIR)) {
    if (symlink) {
      failures.push(
        `${path}: a symbolic link; the plugin directory reviews regular files only, so commit the file itself.`,
      );
      continue;
    }
    if (!TEXT_FILE_RE.test(path)) continue;
    const launcher = readFileSync(join(root, path), "utf8").match(LAUNCHER_RE);
    if (launcher)
      failures.push(
        `${path}: "${launcher[1]}" downloads and runs a package; run a script the plugin ships instead.`,
      );
  }
}

/**
 * @returns {number}
 */
function main() {
  const { values, positionals } = parseArgs({
    options: { help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help || positionals.length > 1) {
    process.stdout.write(USAGE);
    return values.help ? EXIT.ok : EXIT.usage;
  }
  const root = resolve(positionals[0] ?? process.cwd());
  /** @type {string[]} */
  const failures = [];
  checkManifests(root, failures);
  checkMarketplaces(root, failures);
  checkSkills(root, failures);
  checkHooks(root, failures);
  checkContent(root, failures);
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  return failures.length ? EXIT.failed : EXIT.ok;
}

process.exit(main());
