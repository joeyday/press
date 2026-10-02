import { mapText } from "../html/walk.js";
import {
  BIBLE_REF_RE,
  BLOCK_TAGS,
  CONT_REF_RE,
  SKIP_TAGS,
  TRANS_RE,
  cwmsByName,
} from "./refs.js";

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
      undefined,
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
        cwmsByName.get(normalized) ||
        cwmsByName.get(normalized.replace(/\s/g, ""));
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

export function linkBibleRefs(html) {
  // Shared continuation-ref context; reset at every block boundary
  const ctxState = { lastCwms: null, lastChapter: null, translation: "ESV" };
  return mapText(
    html,
    SKIP_TAGS,
    (text) => processPlainText(text, ctxState),
    (tagName) => {
      if (tagName && BLOCK_TAGS.has(tagName)) {
        ctxState.lastCwms = null;
        ctxState.lastChapter = null;
        ctxState.translation = "ESV";
      }
    },
  );
}
