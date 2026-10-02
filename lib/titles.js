// English articles stripped from the front of a title before alphabetic
// comparison. Matching is case-insensitive; "An" is tested before "A" to avoid
// a prefix match.
const ARTICLE_RE = /^(the|an|a)\s+/i;

// The sort key for a title: "The law of Christ" → "law of Christ".
export function sortableTitle(title) {
  return title.replace(ARTICLE_RE, "").trim();
}

// Comparator for { title } objects: ignores a leading article and case.
export function compareTitles(a, b) {
  return sortableTitle(a.title).localeCompare(sortableTitle(b.title), undefined, {
    sensitivity: "base",
  });
}
