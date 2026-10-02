# Press

The bespoke static site generator for [totascriptura.org](https://totascriptura.org). It turns the site's Obsidian vault into a static HTML site for GitHub Pages. The generator is `build.js`; the layout, CSS and fonts live in `template/`.

This reference was written from the code as of October 2026. It replaces the Replit-era `archive/replit.md`. Where the two disagree, this file is the correct one.

## Running

The content repo installs Press as a git dependency and runs its `press` command from the vault root:

```jsonc
// totascriptura.org/package.json
"scripts": { "build": "press" },
"devDependencies": { "press": "github:joeyday/press#v0.2.0" }
```

Commands (run from the vault root):
- `press` or `press build`: build the site (what CI runs).
- `press serve`: build, then serve the output at <http://localhost:4000/> until Ctrl-C. `serve.js` mimics GitHub Pages: `/foo/` serves `foo/index.html`, `/foo` redirects to `/foo/`, and unmatched URLs get `404.html` with a 404 status. It binds to localhost, the port is hardcoded, and it doesn't rebuild on changes.

For a local `press` command, run `npm link` once in the Press repo. During Press development you can also run `cd vault && node ../build.js` (see `CLAUDE.md`).

The vault scan, `abbreviations.json`, `alt-text.json` are resolved from the **working directory**. Output goes to `./dist`, or to the directory named by the `PRESS_OUT` environment variable if set. CI sets nothing; locally it keeps build output out of the iCloud-synced vault (for example `export PRESS_OUT="$HOME/Projects/press/out"` in `~/.zshrc`). The template is resolved from Press's own directory.

`dist/` is **not** cleaned before a build. Delete it yourself for a clean build. (See `docs/plan.md`.)

Dependencies: `gray-matter`, `markdown-it`, `markdown-it-footnote`, `markdown-it-mark`, `markdown-it-container`, `markdown-it-bracketed-spans`, `markdown-it-attrs`, `ejs`, `slugify`. The search page loads `minisearch@7` from jsDelivr at runtime.

## Inputs

`template/` (in Press) holds `layout.ejs` and the site's CSS, JS and fonts. Its assets are copied to `dist/asset/` along with the vault's.

The rest come from the vault:

| Path | Required | Purpose |
|---|---|---|
| `**/*.md` | | Pages. Skipped directories: `node_modules`, `dist`, `.git`, `.github`, `.local`, `template`, and any dot-prefixed directory. Files named `replit.md` are skipped too (case-insensitive). |
| `**/*.{png,jpg,jpeg,gif,svg,webp,avif,ico,bmp,css,js,eot,otf,ttf,woff,woff2}` | | Copied flat into `dist/asset/`. Only `build.js` is excluded, so any other `.js` file in the vault is copied too. If two files share a name (compared case-insensitively), the build warns and the last one copied wins. |
| `abbreviations.json` | no | `{ "term": "expansion" \| null }` |
| `alt-text.json` | no | `{ "image-basename.png": "alt text" }` |

## URLs

- **Slug**: the `permalink` frontmatter value (leading `/` stripped, otherwise used **verbatim**, not slugified), or else `slugify(filename, {lower, strict})`.
- **URL**: `/{relDir}/{slug}`. Folder names are used verbatim, keeping their case and spaces.
- **Notes pages**: a file in `notes/` (root) or `<folder>/notes/` is the notes page for the page of the same name in the parent folder. Its URL is the page's URL plus `/notes`: `topic/notes/Foo.md` is `/topic/foo/notes`, and the home page's notes are `/notes`. A `permalink` on a notes page is ignored. A notes page needs no page: with none, it still builds, at the URL the page would have, and its "Topic" link is greyed out. It is left out of the alphabetical index, the random pool and the Scripture index. Hide it with `hidden: true` like any page. So `/topic/foo` and `/topic/foo/notes` are reached from each other by adding or removing `/notes`.
- **Homepage**: a *root-level* file whose slug is `home` or `index` becomes `/`. In practice that means a file named `home.md`/`index.md` or `permalink: home`/`index`. (`permalink: ""` or `/` does **not** make a homepage: an empty permalink falls back to the slugified filename.)
- **404**: the URL `/404` is written to `dist/404.html` instead of `dist/404/index.html`.
- Each page is written to `dist/{url}/index.html`. An empty `dist/.nojekyll` is always written.

## Frontmatter

Keys are matched case-insensitively for every property below. The template, however, receives the raw `frontmatter` object. Only `title` and `permalink` are normalised into lowercase keys, and `title` only when no title key exists at all. So `Title: Foo` gives the page the title "Foo", but the template sees `frontmatter.title === undefined`.

| Key | Effect |
|---|---|
| `title` | Display title. Defaults to the filename without `.md`. |
| `permalink` | URL slug (see above). |
| `hidden` | No page is generated. Hidden pages are left out of every index, search, the random pool, backlinks, notes links and categories, and links to them get the `broken` class. *Their `aliases` still produce redirect stubs.* |
| `unlisted` | The page is built and links to it count as valid. It is left out of all index pages (including the Scripture index), search, the random pool, featured/featured-with, and category membership. It still takes part in notes links and backlinks. |
| `draft` | Listed on `/index/drafts`. Links to it get the `draft` class. |
| `featured` | Listed on `/index/featured`. Gets a star on the alphabetical indexes. Links to it get the `featured` class. |
| `featured with` | Value is a page name or `[[wikilink]]`. Shown as "(and …)" after the target on `/index/featured`. Gets a star on the alphabetical index. |
| `categories` | A string or list of page names/`[[wikilinks]]`, each naming a page in `category/`, by basename or as `category/Name` (case-insensitive). A page in `category/` is a category page. A category with no listed members is made `unlisted` automatically, which can empty its parent category in turn. A name with no matching page logs a warning and renders as a broken link. |
| `aliases` | A string or list. Each alias writes a meta-refresh redirect at `/{relDir}/{slugify(alias)}`, is listed on its namespace's alphabetical index as "Alias (see Title)", and works as a wikilink target. |

For all page-name values, `[[Page|Display]]` is reduced to `Page`.

## Link resolution

`resolveLink` is used for wikilinks and `featured with`:

1. If the target contains `/`, it is **path-qualified** and matches the file at exactly that path from the vault root, case-insensitively: `topic/Trinity`, `topic/notes/Trinity`. There is no suffix matching.
2. Otherwise the target is looked up in `fileMap`, which is keyed by the lowercased basename, the permalink, the alias name and the alias slug. A key also matches when its hyphens are read as spaces (`[[foo bar]]` finds the key `foo-bar`).
3. When several candidates match, notes pages are dropped unless nothing else matches. Then the candidate in the source page's own folder wins (a notes page counts as in its page's folder), then the one in `topic/`, then the one at the vault root. When a tiebreak decides, a warning asks you to qualify the link. If none applies, the result is ambiguous: a warning is logged and the link is rendered as a `broken` span.


## Per-page pipeline

For each non-hidden page, in order:

1. **Partials**: `{{name}}`, `{{[[name]]}}` and `{{name|arg1|arg2}}` are replaced by the body of `partial/name.md`. Only the `partial/` folder (flat, no subfolders) is consulted. The name is matched by basename, case-insensitively, with no path syntax, aliases or permalinks. Everything in `partial/` is a partial and never a page: no frontmatter is read from it (any that is present is stripped and ignored), it is not in the link maps, and it has no URL, alias redirects or backlinks. Inside the partial's text, `{{1}}`… are replaced by the arguments, unfilled ones become empty, `{{$args}}` becomes the arguments joined by `, `, and `{{$n}}` becomes the argument count. Partials are expanded recursively, and a circular partial is replaced by a comment with a warning. A `|` inside `[[…]]` does not split arguments. A bare numeric `{{3}}` anywhere becomes empty.
2. **Wikilinks**: `[[Target]]` and `[[Target|Text]]` become Markdown links, or `<span class="broken">` when unresolved. The link text is the raw inner text, not the target's title. A `.md` suffix is stripped. A leading `!` on a non-image wikilink is ignored. `#heading` fragments are not supported and produce a broken link.
   Image targets (by extension) are looked up in the asset map by **bare filename only**:
   - `[[img.png]]` becomes a link.
   - `![[img.png]]` becomes `<figure><img alt="img.png"></figure>`.
   - `![[img.png|Alt]]` sets the alt text.
   - `![[img.png|300]]` and `|300x150` set the dimensions.
3. **EJS**: the whole page body is rendered as an EJS template with `frontmatter`, `fileMap` and `imageMap`. If rendering fails, the body is replaced with an HTML comment and a warning is logged.
4. **Comments**: `%%…%%` is stripped.
5. **Small text**: `~text~` becomes `<small>`.
6. **Fenced-div attribute protection**: `::: {…}` attributes are protected from `markdown-it-attrs`.
7. **markdown-it**: rendered with `html`, `linkify`, `typographer`, footnotes, `==mark==`, `~~strike~~`, tables, bracketed spans `[text]{.cls}`, generic attributes `{.cls #id k=v}`, and containers. Every `:::` fence becomes a `<div>`. `::: a b` produces `class="a b"`, and `:::{.a .b #id k=v}` sets the full attribute set.
8. **Layout**: `template/layout.ejs` is rendered, then **link classification** runs on the whole page:
   - `http(s)` links get `external`. Everything else gets `internal`.
   - Absolute paths (`/…`) can also get `draft`, `category`, `aside`, `featured` and `broken`. A path is `broken` when it is not a known URL and not under `/index/`.
   - Only double-quoted `href`s are classified.

Steps 1–6 are plain regex passes over the raw Markdown. They also apply inside code spans and code blocks.

### Layout template variables

`frontmatter`, `bodyClasses`, `content`, `nsLabel`, `isNote`, `notePage`, `noteUrl`, `categories`, `subcategories`, `pages`, `featured`, `featuredWith`, `backlinkUrl` and `backlinkCount`.

- `bodyClasses`: the URL's path segments, or `["home"]` for `/`.
- `nsLabel`: the page's folder name, capitalised, plus " page" (`Topic page`, `Commentary page`), or `Meta page` for root pages and generated pages. A notes page uses its page's folder.
- `isNote`: true for a notes page. `notePage` is `{url}` of its page (null when the page doesn't exist or is hidden). `noteUrl` is a page's notes URL, or null.
- `categories`, `subcategories`, `pages`: arrays of `{title,url}`. `subcategories` holds members that are category pages, and `pages` holds the rest.
- `featured`: true only for `featured: true`.
- `featuredWith`: the raw page-name string, or null.
- `backlinkUrl`: null on generated pages (indexes, search, random, backlinks pages).

## Generated pages

- **Backlinks**: `/{url}/backlinks` (or `/backlinks` for `/`) for every non-hidden page. Sources are all non-hidden pages whose wikilinks resolve to the page. This is counted on partial-expanded Markdown, *before* comment stripping or EJS. It counts self-links and links inside `%%comments%%`.
- **Alias redirects**: written after the pages, with no collision check.
- **Indexes**:
  - `/index/alphabetical/{namespace}`: one list per namespace, for `topic`, `category`, `commentary`, `summary` and `meta` (the root). Each lists that folder's pages that are not hidden, unlisted or notes pages, plus their aliases. A namespace with nothing listed has no page and no menu entry. Each list starts with a menu linking to the other namespaces' lists. `/index/alphabetical` is a stub that redirects to the Topic list.
  - `/index/categorical`: a flat list of top-level category pages only: category pages that are not hidden, not unlisted (so not empty) and not themselves in a category.
  - `/index/featured`
  - `/index/drafts`

  All lists are sorted ignoring a leading "A/An/The" and ignoring case.
- **Search**: `/search`, plus `dist/search.js` and `dist/search-index.json`. The index holds `{id,title,url,body}` for non-hidden, non-unlisted pages, with the body limited to the first 5000 characters of tag-stripped text. Searches use MiniSearch with prefix matching, fuzzy 0.2 and a 2× title boost. The `?q=` parameter stays in sync with the search box.
- **Random**: `/random` redirects on the client to a random page from the alphabetical-index pool, minus the `category` namespace. Its body (a Proverbs 16:33 quotation) is hardcoded.
- **Scripture index**: `/index/scripture` lists the referenced books. `/index/scripture/{book-slug}` is a `<dl>` with one `<dt>` per unique reference, which links to each page or section where that reference appears. References come from content pages that are not unlisted, category pages or asides.

## Post-processing (every `.html` under `dist/`, in order)

1. **Heading IDs**: every `<h2>`/`<h3>` without an `id` gets one, using slugified text and `-2`, `-3`… for duplicates. Existing IDs are kept and reserved first.
2. **Scripture collection and index generation**: see above. The index pages then get heading IDs and go through the remaining passes.
3. **Bible reference linker**: turns references into `<a class="external bible-ref" href="https://ref.ly/{Abbr}{ch}[.{v}[-{v2}|-{ch2}.{v2}]|-{ch2}];{TRANS}">`.
   - Books are matched by full name or abbreviation, **case-insensitively**. The abbreviations come from the last entry of each book's `names` list in `BIBLE_BOOKS`.
   - Formats: `Book ch`, `Book ch–ch`, `Book ch:v`, `Book ch:v–v`, `Book ch:v–ch:v`.
   - Continuations: after `;` or `,` with only whitespace in between, `ch:v` or a bare `v` carries the current book and chapter forward.
   - Translation: the first `ESV|KJV|NASB|NIV|NKJV|NLT|NRSV` after a reference, up to the next named reference in the same text node, applies to the whole group. ESV is the default. A translation directly after `</a>` is moved inside the link.
   - A reference prefixed with `!` is not linked.
   - Skipped inside `a`, `code`, `pre`, `script`, `style` and `h1`–`h6`. Context resets at block tags.
   - In the link text, spaces become non-breaking spaces and range dashes become en-dashes.
4. **Abbreviations**: each `abbreviations.json` key becomes `<abbr title="…">`, or a plain `<abbr>` when the value is null. Matching is case-sensitive and longest-first. There is always a leading `\b`, and a trailing `\b` only when the key ends in a word character. Skipped inside `abbr`, `code`, `pre`, `script`, `style`. Anchors are *not* skipped.
5. **Initials**: two or more consecutive `X.` (for example `C.S.`) become `<abbr>`. Same skip list as abbreviations.
6. **Roman numerals**: valid uppercase numerals of two or more letters, and dotted pairs like `X.III`, become `<span class="roman-num">`. Same skip list.
7. **Divine names**: `LORD`, `GOD`, `YHWH`, `I AM` (+ ` THAT/WHAT/WHO I AM`) and `I WILL BE` (+ the same suffixes) become `<span class="divine-name" data-name="…">`. In each, the letters `G`, `L` and a standalone `I` are wrapped in `<span class="divine-name-initial">`, so `YHWH` gets no initial span. Same skip list.
8. **Spaced ellipses**: `. . .` becomes `.&nbsp;.&nbsp;.` (with a leading `&nbsp;` when preceded by whitespace). This applies everywhere in the file, with no skip list.
9. **Alt text**: an `<img>` whose `src` basename is a key in `alt-text.json` gets its `alt` set or replaced. Matching is case-sensitive.

These passes run over the **entire** HTML file, including `<head>`. Text inside `<title>` is not skipped.
