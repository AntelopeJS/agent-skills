const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const KEY_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const BLOCK_SCALAR_RE = /^[>|][+-]?$/;
const INLINE_LIST_RE = /^\[(.*)\]$/;
const QUOTED_RE = /^(["'])([\s\S]*)\1$/;

function unquote(value) {
  const quoted = value.match(QUOTED_RE);
  return quoted ? quoted[2] : value;
}

function parseScalar(raw) {
  const value = raw.trim();
  const list = value.match(INLINE_LIST_RE);
  if (!list) return unquote(value);
  return list[1]
    .split(",")
    .map((item) => unquote(item.trim()))
    .filter(Boolean);
}

function isIndented(line) {
  return line === "" || /^\s/.test(line);
}

function blockScalar(indicator, lines) {
  const parts = lines.map((line) => line.trim());
  if (indicator.startsWith("|")) return parts.join("\n").trim();
  return parts.filter(Boolean).join(" ");
}

/**
 * Minimal YAML frontmatter reader for SKILL.md files: scalar keys, quoted
 * strings, inline lists and block scalars (`>`, `|`). No dependency.
 */
export function parseFrontmatter(text) {
  const match = text.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: text };
  const lines = match[1].split(/\r?\n/);
  const data = {};
  for (let index = 0; index < lines.length; index += 1) {
    const key = lines[index].match(KEY_RE);
    if (!key) continue;
    const [, name, rest] = key;
    if (!BLOCK_SCALAR_RE.test(rest.trim())) {
      data[name] = parseScalar(rest);
      continue;
    }
    const block = [];
    while (index + 1 < lines.length && isIndented(lines[index + 1]))
      block.push(lines[(index += 1)]);
    data[name] = blockScalar(rest.trim(), block);
  }
  return { data, body: text.slice(match[0].length) };
}
