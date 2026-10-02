import { walkHtml } from "../html/walk.js";
import {
  BIBLE_REF_RE,
  BLOCK_TAGS,
  CONT_REF_RE,
  SKIP_TAGS,
  bookInfoByCwms,
  cwmsByName,
} from "./refs.js";

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
  const info = bookInfoByCwms.get(ctxState.lastCwms);
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
        cwmsByName.get(normalized) ||
        cwmsByName.get(normalized.replace(/\s/g, ""));
      if (cwms) {
        const info = bookInfoByCwms.get(cwms);
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
export function collectBibleRefsFromHtml(html, pageUrl, pageTitle) {
  const refs = [];
  const ctxState = { lastCwms: null, lastChapter: null };

  // Heading accumulation state (tracks the h2/h3 we're currently inside)
  let pendingHeadingTag = null;
  let pendingHeadingId = null;
  let pendingHeadingBuffer = [];

  // The section in effect for refs collected at the current position
  let currentSectionId = null;
  let currentSectionTitle = null;

  walkHtml(html, SKIP_TAGS, {
    onText(text, skipped) {
      // Inside a heading: accumulate text for the section title
      if (pendingHeadingTag) pendingHeadingBuffer.push(text);
      // Outside any skip context: collect Bible refs
      if (!skipped) {
        collectTextRefs(
          text,
          ctxState,
          refs,
          pageUrl,
          pageTitle,
          currentSectionId,
          currentSectionTitle,
        );
      }
    },
    onTag(tagName, tagFull) {
      if (!tagName) return; // HTML comment or CDATA

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
    },
  });

  return refs;
}
