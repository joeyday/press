# Hidden Pages Get "broken" Link Class

  ## What & Why
  Links pointing to hidden pages are not receiving the `broken` CSS class, even though hidden pages produce no standalone output and are unreachable by visitors. The cause: `allKnownUrls` is populated from all values in `fileMap`, which includes hidden pages. Since their URLs are "known", `classifyLinks` never adds `broken` to those anchor tags.

  The fix is to exclude hidden pages' URLs from `allKnownUrls`, so any link targeting a hidden page falls through to the broken-link check.

  ## Done looks like
  - A link to a page with `hidden: true` in its frontmatter receives the `broken` class in the generated HTML
  - A link to a normal (non-hidden) page continues to receive only `internal` (and any other applicable classes)
  - Build output and existing behavior for all other link types is unchanged

  ## Out of scope
  - Changing what "hidden" means for indexing, embeds, or the content map
  - Any visual styling changes

  ## Tasks
  1. **Exclude hidden URLs from `allKnownUrls`** — When constructing the `allKnownUrls` set, filter out the `finalUrlPath` of any `fileInfo` where `hidden` is `true`, so that `classifyLinks` correctly marks those links as broken.

  ## Relevant files
  - `build.js:449-453`
  