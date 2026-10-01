# Scripture Passage Index

## What & Why
Build a set of auto-generated Scripture index pages. Because the site has thousands of Bible references, the index is split by book: a root page at `/index/scripture` lists every referenced book in canonical order, and each book links to its own page (e.g. `/index/scripture/romans`) showing all references within that book with deep links to the exact section of the page where each appears.

The root page is conceptually a sibling of the existing alphabetical, categorical, featured, and drafts index pages.

## Done looks like
- `/index/scripture` is a built HTML page listing only books that have at least one reference anywhere on the site, in canonical order (Genesis → Revelation), each as a link to `/index/scripture/{book-slug}`.
- `/index/scripture/{book-slug}` exists for every referenced book and contains a single flat list of all references to passages in that book, in canonical order (chapter, then verse, then range end). No chapter headings or grouping — just one `<ul>` of entries.
- Each unique reference is its own entry (e.g. "3:16" and "3:16–17" are separate entries; "3" as a chapter-only reference is also its own entry). Entries are sorted so chapter-only references appear before verse-level references within the same chapter.
- Each entry links to the specific page section where the reference appears. If the same reference appears in multiple sections on one page, each section gets a separate link. Multiple occurrences of the same reference within the same section collapse to a single link for that section.
- Section links use the form `pageUrl#headingId` and display as `Page Title (§Section Heading)`. If a reference appears before any h2/h3 on its page, the link goes to the page root with no fragment and no section annotation.
- References from unlisted pages are not included.
- The root `/index/scripture` page is listed alongside the other index pages in the dev site navigation (`template/layout.ejs`).
- All scripture index pages (root and per-book) go through all post-processing passes so ref.ly links appear within them.
- `/index/scripture` and all `/index/scripture/{book-slug}` URLs are added to `allKnownUrls`.

## Out of scope
- References from hidden pages.
- Tracking which translation was cited.
- Expanding verse ranges into per-verse entries.
- Any change to how the Bible ref linker itself operates.
- Chapter grouping or subheadings within per-book pages.

## Tasks

1. **Build a `distFilePath → {url, title, unlisted}` registry during the main build** — After writing each content page HTML file, record its output file path alongside its URL, title, and unlisted flag. Auto-generated pages (index pages, search, random) are excluded from this registry so the collection pass naturally skips them.

2. **Add a Bible ref collection pass** — New post-processing function that runs after heading IDs are added (Task #15) and before the Bible ref linker. For each non-unlisted content page, traverse the HTML tag-by-tag tracking the current h2/h3 section (id and text content). Apply BIBLE_REF_RE and continuation-ref logic (with the same BLOCK_TAGS reset and SKIP_TAGS exclusion) to text nodes to find all Bible refs. For each ref found, record: `{ bookIndex, bookName, chapterNum, verseStart, rangeVal, endVerse, displayShort, pageUrl, pageTitle, sectionId, sectionTitle }`. `displayShort` is the canonical short form derived from parsed components (e.g. "3:16", "3:16–17", "3"). `bookIndex` is the BIBLE_BOOKS array position for canonical sorting. `bookName` is the full canonical book name for display.

3. **Generate the root Scripture index page** — Group collected refs by book (deduplicated to just a list of books that have any refs). Sort by `bookIndex`. Build an HTML `<ul>` of links to `/index/scripture/{book-slug}`. Write to `dist/index/scripture/index.html` using `renderLayout()` with `frontmatter: { title: "Scripture index", permalink: "scripture" }`.

4. **Generate per-book Scripture index pages** — For each referenced book, sort its refs by `(chapterNum, verseStart ?? -1, rangeVal ?? '', endVerse ?? '')` and render as a single flat `<ul>`. Deduplicate: same ref on same page+section → one link. Build HTML and write to `dist/index/scripture/{book-slug}/index.html` using `renderLayout()`.

5. **Post-process all Scripture index pages** — Run all post-processing passes (heading IDs, Bible ref linker, abbreviation expander, Roman numeral wrapper, divine name wrapper) on all newly written Scripture index files (root + all per-book pages).

6. **Wire navigation and known URLs** — Add `/index/scripture` and all `/index/scripture/{book-slug}` URLs to `allKnownUrls`. Update `template/layout.ejs` to include a link to `/index/scripture` in the header nav alongside the other index pages.

## Architectural notes
- The collection pass reads raw content-page HTML before the Bible ref linker runs, so refs are still plain text — use BIBLE_REF_RE directly on text nodes.
- `BIBLE_REF_RE`, `CONT_REF_RE`, `BIBLE_BOOKS`, `SKIP_TAGS`, and `BLOCK_TAGS` are all module-scope in `build.js`; reuse them.
- Continuation-ref context state (`{ lastCwms, lastChapter }`) must reset at BLOCK_TAGS boundaries, same as the existing linker.
- Book slugs for per-book URLs: slugify the full book name (e.g. "1 Corinthians" → "1-corinthians", "Song of Solomon" → "song-of-solomon").
- The `displayShort` for chapter-only refs is just the chapter number as a string (e.g. "3"); for verse refs it is "chapter:verse" or "chapter:verse–endVerse".

## Relevant files
- `build.js:1-84` (BIBLE_BOOKS — canonical order and full names)
- `build.js:120-123` (BIBLE_REF_RE)
- `build.js:200-202` (CONT_REF_RE)
- `build.js:322-355` (SKIP_TAGS, BLOCK_TAGS)
- `build.js:358-426` (linkBibleRefs — model for collection pass traversal)
- `build.js:897-912` (getOutputPaths)
- `build.js:1559-1589` (main build loop — add registry population here)
- `build.js:1636-1685` (existing index page generation loop)
- `build.js:1788-1846` (post-processing section — insert new passes here)
- `template/layout.ejs`
