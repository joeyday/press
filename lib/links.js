export function stripBrackets(value) {
  if (typeof value !== "string") return value;
  let v = value.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
  // Strip Obsidian display-text suffix: [[Page|Display Text]] → Page
  const pipeIdx = v.indexOf("|");
  if (pipeIdx !== -1) v = v.slice(0, pipeIdx).trim();
  return v;
}

function resolveFileMapKey(target, fileMap) {
  const raw = target.toLowerCase().trim();
  if (fileMap[raw] && fileMap[raw].length > 0) return raw;
  for (const key of Object.keys(fileMap)) {
    if (key.replace(/-/g, " ") === raw) return key;
  }
  return raw;
}

// "topic/Foo" → "topic/foo": the key for exact (path-qualified) link lookups.
export function pathKey(relDir, baseName) {
  return (relDir ? `${relDir}/${baseName}` : baseName).toLowerCase().trim();
}

// The category page a `categories` value names. Obsidian writes the folder
// into a link when the bare name is ambiguous, so `category/Foo` works too.
export function findCategory(index, name) {
  return index.byPath[pathKey("category", name.replace(/^\/?category\//i, ""))];
}

// notes/ at the root, or <dir>/notes/, holds the notes pages for the pages in
// the parent directory. Returns that parent directory ("" for the root), or
// null when relDir is not a notes directory.
export function notesParentDir(relDir) {
  if (relDir === "notes") return "";
  if (relDir.endsWith("/notes")) return relDir.slice(0, -"/notes".length);
  return null;
}

/**
 * Resolve a wikilink target to a single URL.
 * Returns:
 *   { url: string }                  — one match
 *   { url: string, shadowed: true }  — a bare name matched several pages and
 *                                      a tiebreak picked one (callers warn)
 *   { ambiguous: true }              — a bare name matched several pages and no
 *                                      tiebreak applies
 *   { notFound: true }               — no match at all
 *
 * A target containing "/" is path-qualified from the vault root
 * ("topic/Trinity", "topic/notes/Trinity") and matches exactly.
 *
 * A bare name is looked up in fileMap (basenames, aliases, permalinks). Notes
 * pages only count when no ordinary page has the name. Remaining candidates
 * are narrowed to the one in the source's own folder (fromDir), then in
 * topic/, then at the root.
 */
export function resolveLink(target, fileMap, index, fromDir = "") {
  const trimmed = target.trim();

  if (trimmed.includes("/")) {
    const fi = index.byPath[trimmed.toLowerCase().replace(/^\/+/, "")];
    return fi ? { url: fi.finalUrlPath } : { notFound: true };
  }

  const key = resolveFileMapKey(trimmed, fileMap);
  const urls = fileMap[key];
  if (!urls || urls.length === 0) return { notFound: true };
  if (urls.length === 1) return { url: urls[0] };

  const found = urls.map((url) => index.byUrl[url]);
  const pages = found.filter((fi) => !fi.isNote);
  const pool = pages.length > 0 ? pages : found;
  if (pool.length === 1) return { url: pool[0].finalUrlPath };

  for (const dir of [fromDir, "topic", ""]) {
    const matches = pool.filter((fi) => fi.nsDir === dir);
    if (matches.length === 1) {
      return { url: matches[0].finalUrlPath, shadowed: true };
    }
  }
  return { ambiguous: true };
}

export function parseNameList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => stripBrackets(String(v)));
  }
  return [stripBrackets(String(raw))];
}
