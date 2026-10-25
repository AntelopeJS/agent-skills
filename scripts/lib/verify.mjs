// Checks the API names an answer or a diff relies on against what the
// installed packages really export, and reports the unknown ones.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { extractApiReferences } from "./identifiers.mjs";
import { ModuleResolver, splitSpecifier, STATUS } from "./exports.mjs";

const FRAMEWORK_SCOPE = "@antelopejs";
const PERCENT = 100;

function ancestors(dir) {
  const parent = dirname(dir);
  return parent === dir ? [dir] : [dir, ...ancestors(parent)];
}

function scopeOf(specifier) {
  return specifier.startsWith("@") ? specifier.split("/")[0] : null;
}

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

function importFindings(entry, resolved, scopes) {
  const base = { specifier: entry.specifier, line: entry.line };
  const verdicts = {
    [STATUS.missingPackage]: () =>
      scopes.has(scopeOf(entry.specifier))
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

async function universeOf(resolver, specifiers) {
  const names = new Set();
  for (const specifier of specifiers) {
    const resolved = await resolver.resolveModule(specifier);
    for (const name of resolved.names?.names ?? []) names.add(name);
  }
  return names;
}

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
 */
export async function verifyText(
  text,
  { project = process.cwd(), offline = false, env = process.env } = {},
) {
  const resolver = new ModuleResolver({ project, offline, env });
  const { mode, imports, references } = extractApiReferences(text);
  const scopes = new Set([
    FRAMEWORK_SCOPE,
    ...imports.map((entry) => scopeOf(entry.specifier)).filter(Boolean),
  ]);
  const report = {
    mode,
    checked: 0,
    findings: [],
    unchecked: [],
    packages: [],
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
