# Fix: abbreviation expander skips anchor tag contents

## What & Why
`wrapAbbreviations()` currently has `"a"` in its `ABBR_SKIP_TAGS` set, so
abbreviations inside any `<a>` element — including Bible ref links and regular
hyperlinks — are never wrapped. Both cases the user reported share this cause:
- `3:15 KJV` inside a Bible ref anchor → KJV skipped
- `Jordan Valley Church (PCA)` inside a regular hyperlink → PCA skipped

`<abbr>` nested inside `<a>` is valid HTML. The existing `"abbr"` entry in
`ABBR_SKIP_TAGS` already prevents double-wrapping of abbreviations that were
already processed; keeping `"a"` in the set is unnecessarily restrictive.

## Done looks like
- `"a"` is removed from `ABBR_SKIP_TAGS` in `wrapAbbreviations()`
- Build runs and the abbreviation expander wraps KJV inside the Genesis 3:15
  anchor on the home page, and PCA inside the Jordan Valley Church link on the
  about page
- All other skip tags (`abbr`, `code`, `pre`, `script`, `style`) remain

## Relevant files
- `build.js` — `ABBR_SKIP_TAGS` constant (~line 378)
