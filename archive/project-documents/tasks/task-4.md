---
title: Fix ref.ly URL format
---
# Fix ref.ly URL Format

## What & Why
The Bible reference linker generates incorrect ref.ly URLs. The current format uses a query string and OSIS abbreviations (`/r?t=ESV&q=Gen.1.1-Gen.1.3`). The correct format uses path-based CWMS abbreviations and a semicolon version suffix (`/Ge1.1-3;ESV`).

## Done looks like
- `Genesis 1:1-3` links to `https://ref.ly/Ge1.1-3;ESV`
- `John 7:53-8:11` links to `https://ref.ly/Jn7.53-8.11;ESV`
- `Isaiah 29` (chapter-only) links to `https://ref.ly/Isa29;ESV`
- `John 3:16` (single verse) links to `https://ref.ly/Jn3.16;ESV`
- All other link attributes (class, target, rel, non-breaking spaces, en-dashes) remain unchanged

## Out of scope
- Changing the set of recognised book names or abbreviations
- Supporting multiple Bible translations

## Tasks
1. **Fix the name→abbreviation lookup** — Replace the `_bookOsisMap` (which mapped to OSIS abbreviations) with a map that returns the CWMS abbreviation for each book. The CWMS abbreviation is already present as the last element of each book's `names` array in the `BIBLE_BOOKS` table; just use that instead of the `osis` field.

2. **Fix `buildReflyUrl()`** — Rewrite the function to accept a CWMS abbreviation and produce the correct URL:
   - Chapter only: `https://ref.ly/{cwms}{chapter};ESV`
   - Single verse: `https://ref.ly/{cwms}{chapter}.{verse};ESV`
   - Same-chapter range: `https://ref.ly/{cwms}{chapter}.{startVerse}-{endVerse};ESV`
   - Cross-chapter range: `https://ref.ly/{cwms}{chapter}.{startVerse}-{endChapter}.{endVerse};ESV`

3. **Run a build and spot-check** — Rebuild the site and verify the generated links in a few output HTML files match the expected format for each case above.

## Relevant files
- `build.js:76-155`