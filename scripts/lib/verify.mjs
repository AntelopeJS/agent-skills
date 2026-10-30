/**
 * Checks the API names an answer or a diff relies on against what the
 * installed packages really export, and reports the unknown ones.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { extractApiReferences } from "./identifiers.mjs";
import { ModuleResolver, splitSpecifier, STATUS } from "./exports.mjs";
import { isText } from "./values.mjs";

/**
 * @typedef {import("./identifiers.mjs").ApiReference} ApiReference
 */

/**
 * @typedef {import("./identifiers.mjs").ImportStatement} ImportStatement
 */

/**
 * @typedef {import("./exports.mjs").ModuleResolution} ModuleResolution
 */

/**
 * @typedef {object} Finding An API name that the installed packages do not export.
 * @property {string} [specifier]
 * @property {number} line
 * @property {string} kind
 * @property {string} name
 * @property {string} reason
 */

/**
 * @typedef {object} Unchecked
 * @property {string} specifier
 * @property {string} reason
 */

/**
 * @typedef {object} Verdict The outcome of checking one import: either what was checked and found, or why it was not checked.
 * @property {number} [checked]
 * @property {Finding[]} [findings]
 * @property {string} [unchecked]
 */

/**
 * @typedef {object} Report
 * @property {string} mode
 * @property {number} checked
 * @property {Finding[]} findings
 * @property {Unchecked[]} unchecked
 * @property {{ specifier: string, status: string, source: string | null }[]} packages
 * @property {number} inventedRate
 */

const FRAMEWORK_SCOPE = "@antelopejs";
const PERCENT = 100;

/**
 * @param {string} dir
 * @returns {string[]}
 */
function ancestors(dir) {
  const parent = dirname(dir);
  return parent === dir ? [dir] : [dir, ...ancestors(parent)];
}

/**
 * @param {string} specifier
 * @returns {string | null}
 */
function scopeOf(specifier) {
  return specifier.startsWith("@") ? specifier.split("/")[0] : null;
}

/**
 * @param {string} project
 * @param {string} scope
 * @returns {string[]}
 */
function installedInScope(project, scope) {
  const roots = ancestors(project).flatMap((dir) => [
    join(dir, "node_modules", scope),
    join(dir, ".antelope", "cache", scope),
  ]);
  const names = roots
    .filter(existsSync)
    .flatMap((root) =>
      readdirSync(root).filter((entry) => !entry.startsWith(".")),
    );
  return [...new Set(names)].map((entry) => `${scope}/${entry}`);
}

/**
 * @param {ImportStatement} entry
 * @param {ModuleResolution} resolved
 * @param {Set<string>} scopes
 * @returns {Verdict}
 */
function importFindings(entry, resolved, scopes) {
  const base = { specifier: entry.specifier, line: entry.line };
  const scope = scopeOf(entry.specifier);
  /** @type {Record<string, () => Verdict>} */
  const verdicts = {
    [STATUS.missingPackage]: () =>
      scope !== null && scopes.has(scope)
        ? {
            checked: 1,
            findings: [
              {
                ...base,
                kind: "package",
                name: splitSpecifier(entry.specifier).name,
                reason: "package not found",
              },
            ],
          }
        : { unchecked: "not installed" },
    [STATUS.missingSubpath]: () => ({
      checked: 1,
      findings: [
        {
          ...base,
          kind: "subpath",
          name: entry.specifier,
          reason: "subpath not exported",
        },
      ],
    }),
    [STATUS.untyped]: () => ({ unchecked: "no type declarations" }),
  };
  const verdict = verdicts[resolved.status];
  if (verdict) return verdict();
  const { names, permissive } = resolved.names;
  const unknown = permissive
    ? []
    : entry.names.filter((name) => !names.has(name.imported));
  return {
    checked: 1 + entry.names.length,
    findings: unknown.map((name) => ({
      ...base,
      kind: "import",
      name: name.imported,
      reason: `not exported by ${entry.specifier}`,
    })),
  };
}

/**
 * @param {ModuleResolver} resolver
 * @param {string[]} specifiers
 * @returns {Promise<Set<string>>}
 */
async function universeOf(resolver, specifiers) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const specifier of specifiers) {
    const resolved = await resolver.resolveModule(specifier);
    for (const name of resolved.names?.names ?? []) names.add(name);
  }
  return names;
}

/**
 * @param {ModuleResolver} resolver
 * @param {ApiReference[]} references
 * @param {Set<string>} scopes
 * @returns {Promise<{ checked: number, findings: Finding[], unchecked: Unchecked[] }>}
 */
async function checkReferences(resolver, references, scopes) {
  if (!references.length) return { checked: 0, findings: [], unchecked: [] };
  const packages = [...scopes].flatMap((scope) =>
    installedInScope(resolver.project, scope),
  );
  const universe = await universeOf(
    resolver,
    packages.flatMap((name) => resolver.packageSpecifiers(name)),
  );
  if (!universe.size) {
    return {
      checked: 0,
      findings: [],
      unchecked: [
        {
          specifier: "(unimported names)",
          reason: `no ${[...scopes].join(", ")} package installed`,
        },
      ],
    };
  }
  const unknown = references.filter(
    (reference) => !universe.has(reference.name),
  );
  return {
    checked: references.length,
    findings: unknown.map((reference) => ({
      ...reference,
      kind: "reference",
      reason: `not exported by any installed ${[...scopes].join(", ")} package`,
    })),
    unchecked: [],
  };
}

/**
 * Verifies `text` (a Markdown answer or a unified diff). `project` is where the
 * packages are installed; `offline` keeps the interface resolver off the network.
 * @param {string} text
 * @param {{ project?: string, offline?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<Report>}
 */
export async function verifyText(
  text,
  { project = process.cwd(), offline = false, env = process.env } = {},
) {
  const resolver = new ModuleResolver({ project, offline, env });
  const { mode, imports, references } = extractApiReferences(text);
  const scopes = new Set([
    FRAMEWORK_SCOPE,
    ...imports.map((entry) => scopeOf(entry.specifier)).filter(isText),
  ]);
  /** @type {Report} */
  const report = {
    mode,
    checked: 0,
    findings: [],
    unchecked: [],
    packages: [],
    inventedRate: 0,
  };
  for (const entry of imports) {
    const resolved = await resolver.resolveModule(entry.specifier);
    report.packages.push({
      specifier: entry.specifier,
      status: resolved.status,
      source: resolved.source ?? null,
    });
    const verdict = importFindings(entry, resolved, scopes);
    if (verdict.unchecked)
      report.unchecked.push({
        specifier: entry.specifier,
        reason: verdict.unchecked,
      });
    report.checked += verdict.checked ?? 0;
    report.findings.push(...(verdict.findings ?? []));
  }
  const referenced = await checkReferences(resolver, references, scopes);
  report.checked += referenced.checked;
  report.findings.push(...referenced.findings);
  report.unchecked.push(...referenced.unchecked);
  report.inventedRate = report.checked
    ? report.findings.length / report.checked
    : 0;
  return report;
}

/**
 * @param {Report} report
 * @returns {string}
 */
export function formatReport(report) {
  const rate = Math.round(report.inventedRate * PERCENT);
  const lines = [
    `verify (${report.mode}): ${report.checked} API names checked, ${report.findings.length} unknown (${rate}%)`,
  ];
  for (const finding of report.findings) {
    lines.push(
      `  line ${String(finding.line).padEnd(4)} ${finding.kind.padEnd(9)} ${finding.name}  — ${finding.reason}`,
    );
  }
  for (const entry of report.unchecked)
    lines.push(`  unchecked ${entry.specifier}  — ${entry.reason}`);
  return lines.join("\n");
}
