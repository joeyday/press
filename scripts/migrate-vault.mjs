// One-off migration for the namespace release. Three steps:
//
// 1. Global notes/ → per-namespace notes folders:
//      notes/X.md  (aside of: [[topic/Y]])  →  topic/notes/Y.md
//    The `aside of` value says which page a note belongs to. The note moves to
//    <that page's folder>/notes/<that page's name>.md, the `aside of` line is
//    dropped, and every wikilink to the old note is rewritten to the new path.
//    Notes it cannot place are left alone and reported.
// 2. reading/ → summary/ (pages and their notes), with [[reading/…]] links
//    rewritten.
// 3. Frontmatter: drop `unlisted: true` from the pages that now get their own
//    alphabetical lists, and rename the Book notes / Article notes categories
//    to Book summaries / Article summaries.
//
// Run from the vault root. Dry run by default; pass --apply to change files.
//
// Never run this on the live iCloud vault while Obsidian is open; do it on a
// copy first, then build and check the result.
import fs from "fs";
import path from "path";

const apply = process.argv.includes("--apply");
const SKIP = new Set([".git", ".obsidian", ".trash", ".github", "node_modules", "dist"]);

const files = []; // vault-relative paths, "/"-separated
(function walk(dir) {
  for (const e of fs.readdirSync(dir || ".", { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel);
    else if (e.name.endsWith(".md")) files.push(rel);
  }
})("");

const dirOf = (f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "");
const baseOf = (f) => path.basename(f, ".md");
const isRootNote = (f) => f.startsWith("notes/") && dirOf(f) === "notes";

// Ordinary pages (not partials, not notes) by lowercase path and basename.
const pages = files.filter((f) => !isRootNote(f) && !f.startsWith("partial/"));
const pageByPath = new Map(pages.map((f) => [f.slice(0, -3).toLowerCase(), f]));
const pagesByBase = new Map();
for (const f of pages) {
  const k = baseOf(f).toLowerCase();
  pagesByBase.set(k, [...(pagesByBase.get(k) || []), f]);
}

function findPage(target) {
  if (target.includes("/")) return pageByPath.get(target.toLowerCase()) || null;
  const hits = pagesByBase.get(target.toLowerCase()) || [];
  const root = hits.filter((f) => dirOf(f) === "");
  if (hits.length === 1) return hits[0];
  if (root.length === 1) return root[0];
  return null;
}

// reading/ became summary/.
const renamed = (p) => p.replace(/^reading\//, "summary/");

const noteMoves = []; // { from, to, text }: step 1
const problems = [];

for (const from of files.filter(isRootNote)) {
  const text = fs.readFileSync(from, "utf8");
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const line = fm && fm[1].match(/^aside of:[ \t]*(.*)$/m);
  const link = line && line[1].match(/\[\[([^\]|#]+?)(?:\.md)?(?:[|#][^\]]*)?\]\]/);
  if (!link) {
    problems.push(`${from}: no usable "aside of" — left alone`);
    continue;
  }
  const target = link[1].trim();
  const page = findPage(target);
  // A note may be written before its page exists; a qualified target still
  // says where the page will go.
  if (!page && !target.includes("/")) {
    problems.push(`${from}: target "${target}" not found — left alone`);
    continue;
  }
  const dir = dirOf(page ?? target);
  const to = renamed(`${dir ? dir + "/" : ""}notes/${baseOf(page ?? target)}.md`);
  if (!page) console.log(`note: ${from} has no page yet; placing it for ${target}`);

  // Drop the `aside of` line; drop the frontmatter block if nothing is left.
  const kept = fm[1].split(/\r?\n/).filter((l) => !/^aside of:/.test(l));
  const body = text.slice(fm[0].length);
  const newText = kept.some((l) => l.trim())
    ? `---\n${kept.join("\n")}\n---\n${body}`
    : body;
  noteMoves.push({ from, to, text: newText });
}

// Step 2: everything in reading/ moves to summary/.
const renames = files
  .filter((f) => f.startsWith("reading/"))
  .map((from) => ({ from, to: renamed(from), text: fs.readFileSync(from, "utf8") }));
const moves = [...noteMoves, ...renames];

// Destination collisions.
const seen = new Map();
for (const m of moves) {
  const k = m.to.toLowerCase();
  if (seen.has(k)) problems.push(`${m.from} and ${seen.get(k)} both want ${m.to}`);
  seen.set(k, m.from);
  if (m.to !== m.from && fs.existsSync(m.to)) problems.push(`${m.to} already exists (from ${m.from})`);
}

// Old link target → new path. Qualified ("notes/Old") always; bare ("Old") only
// when no ordinary page has that name, so it can't have meant a page.
const qualified = new Map();
const bare = new Map();
for (const m of noteMoves) {
  if (m.to === m.from) continue; // already where it belongs (root pages' notes)
  const old = baseOf(m.from).toLowerCase();
  qualified.set(`notes/${old}`, m.to.slice(0, -3));
  if (!pagesByBase.has(old)) bare.set(old, m.to.slice(0, -3));
}

let rewritten = 0;
function rewriteLinks(text) {
  return text.replace(
    /(\[\[)([^\]|#]+?)(\.md)?([|#][^\]]*)?(\]\])/g,
    (match, open, target, _ext, rest = "", close) => {
      const key = target.trim().toLowerCase();
      if (key.startsWith("reading/")) {
        rewritten++;
        return `${open}${target.trim().replace(/^reading\//i, "summary/")}${rest}${close}`;
      }
      const next = key.includes("/") ? qualified.get(key) : bare.get(key);
      if (!next) return match;
      rewritten++;
      // Keep the visible text: [[notes/Old]] → [[topic/notes/Y|Old]]
      return `${open}${next}${rest || `|${target.trim()}`}${close}`;
    },
  );
}

// Step 3: frontmatter edits. `from` is the file's path before any move.
const NOW_LISTED = new Set([
  "About.md",
  "Colophon.md",
  "Home page.md",
  "NTOT.md",
  "OTNT.md",
  "commentary/Acts.md",
  "commentary/Galatians.md",
  "commentary/Romans.md",
  "commentary/Titus.md",
]);
const CATEGORY_RENAMES = [
  ["[[Book notes]]", "[[Book summaries]]"],
  ["[[Article notes]]", "[[Article summaries]]"],
];
let edited = 0;
function editFrontmatter(from, text) {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fm) return text;
  const eol = fm[0].includes("\r\n") ? "\r\n" : "\n";
  let lines = fm[1];
  if (NOW_LISTED.has(from)) {
    lines = lines
      .split(/\r?\n/)
      .filter((l) => !/^unlisted:\s*true\s*$/i.test(l))
      .join(eol);
  }
  for (const [a, b] of CATEGORY_RENAMES) lines = lines.replaceAll(a, b);
  if (lines === fm[1]) return text;
  edited++;
  const body = text.slice(fm[0].length);
  return lines.trim() ? `---${eol}${lines}${eol}---${eol}${body}` : body;
}

const movedFrom = new Set(moves.map((m) => m.from));
const outputs = []; // { path, text }
for (const f of files) {
  if (f.startsWith("partial/") || movedFrom.has(f)) continue;
  const text = fs.readFileSync(f, "utf8");
  const next = rewriteLinks(editFrontmatter(f, text));
  if (next !== text) outputs.push({ path: f, text: next });
}
for (const m of moves) m.text = rewriteLinks(editFrontmatter(m.from, m.text));

for (const m of moves) console.log(`${m.to === m.from ? "stay" : apply ? "move" : "would move"}: ${m.from} → ${m.to}`);
console.log(
  `\n${noteMoves.length} note(s) to move, ${renames.length} file(s) renamed reading/ → summary/, ` +
    `${edited} frontmatter edit(s), ${rewritten} link(s) rewritten in ${outputs.length} other file(s).`,
);
for (const p of problems) console.log(`PROBLEM: ${p}`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to make these changes.");
  process.exit(problems.length ? 1 : 0);
}
if (problems.some((p) => !p.includes("left alone"))) {
  console.log("\nRefusing to apply with collisions; fix them first.");
  process.exit(1);
}
for (const { path: p, text } of outputs) fs.writeFileSync(p, text);
for (const m of moves) {
  fs.mkdirSync(dirOf(m.to), { recursive: true });
  fs.writeFileSync(m.to, m.text);
  if (m.to !== m.from) fs.unlinkSync(m.from);
}
// Remove folders that the moves emptied (children first).
for (const d of new Set(renames.map((m) => dirOf(m.from)))) {
  for (let dir = d; dir; dir = dirOf(dir)) {
    if (fs.readdirSync(dir).length) break;
    fs.rmdirSync(dir);
  }
}
