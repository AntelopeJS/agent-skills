// Deterministic baseline picker: no model, no key. Scores each skill by the
// IDF-weighted overlap between the prompt's terms and the skill's name and
// description, and keeps the skills close to the best score. It cannot read
// intent, but it goes red when a description stops carrying its key terms.

const STOP_WORDS = new Set(
  (
    "a an and any are as at be by can do does for from has have how i if in into is it its me my of on " +
    "or our so that the their them then there this to u up use used uses using via want wanna was we " +
    "what when where which who why will with without you your yours need asap make get"
  ).split(" "),
);
const MIN_TOKEN_LENGTH = 2;
const NAME_WEIGHT = 2;
const MIN_SCORE = 1.5;
const RELATIVE_CUTOFF = 0.6;
const MAX_PICKS = 3;
const STEM_RULES = [
  [/ies$/, "y"],
  [/(?<=[^s])s$/, ""],
  [/(?<=([^aeiou]))\1ing$/, ""],
  [/ing$/, ""],
  [/ed$/, ""],
];
const MIN_STEM_LENGTH = 4;

function stem(word) {
  if (word.length < MIN_STEM_LENGTH) return word;
  const rule = STEM_RULES.find(([pattern]) => pattern.test(word));
  return rule ? word.replace(rule[0], rule[1]) : word;
}

export function tokenize(text) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\be-mail/gi, "email")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(word))
    .map(stem);
}

function weightedTerms(skill) {
  const terms = new Map();
  for (const term of tokenize(skill.description)) terms.set(term, 1);
  for (const term of tokenize(skill.name.replace(/-/g, " ")))
    terms.set(term, NAME_WEIGHT);
  return terms;
}

function inverseDocumentFrequency(documents) {
  const counts = new Map();
  for (const terms of documents)
    for (const term of terms.keys())
      counts.set(term, (counts.get(term) ?? 0) + 1);
  return (term) =>
    Math.log(1 + documents.length / (counts.get(term) ?? documents.length));
}

/** Returns `(prompt) => skillNames`, best match first. */
export function createBaselinePicker(skills) {
  const documents = skills.map(weightedTerms);
  const idf = inverseDocumentFrequency(documents);
  return (prompt) => {
    const terms = [...new Set(tokenize(prompt))];
    const scored = skills
      .map((skill, index) => ({
        name: skill.name,
        score: terms.reduce(
          (sum, term) => sum + (documents[index].get(term) ?? 0) * idf(term),
          0,
        ),
      }))
      .sort(
        (left, right) =>
          right.score - left.score || left.name.localeCompare(right.name),
      );
    const best = scored[0]?.score ?? 0;
    if (best < MIN_SCORE) return [];
    return scored
      .filter((entry) => entry.score >= best * RELATIVE_CUTOFF)
      .slice(0, MAX_PICKS)
      .map((entry) => entry.name);
  };
}
