# Abbreviation Expansion — <abbr> tag wrapping

## What & Why
Add a post-processing step that reads a user-maintained list of abbreviations
and their expansions, then wraps every occurrence of each abbreviation in the
built HTML with `<abbr title="expansion">` tags, so browsers can show the
full expansion on hover.

## Data source
A dedicated file `abbreviations.md` at the vault root contains only
frontmatter (no body content is needed). The build reads its `abbreviations`
key, which is a YAML mapping of abbreviation → expansion string.

Example:
```yaml
---
hidden: true
abbreviations:
  ESV: English Standard Version
  NASB: New American Standard Bible
  e.g.: exempli gratia (for example)
  cf.: confer (compare)
  viz.: videlicet (namely)
---
```

`hidden: true` prevents the file from being rendered as a page or appearing
in indexes, navigation, or search. The build already parses frontmatter for
every file — this file is just parsed but never rendered.

## Done looks like
- `abbreviations.md` exists at the vault root with the `hidden: true` and
  `abbreviations` frontmatter keys
- The build loads the `abbreviations` map before the post-processing pass
- A new `wrapAbbreviations(html, abbrMap)` function processes HTML the same
  way as `linkBibleRefs`: splits on HTML tags, processes only text nodes,
  skips content inside `<abbr>`, `<code>`, `<pre>`, `<script>`, `<style>`,
  and `<a>` tags, and wraps matched abbreviations in `<abbr title="...">` tags
- Abbreviations are matched case-sensitively; the list is sorted
  longest-first to prevent prefix collisions (e.g. "NKJV" before "KJV")
- The step runs as a final post-processing pass over all HTML files,
  immediately after the Bible ref linker pass
- A console log line reports how many files were rewritten, consistent with
  the style of the Bible ref linker log line
- If `abbreviations.md` does not exist or has no `abbreviations` key, the
  step is skipped with a brief console note

## Matching behavior
- Each abbreviation is matched as a literal string (regex-escaped)
- Word-boundary anchors (`\b`) are used on each side where the character is
  a word character; for abbreviations ending in `.` or other punctuation,
  only a leading `\b` is applied (the punctuation is a natural right boundary)
- An already-wrapped `<abbr>` is never re-wrapped (the skip-tag mechanism
  handles this: `<abbr>` is in the skip-tag set)

## Relevant files
- `build.js` — add `loadAbbrMap()`, `wrapAbbreviations()`, and the post-
  processing loop after the Bible ref linker block (lines ~1183–1196)
- `abbreviations.md` — new file to create at vault root
