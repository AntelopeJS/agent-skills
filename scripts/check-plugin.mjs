#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { parseFrontmatter } from "./lib/frontmatter.mjs";

const EXIT = { ok: 0, failed: 1, usage: 2 };
const ROOT_MANIFEST = "plugin.json";
const CLAUDE_MANIFEST = ".claude-plugin/plugin.json";
const CODEX_MANIFEST = ".codex-plugin/plugin.json";
const PACKAGE_MANIFEST = "package.json";
const CODEX_HOOKS_PATH = "./hooks/codex-hooks.json";
const COMMANDS_DIR = "commands";
const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";
const PLUGIN_SKILLS = [
  "eval-skills",
  "interface",
  "new-module",
  "skills",
  "sync-skills",
];
const HOOKS = {
  claude: {
    file: "hooks/hooks.json",
    root: "${CLAUDE_PLUGIN_ROOT}",
    target: "--target claude",
  },
  codex: {
    file: "hooks/codex-hooks.json",
    root: "${PLUGIN_ROOT}",
    target: "--target codex",
  },
};
const TOOL_SPECIFIC_RE = /\$ARGUMENTS|\$\d|\$\{(?:CLAUDE_)?PLUGIN_ROOT\}/;
const USAGE = `Usage: check-plugin [dir]

Checks that the plugin in dir (default: cwd) loads the same way in Claude Code
and Codex. Prints each failure and exits 1 when there is one.
`;

function readJson(root, path, failures) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    failures.push(`${path}: cannot read it as JSON (${error.message})`);
    return null;
  }
}

function checkManifests(root, failures) {
  if (existsSync(join(root, ROOT_MANIFEST))) {
    failures.push(
      `${ROOT_MANIFEST}: Codex reads a root manifest before ${CODEX_MANIFEST}; with the agent-plugins.org $schema it loads no hooks, without it Codex falls back to ${CLAUDE_MANIFEST}. Delete it.`,
    );
  }
  const manifests = [CLAUDE_MANIFEST, CODEX_MANIFEST, PACKAGE_MANIFEST].map(
    (path) => [path, readJson(root, path, failures)],
  );
  const codex = manifests[1][1];
  if (codex && codex.hooks !== CODEX_HOOKS_PATH) {
    failures.push(
      `${CODEX_MANIFEST}: "hooks" must be "${CODEX_HOOKS_PATH}", not ${JSON.stringify(codex.hooks)}.`,
    );
  }
  const versions = new Set(
    manifests.filter(([, data]) => data).map(([, data]) => data.version),
  );
  if (versions.size > 1) {
    const listed = manifests
      .filter(([, data]) => data)
      .map(([path, data]) => `${path} ${data.version}`);
    failures.push(
      `version differs across manifests (${listed.join(", ")}); installed copies update only when it changes.`,
    );
  }
}

function checkSkill(root, name, failures) {
  const path = join(SKILLS_DIR, name, SKILL_FILE);
  if (!existsSync(join(root, path))) {
    failures.push(`${path}: missing.`);
    return;
  }
  const { data, body } = parseFrontmatter(
    readFileSync(join(root, path), "utf8"),
  );
  if (data.name !== name) {
    failures.push(`${path}: "name" must be "${name}", the directory name.`);
  }
  if (!data.description) {
    failures.push(`${path}: "description" is missing.`);
  }
  const placeholder = body.match(TOOL_SPECIFIC_RE);
  if (placeholder) {
    failures.push(
      `${path}: "${placeholder[0]}" is expanded by one tool only; take arguments from the request and reach scripts relative to the skill directory.`,
    );
  }
}

function checkSkills(root, failures) {
  if (existsSync(join(root, COMMANDS_DIR))) {
    failures.push(
      `${COMMANDS_DIR}/: Codex has no plugin commands and turns them into duplicate skills; write ${SKILLS_DIR}/<name>/${SKILL_FILE} instead.`,
    );
  }
  const present = existsSync(join(root, SKILLS_DIR))
    ? readdirSync(join(root, SKILLS_DIR))
    : [];
  for (const name of present.filter(
    (entry) => !PLUGIN_SKILLS.includes(entry),
  )) {
    failures.push(
      `${SKILLS_DIR}/${name}: the plugin ships only ${PLUGIN_SKILLS.join(", ")}; AntelopeJS knowledge ships with the packages and reaches projects through the sync, so a copy here would shadow the version a project installs.`,
    );
  }
  for (const name of PLUGIN_SKILLS) checkSkill(root, name, failures);
}

function comparableHooks(config, tool) {
  const { root, target } = HOOKS[tool];
  return Object.entries(config.hooks ?? {}).map(([event, groups]) => [
    event,
    groups.map((group) => ({
      matcher: group.matcher ?? null,
      hooks: group.hooks.map((hook) => ({
        type: hook.type,
        timeout: hook.timeout ?? null,
        command: hook.command
          ?.replaceAll(root, "<root>")
          .replaceAll(target, "<target>"),
      })),
    })),
  ]);
}

function checkHooks(root, failures) {
  const [claude, codex] = ["claude", "codex"].map((tool) =>
    readJson(root, HOOKS[tool].file, failures),
  );
  if (!claude || !codex) return;
  const [claudeHooks, codexHooks] = [
    comparableHooks(claude, "claude"),
    comparableHooks(codex, "codex"),
  ];
  if (JSON.stringify(claudeHooks) !== JSON.stringify(codexHooks)) {
    failures.push(
      `${HOOKS.claude.file} and ${HOOKS.codex.file} must run the same commands on the same events, apart from ${HOOKS.claude.root} / ${HOOKS.codex.root} and --target.`,
    );
  }
}

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
  const failures = [];
  checkManifests(root, failures);
  checkSkills(root, failures);
  checkHooks(root, failures);
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  return failures.length ? EXIT.failed : EXIT.ok;
}

process.exit(main());
