# Backlinks Pages

## What & Why

Every content page on the site gets a `/pageurl/backlinks` sub-page listing all
other pages that contain a wikilink pointing to it.  This lets readers
discover related material and mirrors the backlinks panel familiar from
Obsidian.  For example, `/topic/monotheism/backlinks` shows every page whose
Markdown source contained `[[Monotheism]]` or any wikilink that resolves to
that page.

## Done looks like

- A URL like `/topic/monotheism/backlinks` exists and renders a page titled
  "Backlinks — Monotheism" with a bulleted list of every page that links to it.
- The list items are internal links sorted alphabetically by page title.
- If no pages link to a given page, the backlinks page says "No pages link to
  this page."
- The homepage at `/` has its backlinks page at `/backlinks`.
- Backlinks pages are not listed in any index, are excluded from search, and
  are not in the random-page pool.
- Every regular content page in the layout has a link to its own backlinks
  sub-page (e.g. "Backlinks (3)") so readers can find it.
- The build log reports how many backlinks pages were written.

## Out of scope

- Tracking raw Markdown links or external links as backlinks — only wikilinks
  (`[[...]]`) are counted.
- Showing a preview/excerpt of the linking context (just the page title and
  link, no surrounding text).
- Listing backlinks pages in the alphabetical/categorical/featured/drafts
  indexes.
- Including backlinks pages in the site search index.

## Steps

1. **Collect outgoing wikilinks during the main build loop** — In the existing
   wikilink replacement loop (where `resolveLink` is called), whenever a
   wikilink resolves to a URL, record the (source page URL → target URL)
   relationship in a `Map<sourceUrl, Set<targetUrl>>`.

2. **Invert to a backlinks map** — After the main loop completes, transform the
   outgoing map into `backlinksMap: { targetUrl → [{title, url}] }` sorted
   alphabetically by title.  Only non-hidden source pages contribute.

3. **Register backlinks URLs as known** — Before the main rendering loop (where
   `allKnownUrls` is constructed), add every expected backlinks URL to
   `allKnownUrls` so that any layout link pointing to them is not classified as
   broken.  Formula: page URL `/` → backlinks URL `/backlinks`; all others
   → `${pageUrl}/backlinks`.

4. **Add `backlinkUrl` to `renderLayout`** — Pass the backlinks page URL as a
   new `backlinkUrl` local to every `renderLayout` call (and to the EJS
   template variable list).  For non-content pages (indexes, search, random)
   pass `null`.

5. **Update `template/layout.ejs`** — In the `<footer>` (or below `<main>`),
   render a link to `backlinkUrl` when it is non-null, showing the count if
   backlinks exist: `"Backlinks (3)"` or `"Backlinks (0)"`.

6. **Generate the backlinks sub-pages** — After the alias redirect loop, add a
   new loop over all non-hidden `filesToProcess` entries.  For each page,
   build an HTML `<ul>` from `backlinksMap[pageUrl]` (or a "no pages link here"
   message), render with `renderLayout` using the backlinks URL and a title of
   `"Backlinks — {pageTitle}"`, and write `index.html` to the appropriate
   output path.  Log a summary line with the total count written.

## Relevant files

- `build.js:1900-1930` — `allKnownUrls` construction (add backlinks URLs here)
- `build.js:1967-1985` — `renderLayout` function (add `backlinkUrl` param)
- `build.js:2019-2077` — main wikilink replacement loop (collect outgoing links)
- `build.js:2156-2181` — page write section (already has `getOutputPaths`)
- `build.js:2183-2200` — alias redirect loop (insert backlinks loop after this)
- `template/layout.ejs`
