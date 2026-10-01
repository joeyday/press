---
title: Embed-first pipeline, remove embed.ejs
---
# Embed-First Processing Pipeline

  ## What & Why
  The current pipeline protects `{{...}}` embed blocks from the wikilink transformer, transforms wikilinks, then restores and expands the embeds via EJS. This protect/restore dance exists solely because the two steps run in the wrong order. Extra blank lines emitted by `embed.ejs`'s scriptlet blocks also inject unwanted whitespace into the markdown stream, causing spurious paragraph breaks in embedded content.

  Fixing both issues: make embed resolution the first step, building a complete markdown document before any other transformation. Replace `embed.ejs` and `expandShorthand` with a pure-JS recursive `resolveEmbeds` helper that needs no EJS plumbing.

  ## Done looks like
  - Embedded content is fully spliced into the outer markdown before wikilinks, EJS, or markdown-it run
  - No extra blank lines or spurious paragraph breaks appear around embedded content
  - Positional parameters (`{{1}}`, `{{2}}`, etc.) still work — args are substituted as plain strings
  - `{{$args}}` in an embed file is replaced with all positional args joined by `, `
  - `{{$n}}` in an embed file is replaced with the count of positional args as a plain integer literal, so EJS in the same file can evaluate it after embedding (e.g. `<% if ({{$n}} > 1) { %>` bakes down to `<% if (2 > 1) { %>` before EJS runs)
  - `partials/mt.md` is updated to use `{{$args}}` and `{{$n}}` instead of EJS `locals`
  - Nested embeds (embed within an embed) still resolve correctly
  - Circular embed references produce a `console.warn` and an HTML comment placeholder instead of an infinite loop
  - The protect/restore dance (lines 574–633) and `expandShorthand` are removed from build.js
  - `template/embed.ejs` is deleted
  - EJS render locals are simplified (no more `views`, `expandShorthand`, `resolveWikilinksInText`, or `viewsPath`)
  - Build output is otherwise unchanged

  ## Out of scope
  - Changes to how wikilinks, EJS expressions, or markdown-it work
  - Changes to frontmatter parsing, search index, or layout rendering
  - Any CSS or template styling changes

  ## Tasks
  1. **Write `resolveEmbeds` helper** — A recursive JS function `resolveEmbeds(text, contentMap, { seen })` that finds all `{{name|arg1|arg2}}` patterns (including the `{{[[name]]}}` form), looks up each name in `contentMap`, substitutes `{{1}}`/`{{2}}`/etc. as plain strings, `{{$args}}` as the comma-joined arg list, and `{{$n}}` as the integer count of args. Recurses on the result for nested embeds. Emits `console.warn` and an HTML comment placeholder for missing or circular embeds.

  2. **Refactor per-file pipeline** — Replace the protect/restore dance + `expandShorthand` call + EJS-based embed resolution with a single `resolveEmbeds` call at the top of the pipeline. Wikilink transformation then runs on the combined content with no protection needed. Simplify EJS render locals to remove embed-related helpers.

  3. **Remove dead code and migrate mt.md** — Delete `template/embed.ejs`, remove the `expandShorthand` function, remove any locals passed to EJS that are no longer needed (`expandShorthand`, `resolveWikilinksInText`, `viewsPath`). Update `partials/mt.md` to replace the EJS `locals` loop with `{{$args}}` and `{{$n}}`.

  ## Relevant files
  - `build.js:239-265`
  - `build.js:572-669`
  - `template/embed.ejs`
  - `partials/mt.md`