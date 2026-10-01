import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

// ─── Bible Reference Auto-Linker ──────────────────────────────────────────────

const BIBLE_BOOKS = [
  { names: ["Genesis", "Ge"], osis: "Gen" },
  { names: ["Exodus", "Ex"], osis: "Exod" },
  { names: ["Leviticus", "Lev"], osis: "Lev" },
  { names: ["Numbers", "Nu"], osis: "Num" },
  { names: ["Deuteronomy", "Dt"], osis: "Deut" },
  { names: ["Joshua", "Jos"], osis: "Josh" },
  { names: ["Judges", "Jdg"], osis: "Judg" },
  { names: ["Ruth", "Ru"], osis: "Ruth" },
  { names: ["1 Samuel", "1Samuel", "1Sa"], osis: "1Sam" },
  { names: ["2 Samuel", "2Samuel", "2Sa"], osis: "2Sam" },
  { names: ["1 Kings", "1Kings", "1Ki"], osis: "1Kgs" },
  { names: ["2 Kings", "2Kings", "2Ki"], osis: "2Kgs" },
  { names: ["1 Chronicles", "1Chronicles", "1Ch"], osis: "1Chr" },
  { names: ["2 Chronicles", "2Chronicles", "2Ch"], osis: "2Chr" },
  { names: ["Ezra", "Ezr"], osis: "Ezra" },
  { names: ["Nehemiah", "Ne"], osis: "Neh" },
  { names: ["Esther", "Est"], osis: "Esth" },
  { names: ["Job"], osis: "Job" },
  { names: ["Psalms", "Psalm", "Ps"], osis: "Ps" },
  { names: ["Proverbs", "Pr"], osis: "Prov" },
  { names: ["Ecclesiastes", "Ecc"], osis: "Eccl" },
  { names: ["Song of Solomon", "Song of Songs", "SS"], osis: "Song" },
  { names: ["Isaiah", "Isa"], osis: "Isa" },
  { names: ["Jeremiah", "Jer"], osis: "Jer" },
  { names: ["Lamentations", "La"], osis: "Lam" },
  { names: ["Ezekiel", "Eze"], osis: "Ezek" },
  { names: ["Daniel", "Da"], osis: "Dan" },
  { names: ["Hosea", "Hos"], osis: "Hos" },
  { names: ["Joel"], osis: "Joel" },
  { names: ["Amos", "Am"], osis: "Amos" },
  { names: ["Obadiah", "Ob"], osis: "Obad" },
  { names: ["Jonah", "Jnh"], osis: "Jonah" },
  { names: ["Micah", "Mic"], osis: "Mic" },
  { names: ["Nahum", "Na"], osis: "Nah" },
  { names: ["Habakkuk", "Hab"], osis: "Hab" },
  { names: ["Zephaniah", "Zep"], osis: "Zeph" },
  { names: ["Haggai", "Hag"], osis: "Hag" },
  { names: ["Zechariah", "Zec"], osis: "Zech" },
  { names: ["Malachi", "Mal"], osis: "Mal" },
  { names: ["Matthew", "Mt"], osis: "Matt" },
  { names: ["Mark", "Mk"], osis: "Mark" },
  { names: ["Luke", "Lk"], osis: "Luke" },
  { names: ["John", "Jn"], osis: "John" },
  { names: ["Acts", "Ac"], osis: "Acts" },
  { names: ["Romans", "Ro"], osis: "Rom" },
  { names: ["1 Corinthians", "1Corinthians", "1Co"], osis: "1Cor" },
  { names: ["2 Corinthians", "2Corinthians", "2Co"], osis: "2Cor" },
  { names: ["Galatians", "Gal"], osis: "Gal" },
  { names: ["Ephesians", "Eph"], osis: "Eph" },
  { names: ["Philippians", "Php"], osis: "Phil" },
  { names: ["Colossians", "Col"], osis: "Col" },
  { names: ["1 Thessalonians", "1Thessalonians", "1Th"], osis: "1Thess" },
  { names: ["2 Thessalonians", "2Thessalonians", "2Th"], osis: "2Thess" },
  { names: ["1 Timothy", "1Timothy", "1Ti"], osis: "1Tim" },
  { names: ["2 Timothy", "2Timothy", "2Ti"], osis: "2Tim" },
  { names: ["Titus", "Tit"], osis: "Titus" },
  { names: ["Philemon", "Phm"], osis: "Phlm" },
  { names: ["Hebrews", "Heb"], osis: "Heb" },
  { names: ["James", "Jas"], osis: "Jas" },
  { names: ["1 Peter", "1Peter", "1Pe"], osis: "1Pet" },
  { names: ["2 Peter", "2Peter", "2Pe"], osis: "2Pet" },
  { names: ["1 John", "1John", "1Jn"], osis: "1John" },
  { names: ["2 John", "2John", "2Jn"], osis: "2John" },
  { names: ["3 John", "3John", "3Jn"], osis: "3John" },
  { names: ["Jude"], osis: "Jude" },
  { names: ["Revelation", "Rev"], osis: "Rev" },
];

// Build a map from lowercased name/abbreviation to CWMS abbreviation
// The CWMS abbreviation is always the last element of each book's names array
const _bookCwmsMap = new Map();
for (const book of BIBLE_BOOKS) {
  const cwms = book.names[book.names.length - 1];
  for (const name of book.names) {
    _bookCwmsMap.set(name.toLowerCase(), cwms);
  }
}

// Map: CWMS abbreviation → { bookIndex, bookName, bookSlug }
// Used by the Scripture index collector.
// Populated lazily (after build() starts) to avoid calling slugify before
// its module initializes. See _initBookCwmsToInfo() below.
const _bookCwmsToInfo = new Map();
function _initBookCwmsToInfo() {
  if (_bookCwmsToInfo.size > 0) return;
  for (let _i = 0; _i < BIBLE_BOOKS.length; _i++) {
    const _book = BIBLE_BOOKS[_i];
    const _cwms = _book.names[_book.names.length - 1];
    _bookCwmsToInfo.set(_cwms, {
      bookIndex: _i,
      bookName: _book.names[0],
      bookCwms: _cwms,
      bookSlug: slugify(_book.names[0], { lower: true, strict: true }),
    });
  }
}

// Build the reference regex
// Sorted by length desc so longer matches win (e.g. "Song of Solomon" before "Song")
const _allBookNames = BIBLE_BOOKS.flatMap((b) => b.names).sort(
  (a, b) => b.length - a.length,
);
// Each book name pattern: allow optional \s* between words and between a leading
// digit and the rest (so "1 Co" matches the abbreviation "1Co", etc.)
const _bookPattern = _allBookNames
  .map((n) => {
    const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Allow flexible whitespace between words (including "Song of Solomon")
    let pat = escaped.replace(/\\ /g, "\\s*").replace(/\s+/g, "\\s*");
    // Also allow optional space between a leading digit and the following letters
    // e.g. "1Co" becomes "1\\s*Co" so "1 Co" also matches
    pat = pat.replace(/^([123])([A-Za-z])/, "$1\\s*$2");
    return pat;
  })
  .join("|");

// Matches: optional !opt-out, book name/abbr, chapter, optional verse+range.
// Word-boundary anchored via (?<!\w) / (?!\w).
//
// Capture groups:
//   1: bang ("!" or "")
//   2: book name/abbr
//   3: chapter
//   — colon branch (verse ref):
//   4: verseStart
//   5: rangeVal  — end verse (same-ch) OR end chapter (cross-ch)
//   6: endVerse  — only present in cross-chapter range
//   — dash branch (chapter-only range, no colon):
//   7: endChapter  — e.g. "2" in "Romans 1–2"
const BIBLE_REF_RE = new RegExp(
  `(?<![\\w])(\\!?)(${_bookPattern})\\s+(\\d+)(?::(\\d+)(?:\\s*[-\u2013\u2014]\\s*(\\d+)(?::(\\d+))?)?|\\s*[-\u2013\u2014]\\s*(\\d+))?(?![\\w])`,
  "gi",
);

// Supported translation abbreviations (case-sensitive, word-boundary matched).
// When one of these follows the last ref in a citation group, all refs in that
// group link to that translation instead of the default ESV.
const TRANSLATIONS = new Set([
  "ESV",
  "KJV",
  "NASB",
  "NIV",
  "NKJV",
  "NLT",
  "NRSV",
]);
const TRANS_RE = /\b(ESV|KJV|NASB|NIV|NKJV|NLT|NRSV)\b/g;

// Pre-pass: build a map from each named-ref start index → translation abbreviation.
// For each named ref, the translation is the first TRANS_RE match that appears
// after it and before the next named ref; defaults to 'ESV' if none is found.
function buildTranslationMap(text) {
  const map = new Map();

  BIBLE_REF_RE.lastIndex = 0;
  const namedRefs = [];
  let m;
  while ((m = BIBLE_REF_RE.exec(text)) !== null) {
    if (m[1] !== "!") namedRefs.push({ index: m.index });
  }

  TRANS_RE.lastIndex = 0;
  const transList = [];
  while ((m = TRANS_RE.exec(text)) !== null) {
    transList.push({ index: m.index, abbr: m[1] });
  }

  for (let i = 0; i < namedRefs.length; i++) {
    const from = namedRefs[i].index;
    const to = i + 1 < namedRefs.length ? namedRefs[i + 1].index : Infinity;
    const found = transList.find((t) => t.index > from && t.index < to);
    map.set(from, found ? found.abbr : "ESV");
  }

  return map;
}

function buildReflyUrl(
  cwms,
  chapter,
  verseStart,
  rangeVal,
  endVerse,
  endChapter,
  translation = "ESV",
) {
  // rangeVal = endVerse (same-chapter) or endChapter (cross-chapter verse ref)
  // endVerse = undefined (same-chapter) or the end verse (cross-chapter)
  // endChapter = end chapter for chapter-only ranges (no verse)
  // URL: https://ref.ly/{cwms}{chapter}[.{verse}[-{endVerse}|{endChapter}.{endVerse}]|[-{endChapter}]];{translation}
  let ref = `${cwms}${chapter}`;
  if (verseStart) {
    ref += `.${verseStart}`;
    if (rangeVal) {
      if (endVerse) {
        // Cross-chapter: rangeVal is end chapter, endVerse is end verse
        ref += `-${rangeVal}.${endVerse}`;
      } else {
        // Same-chapter: rangeVal is end verse
        ref += `-${rangeVal}`;
      }
    }
  } else if (endChapter) {
    // Chapter-only range, e.g. "Romans 1–2" → Ro1-2
    ref += `-${endChapter}`;
  }
  return `https://ref.ly/${ref};${translation}`;
}

// Matches bare chapter:verse OR bare verse continuations after a separator.
// Two branches via alternation:
//   A) chapter:verse[-range] — colon present after firstNum
//   B) verse[-verse]         — no colon; requires ctxState.lastChapter to resolve
//
// Groups: 1=sep  2=firstNum  3=verseStart(A)  4=rangeVal(A)  5=endVerse(A cross-ch)  6=bareRangeEnd(B)
const CONT_REF_RE =
  /([;,]\s*)(\d+)(?::(\d+)(?:\s*[-\u2013\u2014]\s*(\d+)(?::(\d+))?)?|(?:\s*[-\u2013\u2014]\s*(\d+))?)?(?![\w:])/g;

function makeBibleRefLink(url, rawText) {
  let lt = rawText.replace(/\s/g, "\u00a0");
  lt = lt.replace(/(\d)\s*[-\u2014]\s*(\d)/g, "$1\u2013$2");
  return `<a href="${url}" class="external bible-ref" target="_blank" rel="noopener noreferrer">${lt}</a>`;
}

// ctxState = { lastCwms, lastChapter, translation } — shared across processPlainText calls.
// Apply continuation refs to a plain-text chunk using current context.
//
// Strict chaining rule: the gap between the end of one ref (or the start of the
// text) and the opening separator of the next continuation ref must contain only
// whitespace.  Any non-whitespace character breaks the chain immediately and all
// remaining text is emitted unchanged.  This prevents distant numbers (e.g. a
// year in a timestamp like ", 20 April 2013") from being picked up as verses.
function applyContinuationRefs(text, ctxState) {
  if (!ctxState.lastCwms) return text;
  CONT_REF_RE.lastIndex = 0;
  let result = "";
  let pos = 0;
  let m;
  while ((m = CONT_REF_RE.exec(text)) !== null) {
    // If the gap between the current position and this match contains any
    // non-whitespace characters, the continuation chain is broken — stop.
    const gap = text.slice(pos, m.index);
    if (/\S/.test(gap)) break;

    result += gap;
    const [match, sep, firstNum, verseStart, rangeVal, endVerse, bareRangeEnd] =
      m;
    let chapter, vs, rv, ev;
    if (verseStart !== undefined) {
      // Branch A: chapter:verse format — firstNum is the chapter
      chapter = firstNum;
      vs = verseStart;
      rv = rangeVal;
      ev = endVerse;
      ctxState.lastChapter = chapter;
    } else if (ctxState.lastChapter) {
      // Branch B: bare verse — firstNum is a verse in the last known chapter
      chapter = ctxState.lastChapter;
      vs = firstNum;
      rv = bareRangeEnd;
      ev = undefined;
    } else {
      // No chapter context yet; can't resolve a bare verse — emit raw and continue
      result += match;
      pos = m.index + match.length;
      continue;
    }
    const url = buildReflyUrl(
      ctxState.lastCwms,
      chapter,
      vs,
      rv,
      ev,
      ctxState.translation,
    );
    result += sep + makeBibleRefLink(url, match.slice(sep.length));
    pos = m.index + match.length;
  }
  // Append everything from pos onwards unchanged (covers both the normal
  // end-of-loop case and the early-break case)
  result += text.slice(pos);
  return result;
}

// ctxState = { lastCwms, lastChapter, translation } — shared across calls within one
// linkBibleRefs pass so continuation refs can span inline tags. Reset at block boundaries.
function processPlainText(text, ctxState) {
  // Pre-pass: determine which translation each named ref's group uses
  const transMap = buildTranslationMap(text);

  BIBLE_REF_RE.lastIndex = 0;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = BIBLE_REF_RE.exec(text)) !== null) {
    const [
      match,
      bang,
      bookName,
      chapter,
      verseStart,
      rangeVal,
      endVerse,
      endChapter,
    ] = m;
    // Apply continuation refs to the gap before this named ref
    result += applyContinuationRefs(text.slice(lastIndex, m.index), ctxState);
    if (bang === "!") {
      // Opt-out: emit raw text without the leading !
      result += match.slice(1);
    } else {
      const normalized = bookName.toLowerCase().replace(/\s+/g, " ").trim();
      const cwms =
        _bookCwmsMap.get(normalized) ||
        _bookCwmsMap.get(normalized.replace(/\s/g, ""));
      if (cwms) {
        ctxState.lastCwms = cwms;
        ctxState.lastChapter = chapter;
        ctxState.translation = transMap.get(m.index) || "ESV";
        const url = buildReflyUrl(
          cwms,
          chapter,
          verseStart,
          rangeVal,
          endVerse,
          endChapter,
          ctxState.translation,
        );
        result += makeBibleRefLink(url, match);
      } else {
        result += match;
      }
    }
    lastIndex = m.index + match.length;
  }
  // Trailing text after the last named ref
  result += applyContinuationRefs(text.slice(lastIndex), ctxState);
  // Move each trailing translation abbreviation inside the preceding closing </a>
  // e.g. "3:1–4</a> KJV" → "3:1–4 KJV</a>"
  result = result.replace(
    /(<\/a>)\s+(ESV|KJV|NASB|NIV|NKJV|NLT|NRSV)\b/g,
    " $2$1",
  );
  return result;
}

// Tags whose content we skip entirely (no Bible-ref linking inside these)
const SKIP_TAGS = new Set([
  "a",
  "code",
  "pre",
  "script",
  "style",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

// Block-level tags that reset the continuation-ref context between paragraphs/items
const BLOCK_TAGS = new Set([
  "p",
  "li",
  "dd",
  "dt",
  "blockquote",
  "div",
  "section",
  "article",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "td",
  "th",
  "figcaption",
]);

function linkBibleRefs(html) {
  // Split HTML into raw-markup chunks and plain-text chunks.
  // Use a stack to correctly track nested skip tags (e.g. <a><code>…</code></a>).
  const result = [];
  // Regex to find HTML tags (opening, closing, self-closing, comments, CDATA)
  const TAG_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;

  // Stack of skip-tag names currently open
  const skipStack = [];
  // Shared continuation-ref context; reset at every block boundary
  const ctxState = { lastCwms: null, lastChapter: null, translation: "ESV" };
  let lastIndex = 0;

  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    const tagFull = m[0];
    const tagName = m[1] ? m[1].toLowerCase() : null;
    const before = html.slice(lastIndex, m.index);

    // Handle text before this tag
    if (before) {
      if (skipStack.length === 0) {
        result.push(processPlainText(before, ctxState));
      } else {
        result.push(before);
      }
    }

    // Reset continuation context at block boundaries (opening or closing tag)
    if (tagName && BLOCK_TAGS.has(tagName)) {
      ctxState.lastCwms = null;
      ctxState.lastChapter = null;
      ctxState.translation = "ESV";
    }

    // Update skip stack based on tag type
    if (tagName && SKIP_TAGS.has(tagName)) {
      if (tagFull.startsWith("</")) {
        // Closing tag: pop matching tag from the stack top
        if (
          skipStack.length > 0 &&
          skipStack[skipStack.length - 1] === tagName
        ) {
          skipStack.pop();
        }
      } else if (!tagFull.endsWith("/>")) {
        // Opening (non-self-closing) tag: push onto stack
        skipStack.push(tagName);
      }
    }

    result.push(tagFull);
    lastIndex = m.index + tagFull.length;
  }

  // Handle trailing text
  const tail = html.slice(lastIndex);
  if (tail) {
    if (skipStack.length === 0) {
      result.push(processPlainText(tail, ctxState));
    } else {
      result.push(tail);
    }
  }

  return result.join("");
}

// ─── Scripture Index Collector ────────────────────────────────────────────────

// Build the canonical short display form for a Bible ref (e.g. "3:16–17", "3").
function buildDisplayShort(
  chapter,
  verseStart,
  rangeVal,
  endVerse,
  endChapter,
) {
  if (verseStart === undefined || verseStart === null) {
    if (endChapter) return `${chapter}\u2013${endChapter}`; // chapter-only range
    return String(chapter);
  }
  if (!rangeVal) return `${chapter}:${verseStart}`;
  if (!endVerse) return `${chapter}:${verseStart}\u2013${rangeVal}`; // same-ch range
  return `${chapter}:${verseStart}\u2013${rangeVal}:${endVerse}`; // cross-ch range
}

// Collect continuation refs from a plain-text chunk. Mirrors applyContinuationRefs
// but records ref objects instead of emitting HTML.
function collectContRefs(
  text,
  ctxState,
  refs,
  pageUrl,
  pageTitle,
  sectionId,
  sectionTitle,
) {
  if (!ctxState.lastCwms) return;
  const info = _bookCwmsToInfo.get(ctxState.lastCwms);
  if (!info) return;

  CONT_REF_RE.lastIndex = 0;
  let pos = 0;
  let m;
  while ((m = CONT_REF_RE.exec(text)) !== null) {
    // Strict chaining: gap between last position and this match must be whitespace only.
    const gap = text.slice(pos, m.index);
    if (/\S/.test(gap)) break;

    const [, , firstNum, verseStartA, rangeValA, endVerseA, bareRangeEnd] = m;
    let chapter, verseStart, rangeVal, endVerse;

    if (verseStartA !== undefined) {
      // Branch A: chapter:verse format
      chapter = firstNum;
      verseStart = verseStartA;
      rangeVal = rangeValA;
      endVerse = endVerseA;
      ctxState.lastChapter = chapter;
    } else if (ctxState.lastChapter) {
      // Branch B: bare verse number in last known chapter
      chapter = ctxState.lastChapter;
      verseStart = firstNum;
      rangeVal = bareRangeEnd;
      endVerse = undefined;
    } else {
      pos = m.index + m[0].length;
      continue;
    }

    refs.push({
      bookIndex: info.bookIndex,
      bookSlug: info.bookSlug,
      bookName: info.bookName,
      bookCwms: info.bookCwms,
      chapterNum: parseInt(chapter),
      verseStart: parseInt(verseStart),
      rangeVal: rangeVal || undefined,
      endVerse: endVerse || undefined,
      displayShort: buildDisplayShort(chapter, verseStart, rangeVal, endVerse),
      pageUrl,
      pageTitle,
      sectionId,
      sectionTitle,
    });
    pos = m.index + m[0].length;
  }
}

// Collect named + continuation refs from a plain-text chunk.
function collectTextRefs(
  text,
  ctxState,
  refs,
  pageUrl,
  pageTitle,
  sectionId,
  sectionTitle,
) {
  BIBLE_REF_RE.lastIndex = 0;
  let lastIndex = 0;
  let m;
  while ((m = BIBLE_REF_RE.exec(text)) !== null) {
    const [
      match,
      bang,
      bookName,
      chapter,
      verseStart,
      rangeVal,
      endVerse,
      endChapter,
    ] = m;
    // Collect any continuation refs in the gap before this named ref
    collectContRefs(
      text.slice(lastIndex, m.index),
      ctxState,
      refs,
      pageUrl,
      pageTitle,
      sectionId,
      sectionTitle,
    );
    if (bang !== "!") {
      const normalized = bookName.toLowerCase().replace(/\s+/g, " ").trim();
      const cwms =
        _bookCwmsMap.get(normalized) ||
        _bookCwmsMap.get(normalized.replace(/\s/g, ""));
      if (cwms) {
        const info = _bookCwmsToInfo.get(cwms);
        if (info) {
          ctxState.lastCwms = cwms;
          ctxState.lastChapter = chapter;
          refs.push({
            bookIndex: info.bookIndex,
            bookSlug: info.bookSlug,
            bookName: info.bookName,
            bookCwms: info.bookCwms,
            chapterNum: parseInt(chapter),
            verseStart:
              verseStart !== undefined ? parseInt(verseStart) : undefined,
            rangeVal: rangeVal || undefined,
            endVerse: endVerse || undefined,
            endChapter: endChapter || undefined,
            displayShort: buildDisplayShort(
              chapter,
              verseStart,
              rangeVal,
              endVerse,
              endChapter,
            ),
            pageUrl,
            pageTitle,
            sectionId,
            sectionTitle,
          });
        }
      }
    }
    // opt-out refs (bang === "!") are not collected and do not update ctxState
    lastIndex = m.index + match.length;
  }
  // Collect continuation refs in trailing text after last named ref
  collectContRefs(
    text.slice(lastIndex),
    ctxState,
    refs,
    pageUrl,
    pageTitle,
    sectionId,
    sectionTitle,
  );
}

// Traverse rendered HTML tag-by-tag, tracking h2/h3 section context, and
// collect all Bible references from text nodes outside skip-tag regions.
// Returns an array of ref objects (may include duplicates; deduplication
// happens during index generation).
function collectBibleRefsFromHtml(html, pageUrl, pageTitle) {
  const refs = [];
  const TAG_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const skipStack = [];
  const ctxState = { lastCwms: null, lastChapter: null };

  // Heading accumulation state (tracks the h2/h3 we're currently inside)
  let pendingHeadingTag = null;
  let pendingHeadingId = null;
  let pendingHeadingBuffer = [];

  // The section in effect for refs collected at the current position
  let currentSectionId = null;
  let currentSectionTitle = null;

  let lastIndex = 0;
  let m;
  TAG_RE.lastIndex = 0;

  while ((m = TAG_RE.exec(html)) !== null) {
    const tagFull = m[0];
    const tagName = m[1] ? m[1].toLowerCase() : null;
    const before = html.slice(lastIndex, m.index);

    if (before) {
      if (pendingHeadingTag) {
        // Inside a heading: accumulate text for the section title
        pendingHeadingBuffer.push(before);
      }
      if (skipStack.length === 0) {
        // Outside any skip context: collect Bible refs
        collectTextRefs(
          before,
          ctxState,
          refs,
          pageUrl,
          pageTitle,
          currentSectionId,
          currentSectionTitle,
        );
      }
    }

    if (!tagName) {
      // HTML comment or CDATA — advance and continue
      lastIndex = m.index + tagFull.length;
      continue;
    }

    const isClose = tagFull.startsWith("</");
    const isSelfClose = tagFull.endsWith("/>");

    // Track h2/h3 section headings to provide fragment context for refs
    if ((tagName === "h2" || tagName === "h3") && !isSelfClose) {
      if (!isClose) {
        // Opening heading: start collecting its text content
        const idM = tagFull.match(/\bid\s*=\s*["']?([^"'\s>]+)["']?/);
        pendingHeadingTag = tagName;
        pendingHeadingId = idM ? idM[1] : null;
        pendingHeadingBuffer = [];
      } else if (pendingHeadingTag === tagName) {
        // Closing heading: finalise the section context
        currentSectionId = pendingHeadingId;
        currentSectionTitle = pendingHeadingBuffer
          .join("")
          .replace(/<[^>]*>/g, "")
          .trim();
        pendingHeadingTag = null;
        pendingHeadingId = null;
        pendingHeadingBuffer = [];
      }
    }

    // Reset continuation-ref context at every block boundary (opening or closing)
    if (BLOCK_TAGS.has(tagName)) {
      ctxState.lastCwms = null;
      ctxState.lastChapter = null;
    }

    // Maintain skip stack (prevents collecting refs inside <a>, <code>, etc.)
    if (SKIP_TAGS.has(tagName)) {
      if (isClose) {
        if (
          skipStack.length > 0 &&
          skipStack[skipStack.length - 1] === tagName
        ) {
          skipStack.pop();
        }
      } else if (!isSelfClose) {
        skipStack.push(tagName);
      }
    }

    lastIndex = m.index + tagFull.length;
  }

  // Handle any trailing text after the last tag
  const tail = html.slice(lastIndex);
  if (tail && skipStack.length === 0) {
    collectTextRefs(
      tail,
      ctxState,
      refs,
      pageUrl,
      pageTitle,
      currentSectionId,
      currentSectionTitle,
    );
  }

  return refs;
}

// ─── End Scripture Index Collector ───────────────────────────────────────────

async function findHtmlFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findHtmlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push(fullPath);
    }
  }
  return results;
}

// ─── End Bible Reference Auto-Linker ──────────────────────────────────────────

// ─── Abbreviation Expansion ───────────────────────────────────────────────────

async function loadAbbrMap() {
  const abbrFile = "abbreviations.json";
  let raw;
  try {
    raw = await fs.readFile(abbrFile, "utf-8");
  } catch {
    console.log(
      "Abbreviation expander: abbreviations.json not found, skipping.",
    );
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.log(
      "Abbreviation expander: abbreviations.json is not valid JSON, skipping.",
    );
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.log(
      "Abbreviation expander: abbreviations.json must be a JSON object, skipping.",
    );
    return null;
  }
  return data;
}

// ─── Alt Text Map ─────────────────────────────────────────────────────────────

async function loadAltTextMap() {
  const altFile = "alt-text.json";
  let raw;
  try {
    raw = await fs.readFile(altFile, "utf-8");
  } catch {
    console.log("Alt text injector: alt-text.json not found, skipping.");
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.log(
      "Alt text injector: alt-text.json is not valid JSON, skipping.",
    );
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.log(
      "Alt text injector: alt-text.json must be a JSON object, skipping.",
    );
    return null;
  }
  return data;
}

// Adds or replaces the alt attribute on any <img> whose src basename matches
// a key in altMap.  Matching is case-sensitive and against the filename only
// (no directory path, no query string).  Values containing double-quotes are
// automatically escaped as &quot;.
function applyAltText(html, altMap) {
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

// ─── End Alt Text Map ─────────────────────────────────────────────────────────

// Tags whose content we skip entirely for abbreviation wrapping
const ABBR_SKIP_TAGS = new Set(["abbr", "code", "pre", "script", "style"]);

function wrapAbbreviations(html, abbrMap) {
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

  // Split HTML into tag and text chunks, process only text nodes outside skip tags
  const result = [];
  const TAG_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const skipStack = [];
  let lastIndex = 0;

  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    const tagFull = m[0];
    const tagName = m[1] ? m[1].toLowerCase() : null;
    const before = html.slice(lastIndex, m.index);

    if (before) {
      if (skipStack.length === 0) {
        result.push(
          before.replace(combinedRe, (match) => {
            const expansion = abbrMap[match];
            return expansion != null
              ? `<abbr title="${expansion}">${match}</abbr>`
              : `<abbr>${match}</abbr>`;
          }),
        );
      } else {
        result.push(before);
      }
    }

    if (tagName && ABBR_SKIP_TAGS.has(tagName)) {
      if (tagFull.startsWith("</")) {
        if (
          skipStack.length > 0 &&
          skipStack[skipStack.length - 1] === tagName
        ) {
          skipStack.pop();
        }
      } else if (!tagFull.endsWith("/>")) {
        skipStack.push(tagName);
      }
    }

    result.push(tagFull);
    lastIndex = m.index + tagFull.length;
  }

  const tail = html.slice(lastIndex);
  if (tail) {
    if (skipStack.length === 0) {
      result.push(
        tail.replace(combinedRe, (match) => {
          const expansion = abbrMap[match];
          return expansion != null
            ? `<abbr title="${expansion}">${match}</abbr>`
            : `<abbr>${match}</abbr>`;
        }),
      );
    } else {
      result.push(tail);
    }
  }

  return result.join("");
}

// ─── End Abbreviation Expansion ───────────────────────────────────────────────

// ─── Initials Wrapping ────────────────────────────────────────────────────────

// Matches two or more consecutive "UppercaseLetter + period" groups, e.g.
// "D.A.", "R.C.", "J.R.R.", "U.S.A."  Single-letter abbreviations like "Dr."
// are intentionally excluded (they require two or more such groups).
const INITIALS_RE = /\b([A-Z]\.){2,}/g;

// Same skip-set as abbreviations: never wrap inside existing <abbr>, code, etc.
const INITIALS_SKIP_TAGS = new Set(["abbr", "code", "pre", "script", "style"]);

function wrapInitials(html) {
  const result = [];
  const TAG_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const skipStack = [];
  let lastIndex = 0;

  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    const tagFull = m[0];
    const tagName = m[1] ? m[1].toLowerCase() : null;
    const before = html.slice(lastIndex, m.index);

    if (before) {
      result.push(
        skipStack.length === 0
          ? before.replace(INITIALS_RE, "<abbr>$&</abbr>")
          : before,
      );
    }

    if (tagName && INITIALS_SKIP_TAGS.has(tagName)) {
      if (tagFull.startsWith("</")) {
        if (
          skipStack.length > 0 &&
          skipStack[skipStack.length - 1] === tagName
        ) {
          skipStack.pop();
        }
      } else if (!tagFull.endsWith("/>")) {
        skipStack.push(tagName);
      }
    }

    result.push(tagFull);
    lastIndex = m.index + tagFull.length;
  }

  const tail = html.slice(lastIndex);
  if (tail) {
    result.push(
      skipStack.length === 0
        ? tail.replace(INITIALS_RE, "<abbr>$&</abbr>")
        : tail,
    );
  }

  return result.join("");
}

// ─── End Initials Wrapping ────────────────────────────────────────────────────

// ─── Spaced Ellipsis Normalisation ───────────────────────────────────────────

// Converts spaced ellipses (". . ." with any whitespace, including U+00A0) to
// the typographically correct form with non-breaking spaces as HTML entities.
// The longer pattern (leading space) is applied first so it is not partially
// consumed by the shorter one.
function fixSpacedEllipses(html) {
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

// Tags whose content we skip entirely for Roman numeral wrapping
const ROMAN_SKIP_TAGS = new Set(["abbr", "code", "pre", "script", "style"]);

function wrapRomanNumerals(html) {
  const result = [];
  const TAG_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const skipStack = [];
  let lastIndex = 0;

  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    const tagFull = m[0];
    const tagName = m[1] ? m[1].toLowerCase() : null;
    const before = html.slice(lastIndex, m.index);

    if (before) {
      if (skipStack.length === 0) {
        result.push(
          before.replace(ROMAN_NUM_RE, (match) =>
            match.length >= 2
              ? `<span class="roman-num">${match}</span>`
              : match,
          ),
        );
      } else {
        result.push(before);
      }
    }

    if (tagName && ROMAN_SKIP_TAGS.has(tagName)) {
      if (tagFull.startsWith("</")) {
        if (
          skipStack.length > 0 &&
          skipStack[skipStack.length - 1] === tagName
        ) {
          skipStack.pop();
        }
      } else if (!tagFull.endsWith("/>")) {
        skipStack.push(tagName);
      }
    }

    result.push(tagFull);
    lastIndex = m.index + tagFull.length;
  }

  const tail = html.slice(lastIndex);
  if (tail) {
    if (skipStack.length === 0) {
      result.push(
        tail.replace(ROMAN_NUM_RE, (match) =>
          match.length >= 2 ? `<span class="roman-num">${match}</span>` : match,
        ),
      );
    } else {
      result.push(tail);
    }
  }

  return result.join("");
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
const DIVINE_NAME_SKIP_TAGS = new Set([
  "abbr",
  "code",
  "pre",
  "script",
  "style",
]);

function wrapDivineNames(html) {
  const result = [];
  const TAG_RE =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  const skipStack = [];
  let lastIndex = 0;

  const replace = (text) =>
    text.replace(DIVINE_NAME_RE, (match) => {
      const newMatch = match.replace(
        /\b(G|L|I\b)/g,
        `<span class="divine-name-initial">$1</span>`,
      );
      return `<span class="divine-name" data-name="${match}">${newMatch}</span>`;
    });

  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(html)) !== null) {
    const tagFull = m[0];
    const tagName = m[1] ? m[1].toLowerCase() : null;
    const before = html.slice(lastIndex, m.index);

    if (before) {
      result.push(skipStack.length === 0 ? replace(before) : before);
    }

    if (tagName && DIVINE_NAME_SKIP_TAGS.has(tagName)) {
      if (tagFull.startsWith("</")) {
        if (
          skipStack.length > 0 &&
          skipStack[skipStack.length - 1] === tagName
        ) {
          skipStack.pop();
        }
      } else if (!tagFull.endsWith("/>")) {
        skipStack.push(tagName);
      }
    }

    result.push(tagFull);
    lastIndex = m.index + tagFull.length;
  }

  const tail = html.slice(lastIndex);
  if (tail) {
    result.push(skipStack.length === 0 ? replace(tail) : tail);
  }

  return result.join("");
}

// ─── End Divine Name Wrapping ─────────────────────────────────────────────────

// ─── Heading ID Injection ─────────────────────────────────────────────────────
// Adds id attributes to <h2> and <h3> elements that don't already have one.
// IDs are generated by slugifying the element's plain-text content.
// Duplicate IDs within the same page are disambiguated with -2, -3, etc.
// Runs as the first post-processing step so all downstream passes and the
// future Scripture index can rely on the IDs being present.

function addHeadingIds(html) {
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

import markdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import markdownItMark from "markdown-it-mark";
import markdownItContainer from "markdown-it-container";
import markdownItBracketedSpans from "markdown-it-bracketed-spans";
import markdownItAttrs from "markdown-it-attrs";
import ejs from "ejs";
import slugify from "slugify";

function parseFencedAttrs(info) {
  const attrs = { classes: [], id: null, other: {} };
  if (!info) return attrs;
  const m = info.match(/^\x01(.*)\x01$/);
  if (!m) {
    attrs.classes.push(info);
    return attrs;
  }
  const tokens = m[1].match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  for (const token of tokens) {
    if (token.startsWith(".")) {
      attrs.classes.push(token.slice(1));
    } else if (token.startsWith("#")) {
      attrs.id = token.slice(1);
    } else if (token.includes("=")) {
      const eq = token.indexOf("=");
      const key = token.slice(0, eq);
      let val = token.slice(eq + 1);
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      attrs.other[key] = val;
    }
  }
  return attrs;
}

function protectFencedAttrs(text) {
  return text.replace(
    /^(:::)\s*\{([^}]+)\}/gm,
    (m, colons, content) => colons + "\x01" + content + "\x01",
  );
}

const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .enable("strikethrough")
  .use(markdownItFootnote)
  .use(markdownItMark)
  .use(markdownItBracketedSpans)
  .use(markdownItContainer, "", {
    validate: () => true,
    render(tokens, idx) {
      const info = tokens[idx].info.trim();
      if (tokens[idx].nesting === 1) {
        if (!info) return "<div>\n";
        const parsed = parseFencedAttrs(info);
        let tag = "<div";
        if (parsed.id) tag += ` id="${parsed.id}"`;
        if (parsed.classes.length)
          tag += ` class="${parsed.classes.join(" ")}"`;
        for (const [k, v] of Object.entries(parsed.other)) {
          tag += ` ${k}="${v}"`;
        }
        return tag + ">\n";
      }
      return "</div>\n";
    },
  })
  .use(markdownItAttrs);

const OUTPUT_DIR = "dist";
const TEMPLATE_PATH = path.join("template", "layout.ejs");
const SKIP_FILES = new Set(["replit.md"]);
const MD_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".github",
  ".local",
  "template",
]);
const ASSET_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".github",
  ".local",
]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
]);
const ASSET_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".css",
  ".js",
  ".eot",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
]);

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function findFiles(dir, { skipDirs, filter, rootDir }) {
  rootDir = rootDir || dir;
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;
      const subResults = await findFiles(fullPath, {
        skipDirs,
        filter,
        rootDir,
      });
      results.push(...subResults);
    } else if (entry.isFile()) {
      const item = filter(entry, fullPath, rootDir);
      if (item) results.push(item);
    }
  }
  return results;
}

function findMarkdownFiles(dir) {
  return findFiles(dir, {
    skipDirs: MD_SKIP_DIRS,
    filter: (entry, fullPath, rootDir) => {
      if (
        !entry.name.endsWith(".md") ||
        SKIP_FILES.has(entry.name.toLowerCase())
      )
        return null;
      const relDir = path.relative(rootDir, path.dirname(fullPath));
      return { filePath: fullPath, relDir, fileName: entry.name };
    },
  });
}

const ASSET_SKIP_FILES = new Set(["build.js"]);

function findAssetFiles(dir) {
  return findFiles(dir, {
    skipDirs: ASSET_SKIP_DIRS,
    filter: (entry, fullPath) => {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ASSET_EXTENSIONS.has(ext)) return null;
      if (ASSET_SKIP_FILES.has(entry.name)) return null;
      return { filePath: fullPath, fileName: entry.name };
    },
  });
}

function getOutputPaths(finalUrlPath) {
  // GitHub Pages serves dist/404.html as the custom 404 page.
  if (finalUrlPath === "/404") {
    return {
      outDirPath: OUTPUT_DIR,
      outFilePath: path.join(OUTPUT_DIR, "404.html"),
    };
  }
  let outDirPath;
  if (finalUrlPath === "/") {
    outDirPath = OUTPUT_DIR;
  } else {
    outDirPath = path.join(OUTPUT_DIR, finalUrlPath.substring(1));
  }
  return { outDirPath, outFilePath: path.join(outDirPath, "index.html") };
}

function getFrontmatterValue(data, key) {
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(data)) {
    if (k.toLowerCase() === lowerKey) {
      return data[k];
    }
  }
  return undefined;
}

function stripBrackets(value) {
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

/**
 * Resolve a wikilink/embed target to a single URL.
 * Returns:
 *   { url: string }        — exactly one match found
 *   { ambiguous: true }    — two or more matches (bare name collision)
 *   { notFound: true }     — no match at all
 *
 * If target contains "/" it is treated as path-qualified (e.g. "topic/Trinity")
 * and resolved by matching folder prefix + bare name against filesToProcess.
 *
 * excludeUrl — optional URL to remove from candidates before resolution.
 * Used when resolving "aside of" so a page is never considered an aside of itself.
 *
 * Root-file tiebreaker: when multiple candidates remain after self-exclusion,
 * if exactly one lives at the filesystem root (relDir === ""), it wins — because
 * a bare [[Name]] link is the only way to reference a root-level file and is
 * therefore as unambiguous as it can be.
 */
function resolveLink(target, fileMap, filesToProcess, excludeUrl = null) {
  const trimmed = target.trim();

  if (trimmed.includes("/")) {
    const lowerTarget = trimmed.toLowerCase();
    const parts = lowerTarget.split("/");
    const bareName = parts[parts.length - 1];
    const folderPrefix = parts.slice(0, -1).join("/");
    const matches = filesToProcess.filter((fi) => {
      const fiBareName = path.basename(fi.fileName, ".md").toLowerCase().trim();
      const fiDir = fi.relDir.toLowerCase();
      return (
        fiBareName === bareName &&
        (fiDir === folderPrefix || fiDir.endsWith("/" + folderPrefix))
      );
    });
    if (matches.length === 1) return { url: matches[0].finalUrlPath };
    if (matches.length > 1) return { ambiguous: true };
    return { notFound: true };
  }

  const key = resolveFileMapKey(trimmed, fileMap);
  let urls = fileMap[key];
  if (!urls || urls.length === 0) return { notFound: true };

  if (excludeUrl) urls = urls.filter((u) => u !== excludeUrl);
  if (urls.length === 0) return { notFound: true };
  if (urls.length === 1) return { url: urls[0] };

  // Root-file tiebreaker: prefer the single candidate that lives at the
  // filesystem root (relDir === ""), since a bare link is the only way to
  // reference it and is therefore unambiguous by definition.
  const rootCandidates = urls.filter((url) =>
    filesToProcess.some((fi) => fi.finalUrlPath === url && fi.relDir === ""),
  );
  if (rootCandidates.length === 1) return { url: rootCandidates[0] };

  return { ambiguous: true };
}

// Split an embed args string on | separators, but treat [[...]] as atomic
// so pipes inside wikilinks (display text) are not treated as separators.
// e.g. "[[topic/Trinity|Trinity]]|simple" → ["[[topic/Trinity|Trinity]]", "simple"]
function splitEmbedArgs(argsStr) {
  const args = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < argsStr.length) {
    if (argsStr[i] === "[" && argsStr[i + 1] === "[") {
      depth++;
      current += "[[";
      i += 2;
    } else if (argsStr[i] === "]" && argsStr[i + 1] === "]") {
      depth--;
      current += "]]";
      i += 2;
    } else if (argsStr[i] === "|" && depth === 0) {
      args.push(current.trim());
      current = "";
      i++;
    } else {
      current += argsStr[i];
      i++;
    }
  }
  args.push(current.trim());
  return args;
}

function resolveEmbeds(
  text,
  contentMap,
  {
    seen = new Set(),
    fileMap = null,
    filesToProcess = null,
    contentMapByUrl = null,
  } = {},
) {
  return text.replace(
    /\{\{([^}|]+?)(?:\|([^}]*))?\}\}/g,
    (match, name, argsStr) => {
      name = name.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
      const key = name.toLowerCase().trim();

      // Numeric names are unfilled positional placeholders — leave as empty
      if (/^\d+$/.test(key)) return "";

      if (seen.has(key)) {
        console.warn(`Warning: Circular embed detected — "${name}"`);
        return `<!-- circular embed: ${name} -->`;
      }

      let embedContent;

      if (name.includes("/") && fileMap && filesToProcess && contentMapByUrl) {
        const resolved = resolveLink(name, fileMap, filesToProcess);
        if (resolved.url) {
          embedContent = contentMapByUrl[resolved.url];
          if (embedContent === undefined || embedContent === null) {
            console.warn(`Warning: Embed not found — "${name}"`);
            return `<!-- embed not found: ${name} -->`;
          }
        } else if (resolved.ambiguous) {
          console.warn(
            `Warning: Ambiguous embed — "${name}" matches multiple files`,
          );
          return `<!-- ambiguous embed: ${name} -->`;
        } else {
          console.warn(`Warning: Embed not found — "${name}"`);
          return `<!-- embed not found: ${name} -->`;
        }
      } else {
        const contentEntries = contentMap[key];
        if (!contentEntries || contentEntries.length === 0) {
          console.warn(`Warning: Embed not found — "${name}"`);
          return `<!-- embed not found: ${name} -->`;
        }
        if (contentEntries.length > 1) {
          console.warn(
            `Warning: Ambiguous embed — "${name}" matches ${contentEntries.length} files`,
          );
          return `<!-- ambiguous embed: ${name} -->`;
        }
        embedContent = contentEntries[0];
      }

      const args = argsStr ? splitEmbedArgs(argsStr) : [];

      for (let i = 0; i < args.length; i++) {
        embedContent = embedContent.replace(
          new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"),
          args[i],
        );
      }

      // Replace any remaining unfilled {{N}} placeholders with empty string
      embedContent = embedContent.replace(/\{\{\d+\}\}/g, "");

      embedContent = embedContent.replace(/\{\{\$args\}\}/g, args.join(", "));
      embedContent = embedContent.replace(/\{\{\$n\}\}/g, String(args.length));

      const newSeen = new Set(seen);
      newSeen.add(key);
      return resolveEmbeds(embedContent, contentMap, {
        seen: newSeen,
        fileMap,
        filesToProcess,
        contentMapByUrl,
      });
    },
  );
}

function parseCategoriesList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((v) => stripBrackets(String(v)));
  }
  return [stripBrackets(String(raw))];
}

// ─── Article-aware title helpers ─────────────────────────────────────────────

// English articles stripped from the front of a title before alphabetic
// comparison.  Matching is case-insensitive; "A", "An", and "The" are the
// only English articles; "An" is tested before "A" to avoid a prefix match.
const ARTICLE_RE = /^(the|an|a)\s+/i;

// Returns the sort key for a title: leading article moved to end.
// "The law of Christ" → "law of Christ" (used only for comparisons)
function sortableTitle(title) {
  return title.replace(ARTICLE_RE, "").trim();
}

// ─── End Article-aware title helpers ─────────────────────────────────────────

async function build() {
  // Initialise the CWMS→book-info map (requires slugify, called inside build()
  // to guarantee slugify's module is fully initialised before first use).
  _initBookCwmsToInfo();

  await ensureDir(OUTPUT_DIR);
  const layoutTemplate = await fs.readFile(TEMPLATE_PATH, "utf-8");

  const fileMap = {};
  const titleMap = {};
  const contentMap = {};
  const filesToProcess = [];

  const imageMap = {};
  const assetFiles = await findAssetFiles(".");
  const assetsOutDir = path.join(OUTPUT_DIR, "asset");
  if (assetFiles.length > 0) {
    await ensureDir(assetsOutDir);
  }
  const seenAssetNames = new Map();
  for (const { filePath: assetPath, fileName: assetName } of assetFiles) {
    const lowerName = assetName.toLowerCase();
    if (seenAssetNames.has(lowerName)) {
      console.warn(
        `Warning: Asset filename collision — "${assetName}" from "${assetPath}" overwrites "${seenAssetNames.get(lowerName)}"`,
      );
    }
    seenAssetNames.set(lowerName, assetPath);
    const outPath = path.join(assetsOutDir, assetName);
    await fs.copyFile(assetPath, outPath);
    const ext = path.extname(assetName).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      imageMap[lowerName] = `/asset/${assetName}`;
    }
  }
  if (assetFiles.length > 0) {
    console.log(`Copied ${assetFiles.length} asset(s) to dist/asset/`);
  }

  const mdFiles = await findMarkdownFiles(".");

  for (const { filePath, relDir, fileName } of mdFiles) {
    const content = await fs.readFile(filePath, "utf-8");
    let parsed;
    try {
      parsed = matter(content);
    } catch (err) {
      console.warn(
        `Warning: Failed to parse frontmatter in "${filePath}" — skipping (${err.message})`,
      );
      continue;
    }

    const baseName = path.basename(fileName, ".md");

    let permalink = getFrontmatterValue(parsed.data, "permalink");
    if (typeof permalink === "string") {
      permalink = permalink.replace(/^\/+/, "");
    }

    if (!permalink) {
      permalink = slugify(baseName, { lower: true, strict: true });
    }

    let finalUrlPath;
    if (relDir === "" && permalink === "home") {
      finalUrlPath = "/";
    } else if ((relDir === "" && permalink === "index") || permalink === "") {
      finalUrlPath = "/";
    } else {
      if (relDir === "") {
        finalUrlPath = `/${permalink}`;
      } else {
        finalUrlPath = `/${relDir}/${permalink}`;
      }
    }

    const key = baseName.toLowerCase().trim();
    if (!fileMap[key]) fileMap[key] = [];
    fileMap[key].push(finalUrlPath);

    // Also index by permalink slug so wikilinks / aside-of can use the
    // permalink as the target (e.g. [[home]] finding "Home page.md" whose
    // permalink is "home").
    const permKey = permalink.toLowerCase().trim();
    if (permKey && permKey !== key) {
      if (!fileMap[permKey]) fileMap[permKey] = [];
      if (!fileMap[permKey].includes(finalUrlPath))
        fileMap[permKey].push(finalUrlPath);
    }

    parsed.data.permalink = permalink;

    const title = getFrontmatterValue(parsed.data, "title") || baseName;
    if (!getFrontmatterValue(parsed.data, "title")) {
      parsed.data.title = baseName;
    }
    titleMap[key] = title;
    if (!contentMap[key]) contentMap[key] = [];
    contentMap[key].push(parsed.content);

    const hidden = !!getFrontmatterValue(parsed.data, "hidden");
    const rawAliases = getFrontmatterValue(parsed.data, "aliases");
    const aliases = parseCategoriesList(rawAliases);
    const asideOf = getFrontmatterValue(parsed.data, "aside of");
    const rawCategories = getFrontmatterValue(parsed.data, "categories");
    const categories = parseCategoriesList(rawCategories);
    const featured = !!getFrontmatterValue(parsed.data, "featured");
    const rawFeaturedWith = getFrontmatterValue(parsed.data, "featured with");
    const featuredWith = rawFeaturedWith
      ? stripBrackets(String(rawFeaturedWith))
      : null;
    const draft = !!getFrontmatterValue(parsed.data, "draft");
    const unlisted = !!getFrontmatterValue(parsed.data, "unlisted");

    filesToProcess.push({
      relDir,
      fileName,
      filePath,
      baseName,
      permalink,
      finalUrlPath,
      parsed,
      title,
      hidden,
      aliases,
      asideOf: asideOf ? stripBrackets(String(asideOf)) : null,
      categories,
      featured,
      featuredWith,
      draft,
      unlisted,
    });
  }

  const aliasRedirects = [];
  for (const fileInfo of filesToProcess) {
    if (fileInfo.aliases.length === 0) continue;
    for (const aliasName of fileInfo.aliases) {
      const aliasSlug = slugify(aliasName, { lower: true, strict: true });
      const aliasUrlPath =
        fileInfo.relDir === ""
          ? `/${aliasSlug}`
          : `/${fileInfo.relDir}/${aliasSlug}`;
      const aliasKey = aliasName.toLowerCase().trim();
      if (!fileMap[aliasKey]) fileMap[aliasKey] = [];
      if (!fileMap[aliasKey].includes(fileInfo.finalUrlPath))
        fileMap[aliasKey].push(fileInfo.finalUrlPath);
      if (!fileMap[aliasSlug]) fileMap[aliasSlug] = [];
      if (!fileMap[aliasSlug].includes(fileInfo.finalUrlPath))
        fileMap[aliasSlug].push(fileInfo.finalUrlPath);
      aliasRedirects.push({
        fromUrlPath: aliasUrlPath,
        toUrl: fileInfo.finalUrlPath,
        toTitle: fileInfo.title,
      });
    }
  }

  const featuredPages = [];
  const draftPages = [];

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    if (fileInfo.unlisted) continue;
    if (fileInfo.featured) {
      featuredPages.push({ title: fileInfo.title, url: fileInfo.finalUrlPath });
    }
    if (fileInfo.draft) {
      draftPages.push({ title: fileInfo.title, url: fileInfo.finalUrlPath });
    }
  }

  featuredPages.sort((a, b) =>
    sortableTitle(a.title).localeCompare(
      sortableTitle(b.title),
      undefined,
      { sensitivity: "base" },
    ),
  );
  draftPages.sort((a, b) =>
    sortableTitle(a.title).localeCompare(
      sortableTitle(b.title),
      undefined,
      { sensitivity: "base" },
    ),
  );

  // Map from primary page URL → secondary pages that declare "featured with" pointing to it.
  // Secondary pages appear alongside their primary on the featured topics index.
  const featuredWithMap = {};
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    if (fileInfo.unlisted) continue;
    if (!fileInfo.featuredWith) continue;
    const resolved = resolveLink(
      fileInfo.featuredWith,
      fileMap,
      filesToProcess,
    );
    if (!resolved.url) continue;
    const targetUrl = resolved.url;
    if (!featuredWithMap[targetUrl]) featuredWithMap[targetUrl] = [];
    featuredWithMap[targetUrl].push({
      title: fileInfo.title,
      url: fileInfo.finalUrlPath,
    });
  }

  // asidesMap: keyed by the URL of the primary page an aside belongs to.
  const asidesMap = {};
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    if (!fileInfo.asideOf) continue;
    const resolved = resolveLink(fileInfo.asideOf, fileMap, filesToProcess, fileInfo.finalUrlPath);
    if (!resolved.url) {
      if (resolved.ambiguous) {
        console.warn(
          `Warning: Ambiguous "aside of" target — "${fileInfo.asideOf}" in "${fileInfo.filePath}"`,
        );
      } else {
        console.warn(
          `Warning: Could not find "aside of" target — "${fileInfo.asideOf}" in "${fileInfo.filePath}"`,
        );
      }
      continue;
    }
    if (!asidesMap[resolved.url]) {
      asidesMap[resolved.url] = [];
    }
    asidesMap[resolved.url].push({
      title: fileInfo.title,
      url: fileInfo.finalUrlPath,
    });
  }

  // membersMap: keyed by the URL of the category page a file belongs to.
  const membersMap = {};
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    if (fileInfo.unlisted) continue;
    for (const catName of fileInfo.categories) {
      const resolved = resolveLink(catName, fileMap, filesToProcess);
      if (!resolved.url) {
        if (resolved.ambiguous) {
          console.warn(
            `Warning: Ambiguous category target — "${catName}" in "${fileInfo.filePath}"`,
          );
        }
        continue;
      }
      if (!membersMap[resolved.url]) {
        membersMap[resolved.url] = [];
      }
      membersMap[resolved.url].push({
        title: fileInfo.title,
        url: fileInfo.finalUrlPath,
      });
    }
  }

  // Sort each category's member list article-aware alphabetically so category
  // pages and subcategory pages render in consistent order regardless of file
  // discovery order.
  for (const arr of Object.values(membersMap)) {
    arr.sort((a, b) =>
      sortableTitle(a.title).localeCompare(
        sortableTitle(b.title),
        undefined,
        { sensitivity: "base" },
      ),
    );
  }

  // Build a URL→fileInfo lookup for fast reverse lookups.
  const urlToFileInfo = {};
  for (const fi of filesToProcess) {
    urlToFileInfo[fi.finalUrlPath] = fi;
  }

  const hiddenUrls = new Set(
    filesToProcess.filter((f) => f.hidden).map((f) => f.finalUrlPath),
  );
  const unlistedUrls = new Set(
    filesToProcess.filter((f) => f.unlisted).map((f) => f.finalUrlPath),
  );
  const allKnownUrls = new Set([
    ...Object.values(fileMap)
      .flat()
      .filter((url) => !hiddenUrls.has(url)),
    ...aliasRedirects.map((r) => r.fromUrlPath),
    ...Object.values(imageMap),
    "/search",
    "/random",
  ]);

  // Register every non-hidden page's backlinks URL so classifyLinks never
  // marks a link to it as broken (e.g. the footer link added by the template).
  for (const fi of filesToProcess) {
    if (fi.hidden) continue;
    allKnownUrls.add(
      fi.finalUrlPath === "/" ? "/backlinks" : `${fi.finalUrlPath}/backlinks`,
    );
  }
  const draftUrls = new Set(draftPages.map((p) => p.url));
  const featuredUrls = new Set(featuredPages.map((p) => p.url));
  // membersMap is now URL-keyed, so its keys are already the category page URLs.
  const categoryUrls = new Set(Object.keys(membersMap));
  const asideUrls = new Set();
  for (const fileInfo of filesToProcess) {
    if (fileInfo.asideOf) {
      asideUrls.add(fileInfo.finalUrlPath);
    }
  }

  function classifyLinks(html) {
    return html.replace(
      /<a\s([^>]*href="([^"]*)"[^>]*)>/g,
      (match, attrs, href) => {
        const classes = [];
        if (/^https?:\/\//.test(href)) {
          classes.push("external");
        } else {
          classes.push("internal");
          if (href.startsWith("/")) {
            // Strip fragment (#section) before checking URL sets
            const baseHref = href.split("#")[0];
            if (draftUrls.has(baseHref)) classes.push("draft");
            if (categoryUrls.has(baseHref)) classes.push("category");
            if (asideUrls.has(baseHref)) classes.push("aside");
            if (featuredUrls.has(baseHref)) classes.push("featured");
            if (!allKnownUrls.has(baseHref) && !baseHref.startsWith("/index/"))
              classes.push("broken");
          }
        }
        if (/class="/.test(attrs)) {
          return `<a ${attrs.replace(/class="([^"]*)"/, `class="$1 ${classes.join(" ")}"`)}>`;
        }
        return `<a class="${classes.join(" ")}" ${attrs}>`;
      },
    );
  }

  // Split a URL path into its non-empty segments to use as body classes.
  // e.g. "/index/scripture/romans" → ["index", "scripture", "romans"]
  function urlBodyClasses(url) {
    if (url === "/") return ["home"];
    return (url || "").split("/").filter(Boolean);
  }

  function renderLayout(content, locals = {}) {
    const fm = locals.frontmatter || {};
    const bodyClasses = locals.bodyClasses || urlBodyClasses(locals.url) || [];
    return classifyLinks(
      ejs.render(layoutTemplate, {
        frontmatter: fm,
        bodyClasses,
        content,
        asideOf: locals.asideOf || null,
        isAside: locals.isAside || false,
        asides: locals.asides || [],
        categories: locals.categories || [],
        subcategories: locals.subcategories || [],
        pages: locals.pages || [],
        featuredWith: locals.featuredWith || null,
        featured: locals.featured || false,
        backlinkUrl: locals.backlinkUrl || null,
        backlinkCount: locals.backlinkCount ?? 0,
      }),
    );
  }

  const allPages = [];
  for (const fileInfo of filesToProcess) {
    if (fileInfo.asideOf) continue;
    if (fileInfo.hidden) continue;
    if (fileInfo.unlisted) continue;
    if (membersMap[fileInfo.finalUrlPath]) continue;

    allPages.push({
      title: fileInfo.title,
      url: fileInfo.finalUrlPath,
      featured: fileInfo.featured || !!fileInfo.featuredWith,
    });
    for (const aliasName of fileInfo.aliases) {
      allPages.push({
        title: aliasName,
        redirect: { title: fileInfo.title, url: fileInfo.finalUrlPath },
      });
    }
  }
  allPages.sort((a, b) =>
    sortableTitle(a.title).localeCompare(
      sortableTitle(b.title),
      undefined,
      { sensitivity: "base" },
    ),
  );

  const contentMapByUrl = {};
  for (const fileInfo of filesToProcess) {
    contentMapByUrl[fileInfo.finalUrlPath] = fileInfo.parsed.content;
  }

  // ── Backlinks pre-pass ───────────────────────────────────────────────────────
  // Scan every non-hidden page's wikilinks (after embed resolution, matching the
  // same resolveLink logic used in the main loop) and build a map of
  //   targetUrl → [{title, url}]   (sorted alphabetically by title)
  // This must run BEFORE the main render loop so each page can receive its
  // backlinkCount for the footer link.

  const backlinksMap = {}; // targetUrl → [{title, url}]

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    const sourceUrl = fileInfo.finalUrlPath;

    const fullMarkdown = resolveEmbeds(fileInfo.parsed.content, contentMap, {
      fileMap,
      filesToProcess,
      contentMapByUrl,
    });

    fullMarkdown.replace(/(?:!?)\[\[(.*?)\]\]/g, (_match, inner) => {
      let target = inner;
      if (inner.includes("|")) {
        target = inner.split("|")[0];
      }
      let searchTarget = target.trim();
      const ext = path.extname(searchTarget).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) return _match;
      if (searchTarget.toLowerCase().endsWith(".md")) {
        searchTarget = searchTarget.slice(0, -3);
      }
      const resolved = resolveLink(searchTarget, fileMap, filesToProcess);
      if (resolved.url) {
        if (!backlinksMap[resolved.url]) backlinksMap[resolved.url] = [];
        // Avoid duplicates (same source linking to same target multiple times)
        if (!backlinksMap[resolved.url].some((e) => e.url === sourceUrl)) {
          backlinksMap[resolved.url].push({
            title: fileInfo.title,
            url: sourceUrl,
          });
        }
      }
      return _match;
    });
  }

  // Sort each backlinks list article-aware alphabetically by title
  for (const arr of Object.values(backlinksMap)) {
    arr.sort((a, b) =>
      sortableTitle(a.title).localeCompare(
        sortableTitle(b.title),
        undefined,
        { sensitivity: "base" },
      ),
    );
  }

  // ── End Backlinks pre-pass ───────────────────────────────────────────────────

  const searchDocs = [];
  // distFilePath → { url, title, unlisted } for Scripture ref collection
  const pageRegistry = new Map();

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;

    let markdownContent = resolveEmbeds(fileInfo.parsed.content, contentMap, {
      fileMap,
      filesToProcess,
      contentMapByUrl,
    });

    markdownContent = markdownContent.replace(
      /(!?)\[\[(.*?)\]\]/g,
      (match, bang, inner) => {
        const isEmbed = bang === "!";
        let target = inner;
        let text = inner;
        if (inner.includes("|")) {
          const parts = inner.split("|");
          target = parts[0];
          text = parts.slice(1).join("|");
        }

        let searchTarget = target.trim();

        const ext = path.extname(searchTarget).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const imgUrl = imageMap[searchTarget.toLowerCase()] || searchTarget;
          if (isEmbed) {
            let attrs = "";
            const dimMatch = text.match(/^(\d+)(?:x(\d+))?$/);
            if (dimMatch) {
              attrs += ` width="${dimMatch[1]}"`;
              if (dimMatch[2]) attrs += ` height="${dimMatch[2]}"`;
              return `<figure><img src="${imgUrl}" alt="${searchTarget}"${attrs}></figure>`;
            }
            const alt = text === inner ? searchTarget : text;
            return `<figure><img src="${imgUrl}" alt="${alt}"></figure>`;
          } else {
            const linkText = text === inner ? searchTarget : text;
            return `[${linkText}](${imgUrl})`;
          }
        }

        if (searchTarget.toLowerCase().endsWith(".md")) {
          searchTarget = searchTarget.substring(0, searchTarget.length - 3);
        }

        const resolved = resolveLink(searchTarget, fileMap, filesToProcess);
        if (resolved.url) {
          return `[${text}](${resolved.url})`;
        }
        if (resolved.ambiguous) {
          console.warn(
            `Warning: Ambiguous wikilink — "${searchTarget}" matches multiple files`,
          );
          return `<span class="broken">${text}</span>`;
        }
        return `<span class="broken">${text}</span>`;
      },
    );

    try {
      markdownContent = ejs.render(markdownContent, {
        frontmatter: fileInfo.parsed.data,
        contentMap,
        fileMap,
        imageMap,
      });
    } catch (err) {
      console.warn(
        `Warning: EJS render error in "${fileInfo.filePath}" — ${err.message}`,
      );
      markdownContent = `<!-- EJS render error in: ${fileInfo.fileName} -->`;
    }

    markdownContent = markdownContent.replace(/%%[\s\S]*?%%/g, "");

    markdownContent = markdownContent.replace(
      /(?<!~)~(?!~)([^~\n]+?)(?<!~)~(?!~)/g,
      "<small>$1</small>",
    );

    markdownContent = protectFencedAttrs(markdownContent);
    const htmlContent = md.render(markdownContent);

    let asideOfResolved = null;
    if (fileInfo.asideOf) {
      const resolved = resolveLink(fileInfo.asideOf, fileMap, filesToProcess, fileInfo.finalUrlPath);
      if (resolved.url) {
        const targetFi = urlToFileInfo[resolved.url];
        asideOfResolved = {
          title: targetFi ? targetFi.title : resolved.url,
          url: resolved.url,
        };
      }
    }

    const asides = asidesMap[fileInfo.finalUrlPath] || [];

    const resolvedCategories = fileInfo.categories.map((catName) => {
      const resolved = resolveLink(catName, fileMap, filesToProcess);
      if (resolved.url) {
        const targetFi = urlToFileInfo[resolved.url];
        return {
          title: targetFi ? targetFi.title : catName,
          url: resolved.url,
        };
      }
      return {
        title: catName,
        url: `/${slugify(catName, { lower: true, strict: true })}`,
      };
    });

    const allMembers = membersMap[fileInfo.finalUrlPath] || [];
    const subcategories = [];
    const pages = [];
    for (const member of allMembers) {
      if (membersMap[member.url] && membersMap[member.url].length > 0) {
        subcategories.push(member);
      } else {
        pages.push(member);
      }
    }

    const backlinkUrl =
      fileInfo.finalUrlPath === "/"
        ? "/backlinks"
        : `${fileInfo.finalUrlPath}/backlinks`;
    const backlinkCount = (backlinksMap[fileInfo.finalUrlPath] || []).length;

    const finalHtml = renderLayout(htmlContent, {
      url: fileInfo.finalUrlPath,
      frontmatter: fileInfo.parsed.data,
      asideOf: asideOfResolved,
      isAside: !!fileInfo.asideOf,
      asides,
      categories: resolvedCategories,
      subcategories,
      pages,
      featuredWith: fileInfo.featuredWith || null,
      featured: fileInfo.featured || false,
      backlinkUrl,
      backlinkCount,
    });

    const { outDirPath, outFilePath } = getOutputPaths(fileInfo.finalUrlPath);
    await ensureDir(outDirPath);
    await fs.writeFile(outFilePath, finalHtml);
    // Register for Scripture ref collection (non-hidden pages; unlisted flag preserved)
    pageRegistry.set(outFilePath, {
      url: fileInfo.finalUrlPath,
      title: fileInfo.title,
      unlisted: !!fileInfo.unlisted,
    });
    console.log(
      `Built: ${fileInfo.filePath} -> ${outFilePath} (URL: ${fileInfo.finalUrlPath})`,
    );

    if (!fileInfo.unlisted) {
      const bodyText = htmlContent
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      searchDocs.push({
        id: fileInfo.finalUrlPath,
        title: fileInfo.title,
        url: fileInfo.finalUrlPath,
        body: bodyText.slice(0, 5000),
      });
    }
  }

  for (const { fromUrlPath, toUrl, toTitle } of aliasRedirects) {
    const redirectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${toUrl}">
  <link rel="canonical" href="${toUrl}">
  <title>Redirecting to ${toTitle}</title>
</head>
<body>
  <p>Redirecting to <a href="${toUrl}">${toTitle}</a>...</p>
</body>
</html>`;
    const { outDirPath, outFilePath } = getOutputPaths(fromUrlPath);
    await ensureDir(outDirPath);
    await fs.writeFile(outFilePath, redirectHtml);
    console.log(`Built (alias redirect): ${fromUrlPath} -> ${toUrl}`);
  }

  // ── Backlinks sub-pages ──────────────────────────────────────────────────────
  // Generate a /pageurl/backlinks page for every non-hidden content page.

  // Minimal HTML escaper for inline text/attribute interpolation.
  const escHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let backlinksPageCount = 0;
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;

    const pageUrl = fileInfo.finalUrlPath;
    const blUrl = pageUrl === "/" ? "/backlinks" : `${pageUrl}/backlinks`;
    const inbound = backlinksMap[pageUrl] || [];

    let listHtml;
    if (inbound.length === 0) {
      listHtml = "<p>No pages link to this page.</p>";
    } else {
      listHtml =
        "<ul>\n" +
        inbound
          .map(
            (b) => `  <li><a href="${escHtml(b.url)}">${escHtml(b.title)}</a></li>`,
          )
          .join("\n") +
        "\n</ul>";
    }

    const blHtml = renderLayout(listHtml, {
      url: blUrl,
      frontmatter: {
        title: `Backlinks \u2014 ${fileInfo.title}`,
        permalink: blUrl.replace(/^\//, ""),
      },
    });

    const { outDirPath, outFilePath } = getOutputPaths(blUrl);
    await ensureDir(outDirPath);
    await fs.writeFile(outFilePath, blHtml);
    backlinksPageCount++;
  }
  console.log(
    `Backlinks pages: generated ${backlinksPageCount} page(s) (${Object.values(backlinksMap).reduce((s, a) => s + a.length, 0)} total inbound link(s) recorded).`,
  );
  // ── End Backlinks sub-pages ──────────────────────────────────────────────────

  // pagesWithCategories: URLs of pages that have categories themselves
  // (i.e. they belong to a parent category, so they appear as subcategories).
  const pagesWithCategories = new Set();
  for (const fileInfo of filesToProcess) {
    if (fileInfo.categories.length > 0) {
      pagesWithCategories.add(fileInfo.finalUrlPath);
    }
  }

  // membersMap is URL-keyed; its keys are the category page URLs.
  const topLevelCategoryPages = Object.keys(membersMap)
    .filter(
      (url) =>
        !pagesWithCategories.has(url) &&
        !hiddenUrls.has(url) &&
        !unlistedUrls.has(url),
    )
    .map((url) => {
      const fi = urlToFileInfo[url];
      return { title: fi ? fi.title : url, url };
    })
    .sort((a, b) =>
      sortableTitle(a.title).localeCompare(
        sortableTitle(b.title),
        undefined,
        { sensitivity: "base" },
      ),
    );

  const indexPages = [
    { slug: "alphabetical", title: "Alphabetical index", items: allPages },
    {
      slug: "categorical",
      title: "Categorical index",
      items: topLevelCategoryPages,
    },
    { slug: "featured", title: "Featured topics", items: featuredPages },
    { slug: "drafts", title: "Drafts", items: draftPages },
  ];

  for (const indexPage of indexPages) {
    let listHtml = "";
    if (indexPage.items.length === 0) {
      listHtml += "<p>No pages yet.</p>";
    } else {
      listHtml += "<ul>\n";
      for (const item of indexPage.items) {
        if (item.redirect) {
          listHtml += `  <li>${item.title} <small>(see <a href="${item.redirect.url}">${item.redirect.title}</a>)</small></li>\n`;
        } else {
          const starHtml =
            indexPage.slug === "alphabetical" && item.featured
              ? ' <span class="featured-badge fa-sharp fa-solid fa-star"></span>'
              : "";
          let withHtml = "";
          if (indexPage.slug === "featured") {
            const secondaries = featuredWithMap[item.url];
            if (secondaries && secondaries.length > 0) {
              const parts = secondaries.map(
                (w) => `<a href="${w.url}">${w.title}</a>`,
              );
              withHtml = ` <small>(and ${parts.join(", ")})</small>`;
            }
          }
          listHtml += `  <li><a href="${item.url}">${item.title}</a>${starHtml}${withHtml}</li>\n`;
        }
      }
      listHtml += "</ul>";
    }

    const html = renderLayout(listHtml, {
      url: `/index/${indexPage.slug}`,
      frontmatter: { title: indexPage.title, permalink: indexPage.slug },
    });

    const outDir = path.join(OUTPUT_DIR, "index", indexPage.slug);
    await ensureDir(outDir);
    await fs.writeFile(path.join(outDir, "index.html"), html);
    console.log(`Built (index): /index/${indexPage.slug}`);
  }

  await fs.writeFile(
    path.join(OUTPUT_DIR, "search-index.json"),
    JSON.stringify(searchDocs),
  );
  console.log(`Built search index: ${searchDocs.length} document(s)`);

  const searchJs = `(function() {
  var index = null;
  var docs = null;
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");

  function render(hits) {
    if (!hits.length) {
      results.innerHTML = input.value.trim() ? "<p>No results found.</p>" : "";
      return;
    }
    var html = "<ul>";
    for (var i = 0; i < hits.length; i++) {
      html += '<li><a href="' + hits[i].url + '">' + hits[i].title + '</a></li>';
    }
    html += "</ul>";
    results.innerHTML = html;
  }

  function doSearch() {
    if (!index) return;
    var q = input.value.trim();
    var url = new URL(window.location);
    if (q) {
      url.searchParams.set("q", q);
    } else {
      url.searchParams.delete("q");
    }
    history.replaceState(null, "", url);
    if (!q) { render([]); return; }
    var hits = index.search(q, { prefix: true, fuzzy: 0.2, boost: { title: 2 } });
    var mapped = [];
    for (var i = 0; i < hits.length; i++) {
      var doc = docs.find(function(d) { return d.id === hits[i].id; });
      if (doc) mapped.push({ title: doc.title, url: doc.url });
    }
    render(mapped);
  }

  fetch("/search-index.json")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      docs = data;
      index = new MiniSearch({ fields: ["title", "body"], storeFields: ["title", "url"] });
      index.addAll(docs);
      var params = new URLSearchParams(window.location.search);
      var q = params.get("q");
      if (q) { input.value = q; }
      doSearch();
    });

  input.addEventListener("input", doSearch);
})();
`;
  await fs.writeFile(path.join(OUTPUT_DIR, "search.js"), searchJs);

  const searchContent = `<div id="search-page">
  <input type="text" id="search-input" placeholder="Search…" autofocus>
  <div id="search-results"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/minisearch@7/dist/umd/index.min.js"><\/script>
<script src="/search.js"><\/script>`;

  const searchHtml = renderLayout(searchContent, {
    url: "/search",
    frontmatter: { title: "Search", permalink: "search" },
  });

  const searchOutDir = path.join(OUTPUT_DIR, "search");
  await ensureDir(searchOutDir);
  await fs.writeFile(path.join(searchOutDir, "index.html"), searchHtml);
  console.log("Built: /search");

  // Randomizer page — picks a random content page and redirects immediately
  const randomUrls = allPages
    .filter((item) => item.url) // exclude alias redirect stubs
    .map((item) => item.url);
  const randomContent = `<script>
  (function() {
    var pages = ${JSON.stringify(randomUrls)};
    if (!pages.length) { return; }
    window.location.replace(pages[Math.floor(Math.random() * pages.length)]);
  })();
  <\/script>
  <div><p><em>The lot is cast into the lap, but its every decision is from the <abbr>LORD</abbr>.<br><small>—Proverbs 16:33</small></em></p></div>
  <noscript><div><p>JavaScript is required for this feature. <a href="/index/alphabetical">Browse the index</a> instead.</p></div></noscript>`;
  const randomHtml = renderLayout(randomContent, {
    url: "/random",
    frontmatter: { title: "Random page", permalink: "random" },
  });
  const randomOutDir = path.join(OUTPUT_DIR, "random");
  await ensureDir(randomOutDir);
  await fs.writeFile(path.join(randomOutDir, "index.html"), randomHtml);
  console.log(`Built: /random (${randomUrls.length} page(s))`);

  await fs.writeFile(path.join(OUTPUT_DIR, ".nojekyll"), "");

  // Post-process: add id attributes to h2/h3 headings (must run first)
  const htmlFiles = await findHtmlFiles(OUTPUT_DIR);
  let headingCount = 0;
  for (const htmlFile of htmlFiles) {
    const raw = await fs.readFile(htmlFile, "utf-8");
    const withIds = addHeadingIds(raw);
    if (withIds !== raw) {
      await fs.writeFile(htmlFile, withIds);
      headingCount++;
    }
  }
  console.log(
    `Heading IDs: processed ${htmlFiles.length} HTML file(s), rewrote ${headingCount}.`,
  );

  // ── Scripture Index ────────────────────────────────────────────────────────
  // Collect Bible refs from every non-unlisted content page (headings IDs are
  // now in place, so section fragment links will be accurate).
  const allCollectedRefs = [];
  for (const [htmlFile, pageInfo] of pageRegistry) {
    if (pageInfo.unlisted) continue;
    if (categoryUrls.has(pageInfo.url)) continue;
    if (asideUrls.has(pageInfo.url)) continue;
    const html = await fs.readFile(htmlFile, "utf-8");
    const pageRefs = collectBibleRefsFromHtml(
      html,
      pageInfo.url,
      pageInfo.title,
    );
    allCollectedRefs.push(...pageRefs);
  }
  console.log(
    `Scripture collector: ${allCollectedRefs.length} ref(s) from ${pageRegistry.size} page(s).`,
  );

  // Group refs by book, then by canonical ref key (for deduplication).
  // refsByBook: Map<bookIndex, { bookSlug, bookName, entryMap }>
  // entryMap:   Map<entryKey, { chapterNum, verseStart, rangeVal, endVerse,
  //                             displayShort, occMap }>
  // occMap:     Map<occKey, { pageUrl, pageTitle, sectionId, sectionTitle }>
  const refsByBook = new Map();
  for (const ref of allCollectedRefs) {
    let bookData = refsByBook.get(ref.bookIndex);
    if (!bookData) {
      bookData = {
        bookSlug: ref.bookSlug,
        bookName: ref.bookName,
        bookCwms: ref.bookCwms,
        entryMap: new Map(),
      };
      refsByBook.set(ref.bookIndex, bookData);
    }
    const entryKey = `${ref.chapterNum}|${ref.verseStart ?? ""}|${ref.rangeVal ?? ""}|${ref.endVerse ?? ""}|${ref.endChapter ?? ""}`;
    let entry = bookData.entryMap.get(entryKey);
    if (!entry) {
      entry = {
        chapterNum: ref.chapterNum,
        verseStart: ref.verseStart,
        rangeVal: ref.rangeVal,
        endVerse: ref.endVerse,
        displayShort: ref.displayShort,
        occMap: new Map(),
      };
      bookData.entryMap.set(entryKey, entry);
    }
    // Collapse multiple occurrences of the same ref on the same page+section
    const occKey = `${ref.pageUrl}|${ref.sectionId ?? ""}`;
    if (!entry.occMap.has(occKey)) {
      entry.occMap.set(occKey, {
        pageUrl: ref.pageUrl,
        pageTitle: ref.pageTitle,
        sectionId: ref.sectionId,
        sectionTitle: ref.sectionTitle,
      });
    }
  }

  // Referenced books in canonical (Genesis → Revelation) order
  const referencedBooks = [...refsByBook.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, bookData]) => bookData);

  const scriptureFiles = [];
  const scriptureRootDir = path.join(OUTPUT_DIR, "index", "scripture");
  await ensureDir(scriptureRootDir);

  // Root page: /index/scripture — lists all referenced books
  {
    let listHtml =
      referencedBooks.length === 0
        ? "<p>No Scripture references found.</p>"
        : "<ul>\n" +
          referencedBooks
            .map(
              (b) =>
                `  <li><a href="/index/scripture/${b.bookSlug}">${b.bookName}</a></li>`,
            )
            .join("\n") +
          "\n</ul>";
    const rootHtml = renderLayout(listHtml, {
      url: "/index/scripture",
      frontmatter: { title: "Scripture index", permalink: "scripture" },
    });
    const rootFile = path.join(scriptureRootDir, "index.html");
    await fs.writeFile(rootFile, rootHtml);
    scriptureFiles.push(rootFile);
    allKnownUrls.add("/index/scripture");
    console.log("Built (index): /index/scripture");
  }

  // Per-book pages: /index/scripture/{book-slug}
  for (const book of referencedBooks) {
    const entries = [...book.entryMap.values()];
    // Sort canonically: chapter → verse (chapter-only before verse) → range
    entries.sort((a, b) => {
      if (a.chapterNum !== b.chapterNum) return a.chapterNum - b.chapterNum;
      const vsA = a.verseStart ?? -1;
      const vsB = b.verseStart ?? -1;
      if (vsA !== vsB) return vsA - vsB;
      const rvA = a.rangeVal !== undefined ? parseInt(a.rangeVal) : -1;
      const rvB = b.rangeVal !== undefined ? parseInt(b.rangeVal) : -1;
      if (rvA !== rvB) return rvA - rvB;
      const evA = a.endVerse !== undefined ? parseInt(a.endVerse) : -1;
      const evB = b.endVerse !== undefined ? parseInt(b.endVerse) : -1;
      return evA - evB;
    });

    let listHtml = "<dl>\n";
    for (const entry of entries) {
      const innerItems = [...entry.occMap.values()]
        .map((occ) => {
          const href = occ.sectionId
            ? `${occ.pageUrl}#${occ.sectionId}`
            : occ.pageUrl;
          const label =
            occ.sectionId && occ.sectionTitle
              ? `<span class="page-title">${occ.pageTitle}</span>&nbsp;&rsaquo; <span class="section-title">${occ.sectionTitle}</span>`
              : `<span class="page-title">${occ.pageTitle}</span>`;
          return `<li><a href="${href}">${label}</a></li>`;
        })
        .join("\n");
      listHtml += `<dt class="scripture-reference">${book.bookCwms} ${entry.displayShort}</dt>\n<dd>\n<ul>\n${innerItems}\n</ul>\n</dd>\n`;
    }
    listHtml += "</dl>";

    const bookHtml = renderLayout(listHtml, {
      url: `/index/scripture/${book.bookSlug}`,
      frontmatter: {
        title: `Scripture index: ${book.bookName}`,
        permalink: book.bookSlug,
      },
    });
    const bookDir = path.join(scriptureRootDir, book.bookSlug);
    await ensureDir(bookDir);
    const bookFile = path.join(bookDir, "index.html");
    await fs.writeFile(bookFile, bookHtml);
    scriptureFiles.push(bookFile);
    allKnownUrls.add(`/index/scripture/${book.bookSlug}`);
    console.log(`Built (index): /index/scripture/${book.bookSlug}`);
  }

  // Run all post-processing passes on scripture files too (heading IDs first)
  for (const f of scriptureFiles) {
    const raw = await fs.readFile(f, "utf-8");
    const withIds = addHeadingIds(raw);
    if (withIds !== raw) await fs.writeFile(f, withIds);
  }

  // All HTML files to post-process: original content + scripture index pages
  const allHtmlFiles = [...htmlFiles, ...scriptureFiles];
  // ── End Scripture Index ────────────────────────────────────────────────────

  // Post-process: link Bible references in all HTML files
  let linkedCount = 0;
  for (const htmlFile of allHtmlFiles) {
    const raw = await fs.readFile(htmlFile, "utf-8");
    const linked = linkBibleRefs(raw);
    if (linked !== raw) {
      await fs.writeFile(htmlFile, linked);
      linkedCount++;
    }
  }
  console.log(
    `Bible ref linker: processed ${allHtmlFiles.length} HTML file(s), rewrote ${linkedCount}.`,
  );

  // Post-process: wrap abbreviations in all HTML files
  const abbrMap = await loadAbbrMap();
  if (abbrMap && Object.keys(abbrMap).length > 0) {
    let abbrCount = 0;
    for (const htmlFile of allHtmlFiles) {
      const raw = await fs.readFile(htmlFile, "utf-8");
      const wrapped = wrapAbbreviations(raw, abbrMap);
      if (wrapped !== raw) {
        await fs.writeFile(htmlFile, wrapped);
        abbrCount++;
      }
    }
    console.log(
      `Abbreviation expander: processed ${allHtmlFiles.length} HTML file(s), rewrote ${abbrCount}.`,
    );
  }

  // Post-process: wrap initials (e.g. D.A., J.R.R.) in all HTML files
  let initialsCount = 0;
  for (const htmlFile of allHtmlFiles) {
    const raw = await fs.readFile(htmlFile, "utf-8");
    const wrapped = wrapInitials(raw);
    if (wrapped !== raw) {
      await fs.writeFile(htmlFile, wrapped);
      initialsCount++;
    }
  }
  console.log(
    `Initials wrapper: processed ${allHtmlFiles.length} HTML file(s), rewrote ${initialsCount}.`,
  );

  // Post-process: wrap Roman numerals in all HTML files
  let romanCount = 0;
  for (const htmlFile of allHtmlFiles) {
    const raw = await fs.readFile(htmlFile, "utf-8");
    const wrapped = wrapRomanNumerals(raw);
    if (wrapped !== raw) {
      await fs.writeFile(htmlFile, wrapped);
      romanCount++;
    }
  }
  console.log(
    `Roman numeral wrapper: processed ${allHtmlFiles.length} HTML file(s), rewrote ${romanCount}.`,
  );

  // Post-process: wrap divine names (LORD, GOD, YHWH, etc.) in all HTML files
  let divineCount = 0;
  for (const htmlFile of allHtmlFiles) {
    const raw = await fs.readFile(htmlFile, "utf-8");
    const wrapped = wrapDivineNames(raw);
    if (wrapped !== raw) {
      await fs.writeFile(htmlFile, wrapped);
      divineCount++;
    }
  }
  console.log(
    `Divine name wrapper: processed ${allHtmlFiles.length} HTML file(s), rewrote ${divineCount}.`,
  );

  // Post-process: normalise spaced ellipses (". . ." → "&nbsp;.&nbsp;.&nbsp;.")
  let ellipsisCount = 0;
  for (const htmlFile of allHtmlFiles) {
    const raw = await fs.readFile(htmlFile, "utf-8");
    const fixed = fixSpacedEllipses(raw);
    if (fixed !== raw) {
      await fs.writeFile(htmlFile, fixed);
      ellipsisCount++;
    }
  }
  console.log(
    `Ellipsis normaliser: processed ${allHtmlFiles.length} HTML file(s), rewrote ${ellipsisCount}.`,
  );

  // Post-process: inject alt text on images from alt-text.json
  const altMap = await loadAltTextMap();
  if (altMap && Object.keys(altMap).length > 0) {
    let altCount = 0;
    for (const htmlFile of allHtmlFiles) {
      const raw = await fs.readFile(htmlFile, "utf-8");
      const patched = applyAltText(raw, altMap);
      if (patched !== raw) {
        await fs.writeFile(htmlFile, patched);
        altCount++;
      }
    }
    console.log(
      `Alt text injector: processed ${allHtmlFiles.length} HTML file(s), rewrote ${altCount}.`,
    );
  }
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
