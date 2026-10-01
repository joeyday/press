---
title: Bible reference translation support
---
# Bible Reference Translation Support

## What & Why
Currently all Bible reference links point to the ESV. This adds support for
specifying a translation by placing its abbreviation after the last reference
in a citation group. All references in the group — the named ref and any
continuation refs that follow — link to that translation instead of ESV.

Supported abbreviations: ESV, KJV, NASB, NIV, NKJV, NLT, NRSV.

Examples:
- `Genesis 1:1; 2:1; 3:1–11 KJV` → three KJV links
- `Genesis 1:1; Genesis 2:1 KJV; Genesis 3:1–11` → ESV, KJV, ESV

## Done looks like
- A translation abbreviation placed after the last ref in a group changes all
  links in that group to use that translation in the ref.ly URL
- The abbreviation text is left in place in the rendered output
- Refs with no trailing abbreviation continue to default to ESV
- A new named-book ref starts a new group, so translations do not bleed
  between groups
- Existing behaviour (linking, non-breaking spaces, en-dashes, opt-out,
  continuation refs, block boundary reset) is entirely unchanged

## Out of scope
- Translation abbreviations separated from their group by inline HTML markup
  (e.g. `Gen 1:1 <em>note</em> KJV` — the KJV would not be detected because
  it falls in a different text node from the named ref)
- Per-verse translation override (only whole groups are affected)
- Any translation not in the supported list above

## Tasks
1. **Add TRANS_RE and buildTranslationMap()** — Define a case-sensitive regex
   matching the seven supported translation abbreviations at word boundaries.
   Write `buildTranslationMap(text)` which runs both BIBLE_REF_RE and TRANS_RE
   on the raw text chunk, then returns a `Map<namedRefIndex → translationAbbr>`:
   for each named ref, the translation is the first abbreviation appearing after
   it and before the next named ref, or `'ESV'` if none.

2. **Thread translation through ctxState and buildReflyUrl()** — Add a
   `translation` field to `ctxState` (default `'ESV'`, reset to `'ESV'` at
   block boundaries). Update `buildReflyUrl()` to accept a `translation`
   parameter and use it instead of the hardcoded `'ESV'`. Update
   `processPlainText()` to call `buildTranslationMap()` at the start and look
   up each named ref's translation before linking it. Update
   `applyContinuationRefs()` to pass `ctxState.translation` to
   `buildReflyUrl()`.

3. **Build and spot-check** — Rebuild the site and verify that an ESV ref URL
   remains unchanged, that a `KJV`-tagged group produces `;KJV` URLs for all
   members, and that two adjacent groups with different translations each use
   the correct one.

## Relevant files
- `build.js:125-220`