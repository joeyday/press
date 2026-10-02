import slugify from "slugify";

// Definitions shared by the Bible-ref linker and the Scripture collector.

// Each book is a list of its names: the full name first, then abbreviations.
// The last entry is the CWMS abbreviation used in ref.ly URLs.
export const BIBLE_BOOKS = [
  ["Genesis", "Ge"],
  ["Exodus", "Ex"],
  ["Leviticus", "Lev"],
  ["Numbers", "Nu"],
  ["Deuteronomy", "Dt"],
  ["Joshua", "Jos"],
  ["Judges", "Jdg"],
  ["Ruth", "Ru"],
  ["1 Samuel", "1Samuel", "1Sa"],
  ["2 Samuel", "2Samuel", "2Sa"],
  ["1 Kings", "1Kings", "1Ki"],
  ["2 Kings", "2Kings", "2Ki"],
  ["1 Chronicles", "1Chronicles", "1Ch"],
  ["2 Chronicles", "2Chronicles", "2Ch"],
  ["Ezra", "Ezr"],
  ["Nehemiah", "Ne"],
  ["Esther", "Est"],
  ["Job"],
  ["Psalms", "Psalm", "Ps"],
  ["Proverbs", "Pr"],
  ["Ecclesiastes", "Ecc"],
  ["Song of Solomon", "Song of Songs", "SS"],
  ["Isaiah", "Isa"],
  ["Jeremiah", "Jer"],
  ["Lamentations", "La"],
  ["Ezekiel", "Eze"],
  ["Daniel", "Da"],
  ["Hosea", "Hos"],
  ["Joel"],
  ["Amos", "Am"],
  ["Obadiah", "Ob"],
  ["Jonah", "Jnh"],
  ["Micah", "Mic"],
  ["Nahum", "Na"],
  ["Habakkuk", "Hab"],
  ["Zephaniah", "Zep"],
  ["Haggai", "Hag"],
  ["Zechariah", "Zec"],
  ["Malachi", "Mal"],
  ["Matthew", "Mt"],
  ["Mark", "Mk"],
  ["Luke", "Lk"],
  ["John", "Jn"],
  ["Acts", "Ac"],
  ["Romans", "Ro"],
  ["1 Corinthians", "1Corinthians", "1Co"],
  ["2 Corinthians", "2Corinthians", "2Co"],
  ["Galatians", "Gal"],
  ["Ephesians", "Eph"],
  ["Philippians", "Php"],
  ["Colossians", "Col"],
  ["1 Thessalonians", "1Thessalonians", "1Th"],
  ["2 Thessalonians", "2Thessalonians", "2Th"],
  ["1 Timothy", "1Timothy", "1Ti"],
  ["2 Timothy", "2Timothy", "2Ti"],
  ["Titus", "Tit"],
  ["Philemon", "Phm"],
  ["Hebrews", "Heb"],
  ["James", "Jas"],
  ["1 Peter", "1Peter", "1Pe"],
  ["2 Peter", "2Peter", "2Pe"],
  ["1 John", "1John", "1Jn"],
  ["2 John", "2John", "2Jn"],
  ["3 John", "3John", "3Jn"],
  ["Jude"],
  ["Revelation", "Rev"],
];


// Lowercased name or abbreviation → CWMS abbreviation.
export const cwmsByName = new Map();
// CWMS abbreviation → book info, for the Scripture index.
export const bookInfoByCwms = new Map();
BIBLE_BOOKS.forEach((names, bookIndex) => {
  const cwms = names[names.length - 1];
  for (const name of names) cwmsByName.set(name.toLowerCase(), cwms);
  bookInfoByCwms.set(cwms, {
    bookIndex,
    bookName: names[0],
    bookCwms: cwms,
    bookSlug: slugify(names[0], { lower: true, strict: true }),
  });
});

// Build the reference regex
// Sorted by length desc so longer matches win (e.g. "Song of Solomon" before "Song")
const allBookNames = BIBLE_BOOKS.flat().sort(
  (a, b) => b.length - a.length,
);
// Each book name pattern: allow optional \s* between words and between a leading
// digit and the rest (so "1 Co" matches the abbreviation "1Co", etc.)
const bookPattern = allBookNames
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
export const BIBLE_REF_RE = new RegExp(
  `(?<![\\w])(\\!?)(${bookPattern})\\s+(\\d+)(?::(\\d+)(?:\\s*[-\u2013\u2014]\\s*(\\d+)(?::(\\d+))?)?|\\s*[-\u2013\u2014]\\s*(\\d+))?(?![\\w])`,
  "gi",
);

// Supported translation abbreviations (case-sensitive, word-boundary matched).
// When one of these follows the last ref in a citation group, all refs in that
// group link to that translation instead of the default ESV.
export const TRANS_RE = /\b(ESV|KJV|NASB|NIV|NKJV|NLT|NRSV)\b/g;

// Matches bare chapter:verse OR bare verse continuations after a separator.
// Two branches via alternation:
//   A) chapter:verse[-range] — colon present after firstNum
//   B) verse[-verse]         — no colon; requires ctxState.lastChapter to resolve
//
// Groups: 1=sep  2=firstNum  3=verseStart(A)  4=rangeVal(A)  5=endVerse(A cross-ch)  6=bareRangeEnd(B)
export const CONT_REF_RE =
  /([;,]\s*)(\d+)(?::(\d+)(?:\s*[-\u2013\u2014]\s*(\d+)(?::(\d+))?)?|(?:\s*[-\u2013\u2014]\s*(\d+))?)?(?![\w:])/g;

// Tags whose content we skip entirely (no Bible-ref linking inside these)
export const SKIP_TAGS = new Set([
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
export const BLOCK_TAGS = new Set([
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

