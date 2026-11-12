/** Unicode-aware label matching. Related options are not automatically identical. */
const ALIASES = [
  ["burger", "hamburger"],
  ["cinema", "movie theatre", "movie theater"],
  ["takeaway", "takeout"],
  ["video game", "videogame"],
];
const STOPWORDS = new Set([
  "a", "an", "the", "that", "this", "my", "our", "to", "at", "in", "on", "of",
  "for", "with", "and", "or", "place", "spot", "option",
]);

export function normalize(label: string): string {
  return label.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word)).join(" ").trim();
}

function canonical(text: string): string {
  const group = ALIASES.find((terms) => terms.includes(text));
  return group?.[0] ?? text;
}

const SENSITIVE = new Set([
  "no", "not", "never", "without", "avoid", "skip", "decaf", "caffeinated", "black",
  "vegan", "vegetarian", "gluten", "free", "sugar", "low", "high", "buy", "sell",
]);
function modifiers(text: string): string {
  return text.split(" ").filter((word) => SENSITIVE.has(word)).sort().join(" ");
}
function trigramCosine(a: string, b: string): number {
  const grams = (text: string) => {
    const padded = `  ${text} `;
    return new Set(Array.from({ length: Math.max(0, padded.length - 2) }, (_, i) => padded.slice(i, i + 3)));
  };
  const ga = grams(a); const gb = grams(b);
  let shared = 0;
  for (const gram of ga) if (gb.has(gram)) shared++;
  return ga.size && gb.size ? shared / Math.sqrt(ga.size * gb.size) : 0;
}

export function similarity(a: string, b: string): number {
  const na = canonical(normalize(a)); const nb = canonical(normalize(b));
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (modifiers(na) !== modifiers(nb)) return 0;
  // Token containment is relatedness, not identity; never match substrings.
  const wa = new Set(na.split(" ")); const wb = new Set(nb.split(" "));
  const overlap = [...wa].filter((word) => wb.has(word)).length;
  const wordScore = overlap / Math.max(wa.size, wb.size);
  return Math.max(wordScore * 0.65, trigramCosine(na, nb));
}

export function isSameChoice(a: string, b: string, threshold = 0.9): boolean {
  const na = canonical(normalize(a)); const nb = canonical(normalize(b));
  if (!na || !nb) return false;
  if (na === nb) return true;
  // A fuzzy phrase cannot establish that two different real-world options
  // are the same choice. Permit spelling drift only for single-word labels.
  return !na.includes(" ") && !nb.includes(" ") &&
    Math.min(na.length, nb.length) >= 4 && similarity(a, b) >= Math.max(0.9, threshold);
}

/** Whole phrases only: related spelling must not turn an opposite choice into evidence. */
export function containsPreferenceTerm(label: string, term: string): boolean {
  const option = canonical(normalize(label));
  const preference = canonical(normalize(term));
  if (!option || !preference) return false;
  if (option === preference) return true;
  const words = option.split(" ");
  const phrase = preference.split(" ");
  const negations = new Set(["no", "not", "never", "without", "avoid", "skip"]);
  const variants = new Set(["decaf", "caffeinated", "vegan", "vegetarian", "black", "low", "high", "free"]);
  for (let start = 0; start <= words.length - phrase.length; start++) {
    if (!phrase.every((word, index) => words[start + index] === word)) continue;
    // A nearby preceding negation applies to this occurrence, not to a later
    // constraint: "tea without sugar" may match tea, but must not match sugar.
    if (words.slice(Math.max(0, start - 3), start).some(word => negations.has(word))) continue;
    const before = words[start - 1];
    const after = words[start + phrase.length];
    if (after === "free" || (before && variants.has(before) && !phrase.includes(before))) continue;
    return true;
  }
  // Only single-word spelling drift qualifies here; a fuzzy phrase cannot
  // override negation or dietary/caffeine modifiers.
  return isSameChoice(option, preference);
}
