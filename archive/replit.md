# Static Site Generator

A custom, lightweight static site generator built with Node.js, designed to run in GitHub Actions and deploy to GitHub Pages. Processes Markdown files from an Obsidian-style vault into static HTML using EJS templating.

## Features

- **Markdown Parsing**: Uses `markdown-it` with plugins for footnotes (`markdown-it-footnote`), highlights (`markdown-it-mark`), fenced containers (`markdown-it-container`), bracketed spans (`markdown-it-bracketed-spans`), and generic attributes (`markdown-it-attrs`). Strikethrough and tables are enabled via built-in markdown-it rules. `linkify: true` means bare URLs in text are auto-linked. `typographer: true` enables smart quotes, `---` → em-dash, `--` → en-dash, and related typography transforms.
- **Frontmatter**: Uses `gray-matter` to extract YAML frontmatter. All key lookups are case-insensitive.
- **Templating**: Uses `ejs` for the HTML layout template (`template/layout.ejs`).
- **Permalinks**: Uses the `permalink` frontmatter property, or slugifies the filename via `slugify` if absent.
- **Recursive Directory Scanning**: Processes every `.md` file in the entire repo, skipping `node_modules`, `dist`, `.git`, `.github`, `.local`, `template`, and any dot-prefixed directories. `replit.md` is also explicitly excluded regardless of location.
- **Homepage Resolution**: A root-level file becomes the homepage (`/`) in two ways: (a) it is named `home.md` or `index.md`, or (b) its `permalink` frontmatter is set to `home` or `index`, or is empty.
- **Wikilinks**: Converts `[[Page Name]]` and `[[Page Name|Custom Text]]` into HTML links. Case-insensitive, `.md` suffix stripped. Image wikilinks: `[[image.png]]` → `<a>` tag (Markdown link, resolved by markdown-it); `![[image.png]]` → `<figure><img …></figure>` with optional dimensions (`![[image.png|300]]` sets width; `![[image.png|300x150]]` sets width and height). Path-qualified targets (`[[folder/Page]]`) disambiguate files that share a basename across folders; an unqualified target that matches multiple files produces a `broken`-classed span and a build warning.
- **Embed System**: Any `.md` file can be embedded inside another using `{{name}}` or `{{name|arg1|arg2}}` syntax. `{{[[name]]}}` (with brackets) also works. Resolved as the very first step in the pipeline, before wikilinks or EJS. Positional args substitute as `{{1}}`, `{{2}}`, etc.; unfilled placeholders become empty string. Special variables: `{{$args}}` → all args joined by `, `; `{{$n}}` → integer count of args (baked in before EJS, enabling conditionals). Embeds nest recursively; circular references emit a warning and an HTML comment placeholder. Args may themselves be wikilinks with display text (e.g. `{{[[mt]]|[[topic/Trinity|Trinity]]}}`); pipes inside `[[...]]` are never treated as argument separators.
- **Asset Handling**: Scans for assets anywhere in the repo (including `template/`) and copies them flat to `dist/asset/`. Handled extensions: images (png, jpg, jpeg, gif, svg, webp, avif, ico, bmp), CSS, JavaScript (`.js`), and fonts (eot, otf, ttf, woff, woff2). `build.js` itself is excluded. Filename collisions produce a build warning; the last file encountered wins.
- **Hidden Pages**: `hidden: true` frontmatter — content is available for embedding via `contentMap`, but no standalone page is generated and the page is excluded from all indexes and search.
- **Unlisted Pages**: `unlisted: true` frontmatter — a standalone page is built and the URL is a valid link target, but the page is excluded from all four indexes, from search, and from the random-page pool. Useful for utility pages (e.g. Colophon) that should be reachable but not surfaced in navigation.
- **Aside Relationships**: `aside of` frontmatter links a page as an aside of another. The subject page receives an `asides` array in the template.
- **Categories**: `categories` frontmatter (YAML list) assigns pages to category pages. Category pages receive `subcategories` (members that themselves have members) and `pages` (leaf members) arrays in the template. Unlisted and hidden pages are excluded from category-index navigation.
- **Featured Pages**: `featured: true` frontmatter marks a page as featured; appears in the featured index and gets a star (★) in the alphabetical index.
- **Featured With**: `featured with: [[Page Name]]` frontmatter groups a secondary page alongside a primary featured page in the featured index. The secondary also gets a star in the alphabetical index.
- **Draft Pages**: `draft: true` frontmatter marks a page for inclusion in the drafts index.
- **Redirects**: `aliases` frontmatter (string or YAML list) generates a meta-refresh redirect page for each alias name, placed in the same folder as the canonical page.
- **Obsidian Flavored Markdown**: Supports `%%comments%%` (stripped), `~~strikethrough~~`, `==highlights==`, `~small text~` (→ `<small>`), and tables.
- **Fenced Containers**: `::: classname` / `:::` syntax → `<div class="classname">`. Pandoc-style `:::{.class1 .class2 #id key=value}` for multiple classes, IDs, and custom attributes. Bare `:::` creates a classless div. Markdown fully parsed inside.
- **Bracketed Spans**: `[text]{.class}` → `<span class="class">text</span>`. Supports classes, IDs, and arbitrary attributes: `[text]{.warning #notice data-type=alert}`.
- **Generic Attributes**: `{.class #id key=value}` syntax after any block element (headings, paragraphs, lists, etc.) via `markdown-it-attrs`.
- **Footnotes**: `[^ref]` / `[^ref]: definition` syntax via `markdown-it-footnote`.
- **Default Title**: If `title` frontmatter is absent, defaults to the filename.
- **Backlinks Pages**: Every non-hidden page automatically gets a `/pageurl/backlinks` sub-page listing all other pages that contain a wikilink pointing to it. Counting and linking is done via a pre-pass before main rendering so each page's footer can show "Backlinks (N)". The homepage (`/`) gets its backlinks at `/backlinks`. Backlinks pages are excluded from all indexes, search, and the random pool.
- **Auto-generated Index Pages**: Four index pages built automatically:
  - `/index/alphabetical` — all non-hidden, non-unlisted, non-aside, non-category pages; star (★) marks featured/featured-with pages; alias names appear as redirect stubs (`aliasName (see CanonicalTitle)`)
  - `/index/categorical` — pages grouped under their category pages
  - `/index/featured` — featured pages with their featured-with secondaries grouped beneath them
  - `/index/drafts` — pages with `draft: true`
- **Random Page** (`/random`): Client-side redirect to a randomly selected content page. The pool is all non-hidden, non-unlisted, non-category, non-aside pages. URLs are inlined as a JSON array; `window.location.replace()` fires immediately. Falls back to a link to the alphabetical index when JavaScript is unavailable.
- **Full-Text Search**: At build time, `search-index.json` is generated from all non-hidden, non-unlisted pages. Body text is stripped of HTML tags and capped at 5000 characters per page. A `/search` page loads MiniSearch from CDN and provides live prefix/fuzzy search (title boosted 2×). Every page has a search form in the footer; the header nav includes a Search link.
- **Link Classification**: All anchor tags receive CSS classes: `internal`, `external`, `draft`, `category`, `aside`, `featured`, `broken` (classes stack). Links to hidden pages are marked `broken`; links to unlisted pages are treated as normal valid links. Links to any `/index/*` path are never marked `broken` regardless of whether they resolve to a built file.
- **404 Page**: `404.md` at the vault root is built to `dist/404.html` (not `dist/404/index.html`), which is the path GitHub Pages serves for unmatched URLs. Give it `unlisted: true` to keep it out of indexes.
- **.nojekyll**: An empty `.nojekyll` file is written to `dist/` on every build.

## Processing Pipeline

### Inline (per page, before HTML is written)

1. **Resolve embeds** — `resolveEmbeds()` recursively splices embedded file content into the source
2. **Transform wikilinks** — `[[...]]` converted to Markdown links or `<img>` tags
3. **Render EJS** — evaluates EJS expressions in the combined source; wrapped in try/catch (failure emits an HTML comment and continues). Variables available: `frontmatter` (page data), `contentMap` (name→raw Markdown), `fileMap` (name→URL array), `imageMap` (filename→asset URL)
4. **Strip Obsidian comments** — `%%...%%` removed
5. **Transform `~small~`** — converted to `<small>` tags
6. **Protect fenced-div attributes** — `{...}` attribute blocks on `:::` divs are shielded from `markdown-it-attrs` consumption
7. **markdown-it render** — Markdown converted to HTML with all plugins active

### Post-processing (run over every HTML file in `dist/`)

8. **Bible ref linker** — detects scripture references and wraps them in `ref.ly` links (see Bible Ref Linker section)
9. **Abbreviation expander** — wraps terms from `abbreviations.json` in `<abbr>` tags
10. **Initials wrapper** — wraps patterns like `D.A.`, `J.R.R.` in `<abbr>` (no title)
11. **Roman numeral wrapper** — wraps valid Roman numerals in `<span class="roman-num">`
12. **Divine name wrapper** — wraps `LORD`, `GOD`, `YHWH` in `<span class="divine-name" data-name="…">`
13. **Ellipsis normaliser** — converts spaced ellipses (`. . .`) to `&nbsp;`-separated form
14. **Alt text injector** — adds or replaces `alt` attributes on `<img>` tags from `alt-text.json`

## Bible Ref Linker

Runs as post-processing pass 8. Detects scripture references in rendered HTML and converts them to `ref.ly` hyperlinks with class `external bible-ref`.

- **Book names and abbreviations**: All 66 canonical books recognised by full name and standard abbreviations (e.g. `Ge`, `Mt`, `1Co`, `Rev`). Flexible whitespace: `1 Co` matches the `1Co` abbreviation.
- **Reference formats**: `Book chapter`, `Book chapter:verse`, `Book chapter:verse-endVerse` (same-chapter range), `Book chapter:verse-endChapter:endVerse` (cross-chapter range). Range separators may be a hyphen, en-dash (–), or em-dash (—); all are normalised to en-dash in the link text.
- **Continuation refs**: After a named ref, bare continuations separated by `;` or `,` inherit the book and chapter — e.g. `Ro 3:30; Gal 3:20` links both, and `Ro 3:23, 26` links both verses. Strict chaining: any non-whitespace between the current position and the next separator breaks the chain, preventing timestamps and other numbers from being picked up as verse numbers.
- **Translation suffixes**: `ESV`, `KJV`, `NASB`, `NIV`, `NKJV`, `NLT`, `NRSV`. When one of these follows the last ref in a citation group, all refs in that group link to that translation instead of the default (ESV). The abbreviation is moved inside the preceding `</a>` tag.
- **Opt-out**: Prefix any reference with `!` (e.g. `!Ge 1:1`) to suppress linking for that ref.
- **Skipped contexts**: Text inside `<a>`, `<code>`, `<pre>`, `<script>`, `<style>`, or any heading (`<h1>`–`<h6>`) is never linked.
- **URL format**: `https://ref.ly/{CWMSabbr}{chapter}[.{verse}[-{range}]];{translation}`

## Abbreviation Expander

Runs as post-processing pass 9. Reads `abbreviations.json` — a flat JSON object where keys are the literal strings to match and values are the expansion text.

- String value → `<abbr title="expansion">term</abbr>`
- `null` value → `<abbr>term</abbr>` (term is semantically abbreviation-like but has no expansion to show)
- Missing key → no wrapping
- Matching is case-sensitive and word-boundary anchored. Keys are processed longest-first to prevent prefix collisions.
- Skipped contexts: `<abbr>`, `<code>`, `<pre>`, `<script>`, `<style>`.

## Roman Numeral Wrapper

Runs as post-processing pass 10. Wraps valid uppercase Roman numerals in `<span class="roman-num">`.

- Standalone numerals must be ≥ 2 characters (prevents bare `I`, `V`, `X` from matching).
- Dotted pairs (`X.III`, `I.I`, `XIV.II`) are matched as a unit (the dotted branch wins the longer match).
- Skipped contexts: `<abbr>`, `<code>`, `<pre>`, `<script>`, `<style>`.

## Divine Name Wrapper

Runs as post-processing pass 11. Wraps `LORD`, `GOD`, and `YHWH` (all-caps, whole-word matches). Output structure:

```html
<span class="divine-name" data-name="LORD"><span class="divine-name-initial">L</span>ORD</span>
```

The first letter is isolated in `.divine-name-initial` so it can be styled independently of the remaining letters (e.g. full-size capital alongside `font-variant: all-small-caps` on the rest). Text is kept uppercase throughout.

- Skipped contexts: `<abbr>`, `<code>`, `<pre>`, `<script>`, `<style>`.

## Alt Text Injector

Runs as post-processing pass 14. Reads `alt-text.json` — a flat JSON object where keys are image filenames and values are the desired `alt` attribute text.

- Matching is by **filename only** (the last path segment of the `src` attribute, query string stripped). The full path in the HTML does not need to match; only the basename does.
- If the `<img>` tag already has an `alt` attribute, its value is **replaced** with the configured text.
- If the `<img>` tag has no `alt` attribute, the configured text is **added** before the closing `>`.
- Double-quote characters in values are automatically escaped as `&quot;`.
- Matching is case-sensitive.

Example `alt-text.json`:

```json
{
  "author-photo.jpg": "Portrait of the author",
  "example-diagram.png": "Diagram illustrating the example concept"
}
```

## Frontmatter Properties

| Property | Type | Description |
|---|---|---|
| `title` | string | Page title. Defaults to filename if absent. |
| `permalink` | string | Custom URL slug. Defaults to slugified filename. |
| `featured` | boolean | Marks page for the featured index; star shown in alphabetical index. |
| `featured with` | string | Groups this page under a primary featured page (value: page name, optional `[[brackets]]` or `[[Page\|Display Text]]` — display text is ignored). Star shown in alphabetical index. |
| `draft` | boolean | Marks page for the drafts index. |
| `aside of` | string | Links page as an aside of another page (value: filename, optional `[[brackets]]` or `[[Page\|Display Text]]` — display text is ignored). |
| `categories` | list | YAML list of category page names (optional `[[brackets]]` or `[[Page\|Display Text]]` — display text is ignored). |
| `aliases` | string or list | One or more alternate names; generates a meta-refresh redirect page for each. |
| `hidden` | boolean | Excludes page from all indexes; no standalone page built. Content still available for embedding. |
| `unlisted` | boolean | Standalone page is built and URL is valid, but page is excluded from all indexes, search, and the random-page pool. |

## Template Variables (available in `template/layout.ejs`)

| Variable | Type | Description |
|---|---|---|
| `frontmatter` | object | All YAML frontmatter data for the page |
| `content` | string | Rendered HTML content |
| `asideOf` | object \| null | `{title, url}` of the subject page, or `null` |
| `isAside` | boolean | `true` if this page has an `aside of` value |
| `asides` | array | `[{title, url}]` — asides whose `aside of` points to this page |
| `categories` | array | `[{title, url}]` — category pages this page belongs to |
| `subcategories` | array | `[{title, url}]` — category members that themselves have members |
| `pages` | array | `[{title, url}]` — leaf-page members of this category |
| `featured` | boolean | `true` only when the page has `featured: true` in frontmatter; pages with only `featured with` receive `false` |
| `featuredWith` | string \| null | Page name (wikilink brackets stripped) from `featured with` frontmatter, or `null`. This is the raw name string, not a resolved URL. |
| `backlinkUrl` | string \| null | URL of this page's backlinks sub-page (e.g. `/topic/monotheism/backlinks`), or `null` for index/utility pages. |
| `backlinkCount` | number | Number of pages that contain a wikilink pointing to this page (computed in the backlinks pre-pass). |

## Key Files

- `build.js` — Main build script
- `template/layout.ejs` — HTML layout template
- `partials/` — Embeddable `.md` snippet files
- `abbreviations.json` — Flat JSON object mapping terms to expansions (string or null)
- `alt-text.json` — Flat JSON object mapping image filenames to alt text strings
- `.github/workflows/deploy.yml` — GitHub Actions deployment config
- `package.json` — Node dependencies
- `dist/search-index.json` — Build-generated search index (`[{id, title, url, body}]`)
- `dist/search.js` — Build-generated client-side search script

## Scripts

- `node build.js` — Builds the static site into `dist/`
