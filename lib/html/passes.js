import slugify from "slugify";
import { mapText } from "./walk.js";

// Pure HTML → HTML post-passes. Each takes a whole page's HTML and returns it
// rewritten. Passes that touch text use mapText and leave tags alone.

// Text inside these tags is left alone by the abbreviation, initials, Roman
// numeral and divine-name passes.
const WRAP_SKIP_TAGS = new Set(["abbr", "code", "pre", "script", "style"]);

// Returns a function that wraps abbreviations in a page's HTML. The regex is
// built once, not once per page.
export function makeAbbreviationWrapper(abbrMap) {
  // Sort abbreviations longest-first to prevent prefix collisions
  const sorted = Object.keys(abbrMap).sort((a, b) => b.length - a.length);

  // Build a single regex that matches any abbreviation (case-sensitive)
  // For each abbreviation:
  //   - If it ends with a word character, use \b on both sides
  //   - If it ends with punctuation (e.g. "e.g."), use \b on the left only
  const parts = sorted.map((abbr) => {
    const escaped = abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lastChar = abbr[abbr.length - 1];
    const rightBoundary = /\w/.test(lastChar) ? "\\b" : "";
    return `\\b${escaped}${rightBoundary}`;
  });
  const combinedRe = new RegExp(`(${parts.join("|")})`, "g");

  return (html) =>
    mapText(html, WRAP_SKIP_TAGS, (text) =>
      text.replace(combinedRe, (match) => {
        const expansion = abbrMap[match];
        return expansion != null
          ? `<abbr title="${expansion}">${match}</abbr>`
          : `<abbr>${match}</abbr>`;
      }),
    );
}

// Adds or replaces the alt attribute on any <img> whose src basename matches
// a key in altMap.  Matching is case-sensitive and against the filename only
// (no directory path, no query string).  Values containing double-quotes are
// automatically escaped as &quot;.
export function applyAltText(html, altMap) {
  return html.replace(/<img\s[^>]*>/g, (tag) => {
    const srcMatch = tag.match(/\bsrc=(["'])([^"']+)\1/);
    if (!srcMatch) return tag;

    const src = srcMatch[2];
    // Strip any query/hash, then take the last path segment
    const basename = src.split("/").pop().split(/[?#]/)[0];
    if (!Object.prototype.hasOwnProperty.call(altMap, basename)) return tag;

    const altText = String(altMap[basename]).replace(/"/g, "&quot;");

    if (/\balt=/.test(tag)) {
      // Replace existing alt value (handles both quote styles)
      return tag.replace(/\balt=(["'])[^"']*\1/, `alt="${altText}"`);
    }
    // Insert alt before the closing > or />
    return tag.replace(/(\s?\/?>)$/, ` alt="${altText}"$1`);
  });
}


// ─── Initials Wrapping ────────────────────────────────────────────────────────

// Matches two or more consecutive "UppercaseLetter + period" groups, e.g.
// "D.A.", "R.C.", "J.R.R.", "U.S.A."  Single-letter abbreviations like "Dr."
// are intentionally excluded (they require two or more such groups).
const INITIALS_RE = /\b([A-Z]\.){2,}/g;

export function wrapInitials(html) {
  return mapText(html, WRAP_SKIP_TAGS, (text) =>
    text.replace(INITIALS_RE, "<abbr>$&</abbr>"),
  );
}

// ─── End Initials Wrapping ────────────────────────────────────────────────────

// ─── Spaced Ellipsis Normalisation ───────────────────────────────────────────

// Converts spaced ellipses (". . ." with any whitespace, including U+00A0) to
// the typographically correct form with non-breaking spaces as HTML entities.
// The longer pattern (leading space) is applied first so it is not partially
// consumed by the shorter one.
export function fixSpacedEllipses(html) {
  return html
    .replace(/\s\.\s\.\s\./g, "&nbsp;.&nbsp;.&nbsp;.")
    .replace(/\.\s\.\s\./g, ".&nbsp;.&nbsp;.");
}

// ─── End Spaced Ellipsis Normalisation ───────────────────────────────────────

// ─── Roman Numeral Wrapping ───────────────────────────────────────────────────

// Matches strictly valid Roman numerals (1–3999), uppercase only.
// Two branches:
//   1. Dotted pair ROMAN.ROMAN — each half ≥ 1 char (e.g. X.III, I.I, XIV.II)
//   2. Standalone — ≥ 2 chars (lookahead (?=[MDCLXVI]{2}) excludes bare I, V, X, etc.)
// Dotted branch is listed first so it wins the longer match.
// The match.length >= 2 guard in the replacement callback is a safety net against
// empty matches that the all-optional structural pattern can produce at word boundaries.
const ROMAN_RE_SRC =
  "M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})";
const ROMAN_NUM_RE = new RegExp(
  `\\b(?=[MDCLXVI])${ROMAN_RE_SRC}\\.(?=[MDCLXVI])${ROMAN_RE_SRC}\\b` +
    `|\\b(?=[MDCLXVI]{2})${ROMAN_RE_SRC}\\b`,
  "g",
);

export function wrapRomanNumerals(html) {
  return mapText(html, WRAP_SKIP_TAGS, (text) =>
    text.replace(ROMAN_NUM_RE, (match) =>
      match.length >= 2 ? `<span class="roman-num">${match}</span>` : match,
    ),
  );
}

// ─── End Roman Numeral Wrapping ───────────────────────────────────────────────

// ─── Divine Name Wrapping ─────────────────────────────────────────────────────
// LORD, GOD, YHWH, I AM, etc. (all-caps) →
//   <span class="divine-name" data-name="…">
//     <span class="divine-name-initial">L</span>ORD
//   </span>
// First letter wrapped in .divine-name-initial so it can be styled independently
// of the remaining small-capped letters (::first-letter only works on block elements).

const DIVINE_NAME_RE =
  /\b(LORD|GOD|YHWH|I AM( THAT I AM| WHAT I AM| WHO I AM)?|I WILL BE( THAT I WILL BE| WHAT I WILL BE| WHO I WILL BE)?)\b/g;

export function wrapDivineNames(html) {
  return mapText(html, WRAP_SKIP_TAGS, (text) =>
    text.replace(DIVINE_NAME_RE, (match) => {
      const newMatch = match.replace(
        /\b(G|L|I\b)/g,
        `<span class="divine-name-initial">$1</span>`,
      );
      return `<span class="divine-name" data-name="${match}">${newMatch}</span>`;
    }),
  );
}

// ─── End Divine Name Wrapping ─────────────────────────────────────────────────

// ─── Heading ID Injection ─────────────────────────────────────────────────────
// Adds id attributes to <h2> and <h3> elements that don't already have one.
// IDs are generated by slugifying the element's plain-text content.
// Duplicate IDs within the same page are disambiguated with -2, -3, etc.
// Runs as the first post-processing step so all downstream passes and the
// future Scripture index can rely on the IDs being present.

export function addHeadingIds(html) {
  const usedIds = new Set();

  // Alternation order matters: comments, CDATA, script blocks, and style
  // blocks are matched and consumed first so we never accidentally process
  // heading-like text that appears inside those contexts.
  // Group 1 = full heading element, group 2 = tag name (h2|h3),
  // group 3 = attribute string (may be empty).
  // Backreference \2 ties the closing tag to the opening tag (h2↔h2, h3↔h3).
  const H_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|(<(h[23])(\s[^>]*)?>[\s\S]*?<\/\2>)/gi;

  // First pass: pre-reserve all IDs that already exist on h2/h3 elements.
  // This prevents generated IDs from colliding with explicit IDs that appear
  // later in the document, regardless of source order.
  let m;
  H_RE.lastIndex = 0;
  while ((m = H_RE.exec(html)) !== null) {
    if (!m[2]) continue; // comment / CDATA / script / style — skip
    const attrs = m[3] || "";
    if (/\bid\s*=/.test(attrs)) {
      const existing = attrs.match(/\bid\s*=\s*["']?([^"'\s>]+)["']?/);
      if (existing) usedIds.add(existing[1]);
    }
  }

  // Second pass: generate and inject IDs for headings that lack one.
  H_RE.lastIndex = 0;
  return html.replace(H_RE, (match, fullHeading, tag, attrs) => {
    if (!tag) return match; // comment / CDATA / script / style — preserve

    attrs = attrs || "";
    // Already has an id — preserve it exactly as written
    if (/\bid\s*=/.test(attrs)) return match;

    // Extract plain text by stripping inner tags
    const text = fullHeading.replace(/<[^>]*>/g, "").trim();

    // Slugify; fall back to "section" for empty/symbol-only headings
    let base = slugify(text, { lower: true, strict: true }) || "section";

    // Deduplicate within this page
    let slug = base;
    if (usedIds.has(slug)) {
      let n = 2;
      while (usedIds.has(`${base}-${n}`)) n++;
      slug = `${base}-${n}`;
    }
    usedIds.add(slug);

    // Inject id into the opening tag
    return fullHeading.replace(
      new RegExp(`^<${tag}(\\s[^>]*)?>`, "i"),
      (_, a) => `<${tag}${a || ""} id="${slug}">`,
    );
  });
}

// ─── End Heading ID Injection ─────────────────────────────────────────────────
