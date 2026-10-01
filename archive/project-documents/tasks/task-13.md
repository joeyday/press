---
title: Bring replit.md fully up to date
---
# Bring replit.md fully up to date

## What & Why
`replit.md` hasn't been kept current as features were added. It's missing the entire post-processing pipeline, several frontmatter properties, new template variables, the `/random` page, updated asset extensions, and has one stale code comment in `build.js`. This task fixes all of it so the doc accurately reflects the system as built.

## Done looks like
- Every frontmatter property that exists in the codebase is listed and described
- Every template variable passed to `layout.ejs` is listed
- The full processing pipeline (inline steps + post-processing steps) is documented in order
- The `/random` page, full-text search, and all four index pages are described
- Asset handling correctly lists `.js` as a handled extension
- The stale comment above `wrapDivineNames` in `build.js` is corrected to reflect uppercase output and the `data-name` attribute

## Out of scope
- Changing how any feature works
- Adding new features

## Tasks

1. **Fix stale comment in `build.js`** — Lines 650–651 above `wrapDivineNames` still say "→ Lord / God" and "Title-cases the text…"; update them to accurately describe the current behaviour: text is kept uppercase, `data-name` attribute is added.

2. **Rewrite `replit.md`** — Replace the existing file with a comprehensive, accurate reference covering:
   - All features (markdown parsing, frontmatter, templating, wikilinks, embeds, asset handling including `.js`, hidden/unlisted/draft/featured pages, categories, asides, redirects, OFM syntax, fenced containers, bracketed spans, footnotes, generic attrs, full-text search, `/random` page, index pages, link classification, `.nojekyll`)
   - Complete ordered pipeline: the 7 inline steps (embed resolve → wikilinks → EJS → strip comments → `~small~` → protect fenced attrs → markdown-it) followed by the 4 post-processing passes run over all HTML files (Bible ref linker, abbreviation expander, Roman numeral wrapper, divine name wrapper)
   - All frontmatter properties: `title`, `permalink`, `featured`, `draft`, `featured with`, `aside of`, `categories`, `aliases`, `hidden`, `unlisted`
   - All template variables: `frontmatter`, `content`, `asideOf`, `isAside`, `asides`, `categories`, `subcategories`, `pages`, `featured`, `featuredWith`
   - Bible ref linker details: book names/abbreviations supported, continuation ref chaining, translation suffixes (ESV/KJV/NASB/NIV/NKJV/NLT/NRSV), opt-out `!` prefix, ref.ly URL format, headings excluded
   - Abbreviation expander: `abbreviations.json` flat-object format, `null` value → `<abbr>` without title, string value → `<abbr title="…">`
   - Roman numeral wrapper: `<span class="roman-num">`, standalone ≥2-char rule, dotted-pair support
   - Divine name wrapper: `LORD`, `GOD`, `YHWH` → `<span class="divine-name" data-name="…">` keeping uppercase text; skips `abbr`, `code`, `pre`, `script`, `style`
   - Key files list (updated)

## Relevant files
- `replit.md`
- `build.js:648-660`