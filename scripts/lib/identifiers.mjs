/**
 * Extracts the API surface an answer or a diff relies on: the names it imports
 * from each module specifier, and (for answers) the API-shaped names it uses
 * without importing them. Names declared in the text itself, JavaScript
 * globals and TypeScript utility types are left out.
 */

const FENCE_RE = /^\s*(```|~~~)/;
const DIFF_RE = /^(diff --git |@@ -\d|\+\+\+ |--- a\/)/m;
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const INLINE_IDENTIFIER_RE = /^@?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const API_NAME_RE = /^[A-Z](?=[\w$]*[a-z])[\w$]{2,}$/;
const MIN_NAME_LENGTH = 3;

const IMPORT_PATTERNS = [
  {
    kind: "import",
    re: /\bimport\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s*["']([^"']+)["']/g,
  },
  {
    kind: "export",
    re: /\bexport\s+(?:type\s+)?(\{[\w$\s,]*\})\s*from\s*["']([^"']+)["']/g,
  },
  {
    kind: "require",
    re: /\b(?:const|let|var)\s+([\w$]+|\{[\w$\s,:]*\})\s*=\s*(?:await\s+)?require\(\s*["']([^"']+)["']\s*\)/g,
  },
  {
    kind: "side-effect",
    re: /\bimport\s*\(?\s*["']([^"']+)["']\s*\)?/g,
    clauseless: true,
  },
  {
    kind: "side-effect",
    re: /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    clauseless: true,
  },
];
const REFERENCE_PATTERNS = [
  /@([A-Za-z_$][\w$]*)/g,
  /\bnew\s+([A-Za-z_$][\w$]*)/g,
  /\b([A-Za-z_$][\w$]*)\s*\(/g,
  /\b([A-Za-z_$][\w$]*)\.[A-Za-z_$]/g,
  /\b(?:extends|implements)\s+([A-Za-z_$][\w$]*)/g,
];
const DECLARATION_RE =
  /\b(?:class|interface|type|enum|function|const|let|var|namespace)\s+([A-Za-z_$][\w$]*)/g;
const DESTRUCTURING_RE = /\b(?:const|let|var)\s+\{([^}]*)\}\s*=/g;
const TYPE_UTILITIES = [
  "Partial",
  "Required",
  "Readonly",
  "Record",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "Parameters",
  "ReturnType",
  "InstanceType",
  "Awaited",
  "ConstructorParameters",
  "ThisType",
  "Uppercase",
  "Lowercase",
  "Capitalize",
  "Uncapitalize",
  "PromiseLike",
  "ArrayLike",
  "Iterable",
  "AsyncIterable",
  "IterableIterator",
  "Generator",
  "AsyncGenerator",
  "PropertyKey",
  "NodeJS",
  "Buffer",
];
const GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  ...TYPE_UTILITIES,
]);

function blank(text) {
  return text.replace(/[^\n]/g, " ");
}

function lineAt(source, index) {
  return source.lines[source.text.slice(0, index).split("\n").length - 1];
}

function collectLines(lines, keep) {
  const kept = lines
    .map((text, index) => ({ text, line: index + 1 }))
    .filter(keep);
  return {
    text: kept.map((entry) => entry.text).join("\n"),
    lines: kept.map((entry) => entry.line),
  };
}

function splitMarkdown(text) {
  let inFence = false;
  const tagged = text.split("\n").map((line) => {
    const fence = FENCE_RE.test(line);
    if (fence) inFence = !inFence;
    return { line, code: inFence && !fence };
  });
  const lines = tagged.map((entry) => entry.line);
  return {
    code: collectLines(lines, (_, index) => tagged[index].code),
    prose: collectLines(lines, (_, index) => !tagged[index].code),
  };
}

function splitDiff(text) {
  const lines = text
    .split("\n")
    .map((line) => (/^\+(?!\+\+)/.test(line) ? line.slice(1) : null));
  const added = collectLines(lines, (line) => line !== null);
  return { code: added, prose: { text: "", lines: [] } };
}

function parseNamed(list, separator) {
  return list
    .split(",")
    .map((token) => token.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((token) => {
      const [imported, local] = token
        .split(separator)
        .map((part) => part.trim());
      return { imported, local: local || imported };
    });
}

function parseClause(clause, kind) {
  const separator = kind === "require" ? ":" : /\s+as\s+/;
  const braces = clause.match(/\{([^}]*)\}/);
  const named = braces ? parseNamed(braces[1], separator) : [];
  const rest = clause.replace(/\{[^}]*\}/, "");
  const namespace = rest.match(/\*\s*as\s+([\w$]+)/)?.[1];
  const plain = rest.replace(/\*\s*as\s+[\w$]+/, "").match(/[\w$]+/)?.[0];
  const unchecked = [plain, namespace].filter(Boolean);
  return {
    names: named,
    bound: [...named.map((name) => name.local), ...unchecked],
  };
}

function extractImports(source) {
  let text = source.text;
  const found = [];
  for (const { kind, re, clauseless } of IMPORT_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const [statement, first, second] = match;
      const specifier = clauseless ? first : second;
      const parsed = clauseless
        ? { names: [], bound: [] }
        : parseClause(first, kind);
      found.push({
        index: match.index,
        specifier,
        kind,
        line: lineAt(source, match.index),
        ...parsed,
      });
      text =
        text.slice(0, match.index) +
        blank(statement) +
        text.slice(match.index + statement.length);
    }
  }
  const imports = found
    .sort((left, right) => left.index - right.index)
    .map(({ index, ...rest }) => rest);
  return { imports, remaining: text };
}

function declaredNames(code) {
  const names = [...code.matchAll(DECLARATION_RE)].map((match) => match[1]);
  const destructured = [...code.matchAll(DESTRUCTURING_RE)].flatMap((match) =>
    parseNamed(match[1], ":").map((name) => name.local),
  );
  return new Set([...names, ...destructured]);
}

function inlineReferences(prose) {
  const source = prose;
  return [...source.text.matchAll(INLINE_CODE_RE)]
    .map((match) => ({
      term: match[1].trim().replace(/\(.*\)$/, ""),
      index: match.index,
    }))
    .filter(({ term }) => INLINE_IDENTIFIER_RE.test(term))
    .map(({ term, index }) => ({
      name: term.replace(/^@/, "").split(".")[0],
      line: lineAt(source, index),
    }));
}

function codeReferences(code, remaining) {
  return REFERENCE_PATTERNS.flatMap((re) =>
    [...remaining.matchAll(re)].map((match) => ({
      name: match[1],
      line: lineAt(code, match.index),
    })),
  );
}

function uniqueReferences(candidates, excluded) {
  const seen = new Map();
  for (const candidate of candidates) {
    const keep =
      API_NAME_RE.test(candidate.name) &&
      candidate.name.length >= MIN_NAME_LENGTH;
    if (keep && !excluded.has(candidate.name) && !seen.has(candidate.name))
      seen.set(candidate.name, candidate);
  }
  return [...seen.values()].sort(
    (left, right) =>
      left.line - right.line || left.name.localeCompare(right.name),
  );
}

/**
 * `mode` is `diff` when the text is a unified diff (added lines only, imports
 * only) and `markdown` otherwise (code fences, inline code and imports).
 */
export function extractApiReferences(text) {
  const mode = DIFF_RE.test(text) ? "diff" : "markdown";
  const { code, prose } =
    mode === "diff" ? splitDiff(text) : splitMarkdown(text);
  const { imports, remaining } = extractImports(code);
  if (mode === "diff") return { mode, imports, references: [] };
  const excluded = new Set([
    ...GLOBALS,
    ...declaredNames(code.text),
    ...imports.flatMap((entry) => entry.bound),
  ]);
  const candidates = [
    ...inlineReferences(prose),
    ...codeReferences(code, remaining),
  ];
  return { mode, imports, references: uniqueReferences(candidates, excluded) };
}
