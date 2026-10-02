# Plan

Living roadmap for Press. Update it as work lands; delete finished items rather than ticking them.

## 0. Finish the split: Press as a git-installed CLI (DONE 2026-10-01)

The content repo is `joeyday/totascriptura.org`. Both repos are public, so no CI token is needed. The content repo depends on Press as a git dependency. The lockfile pins the exact Press commit, so work on Press can't reach the live site until the content repo deliberately bumps it.

**Press (done in v0.1.0):**
- Added `bin`, a shebang, `files`, `engines` and `private: true`.
- `template/` moved here and is resolved from `import.meta.url`. The dead `embed.ejs` was dropped.
- Verified by installing the packed tarball into a copy of the vault and running `npm run build`: the output was identical to the baseline.

**Content repo (done in `fdc471e`; deployed successfully, live pages match the baseline):**
- Replace the nine dependencies with `"press": "github:joeyday/press#v0.1.0"` (pinned to a tag) and add `"build": "press"`.
- Regenerate the lockfile.
- Delete `build.js`, and `template/` if it moved.
- Have `deploy.yml` run `npm ci && npm run build`, and bump Node 20 to 22, since 20 is end-of-life.
- To bump Press later, change the tag and regenerate the lockfile (see `CLAUDE.md` → Releasing).

**Added after v0.1.0:** the `PRESS_OUT` environment variable (output directory; default `dist`). Not yet released or tagged, and CI doesn't need it. `press serve` (a local preview server, `serve.js`) was added too. Planned next: possibly an incremental rebuild / watch mode, because Joey now expects to run builds locally.

## 1. Short-term goals (set 2026-10-01)

Press is a bespoke, single-site tool. There are three goals: **(a)** split `build.js` into modules, **(b)** make the build much faster (aim for about half the current time), and **(c)** hardcode folder roles and other decisions that are currently generic.

### Safety net (in place 2026-10-01)
- `vault/` is a copy of the real vault: 318 `.md` files, 222 built pages, 616 output files.
- `baseline/dist` is the original script's output.
- `scripts/compare-dist.mjs` checks a new build against it. The build is deterministic apart from the layout's `Date.now()` cache-busters, which the script normalises.

Every refactor step must leave `dist/` **byte-identical**. Bug fixes and hardcoding changes that alter output go in separate commits, and each one's diff is reviewed on its own.

Refresh `vault/` with:
```sh
rsync -a --delete --exclude='.git/' --exclude='.obsidian/' --exclude='.trash/' --exclude='.github/' \
  --exclude='.DS_Store' --exclude='node_modules/' --exclude='dist/' \
  --exclude='/build.js' --exclude='/package.json' --exclude='/package-lock.json' \
  "$HOME/Documents/Obsidian/Tota Scriptura/" vault/
```

### Baseline timing (M-series Mac, Node 22, 2026-10-01)
A clean build takes **~0.97 s** (5 runs: 0.957–1.002 s).

`--cpu-prof` breakdown of the ~950 ms:
- **312 ms idle**: waiting on strictly sequential file I/O.
- ~68 ms "(program)".
- ~90 ms in buffer/file-handle reads, opens and writes.
- ~70+ ms in EJS compilation, because the layout is recompiled for every page.
- The post-pass transforms take 10–17 ms each: initials, abbreviations, Roman numerals, divine names, Bible refs.
- ~21 ms in GC.

Node startup and module load are a fixed ~50 ms floor. Halving the total looks realistic, because I/O and EJS alone account for roughly half.

### Why (a) and (b) aren't really at odds
The features are already mostly pure `html → html` / `text → text` functions. What's slow is not the features but the **orchestration**. Each post-pass reads every file from disk, rewrites it, and writes it back: about 9 read/write round trips per page. The fix is to put each feature in its own module, exposing a pure per-page function, and have one orchestrator own the loop. Each page then flows through every stage in memory and is written once. With more modules, the corpus gets *fewer* passes, not more.

### Speed candidates
These need measurement before we commit to them.
- **In-memory post-processing, written once.** Removes about 9 reads and up to 9 writes per page, plus the re-read for Scripture collection. This is probably the biggest win.
- **Compile `layout.ejs` once.** Today `ejs.render` recompiles it for every page, backlinks page and index.
- **Skip body EJS when the source has no `<%`.** Better still, drop body EJS entirely if the only user is a partial.
- **Expand partials and resolve wikilinks once per page.** The backlinks pre-pass currently repeats that work for the main render. Record outgoing links during the single pass.
- **Remove O(n) scans in link resolution.** That's the `resolveFileMapKey` key scan, the path-qualified filter, and the root tiebreaker's `.some`. Precomputed maps or hardcoded folders can replace them.
- **Bible refs: skip text nodes that contain no digit.** Also share one parse between the linker and the collector, and fix the case-insensitive matching (`gi`) while we're there. The huge alternation regex currently runs twice per text node.
- **Compile the abbreviation regex once** instead of once per file.
- **Parallel I/O** for reading sources, copying assets and writing output, instead of strictly sequential `await`s. Replace `ensureDir`'s access+mkdir with `mkdir({recursive})`.
- **Possibly a single tokenizer walk shared by all text transforms.** Only worth doing if profiling says so, because ordering dependencies (abbr → roman/divine skip) make fusing harder.

### Proposed module layout (draft)
```
build.js                orchestrator: load → model → resolve → render+post → generated pages
lib/vault.js            fixed folders → page records (frontmatter, urls)
lib/links.js            link resolution, wikilinks
lib/partials.js
lib/markdown.js         markdown-it setup, %%, ~small~, fenced attrs
lib/model.js            aliases, asides, categories, featured, backlinks
lib/layout.js           compiled layout, classifyLinks
lib/html/walk.js        one tag-tokenizer/skip-stack helper (replaces 6 copies)
lib/html/*.js           heading-ids, abbreviations, initials, roman, divine-names, ellipses, alt-text
lib/bible/              books table, ref parser, linker, scripture-index collector
lib/pages/*.js          indexes, search, random, backlinks, redirects, scripture
```

### What the vault actually uses (survey 2026-10-01)

| Folder | Files | Frontmatter seen |
|---|---|---|
| root | 7 | `unlisted` ×7, `quick nav` ×3, `title`, `permalink`, `hidden` |
| `topic/` | 141 | `categories` 89, `draft` 49, `hidden` 34, `stub` 27, `aliases` 21, `featured` 12, `featured with` 2, `disambiguation` 1, `title` 1 |
| `notes/` | 96 | **`aside of` 96**, `hidden` 15, `aliases` 2, `title` 1 |
| `partial/` | 44 | `hidden` 42 (the two without it, `god-eternity` and `spirit-eternity`, are published at `/partial/…`, probably by mistake) |
| `category/` | 21 | `categories` 16 |
| `reading/` | 5 | `hidden` 5, `categories` 5, `draft` 1 |
| `commentary/` | 4 | `unlisted` 4, `categories` 4 |
| `image/` | 43 | images and favicons (the only asset folder besides `template/`) |
| `template/` | | `layout.ejs`, `style.css`, `css-naked.js`, Font Awesome + Fontello CSS, `fonts/`, and a dead `embed.ejs` |

Other root files that aren't site content: `NTOT.md`, `OTNT.md` and `Sandbox.md` (built as pages), `Topics.base` (Obsidian Bases), and the tooling leftovers `convert-wiki.py`, `do-pandoc.sh`, `ts-filter.lua` and `example-page.html`.

Usage counts:
- **Duplicate basenames:** 92 pairs, almost all `notes/X` ↔ `topic/X`. That is why **239 of 522 wikilinks are path-qualified**.
- **No `[[…#heading]]` links.**
- **EJS appears only in `Colophon.md` and `partial/mt.md`.**
- **228 partial uses.** 44 files use arguments or placeholders, so the argument machinery is in real use.
- **`permalink`** is used once (`Home page.md → home`).
- Small text `~x~` appears in 139 files, `:::` containers in 16, and `%%` comments in 4.
- `quick nav`, `stub` and `disambiguation` are presumably read by `layout.ejs`.

**Notes for topics that don't exist yet are a feature.** Joey sometimes writes notes before the topic page exists. One current example: `notes/Doubt.md` → `topic/Doubt`. Such a note should be treated as draft and/or hidden even without the flag, and shouldn't produce a warning. The exact behaviour is still to be decided.

Fixed in the vault on 2026-10-01: the stray `{{lds}}` embed, and the two unhidden partials. `baseline/` was regenerated afterwards (612 files).

### Hardcoding candidates
Joey to confirm each. The evidence comes from the survey above.
- **Fixed folder roles.** Scan only `topic/`, `notes/`, `category/`, `reading/`, `commentary/`, `partial/` and the root, plus the assets in `image/` and `template/`. This replaces the whole-tree walk and its skip lists.
- **`notes/X` is the aside of the page named `X`.** This already holds for 91 of 96 notes. The exceptions:
  - three point at root or `reading/` pages
  - `Epistemolgy` (a typo) and `Heirs of God (notes)` have mismatched names
  - `Doubt`'s target is missing

  This would retire `aside of`.
- **`hidden` outside `partial/`.** It is still used in `topic/` (34), `notes/` (15) and `reading/` (5), so we need to decide what it means there. (`partial/` is now hardcoded as partials-only; see the next section.)
- **Resolve folder-qualified links via a `folder/name` map**, replacing suffix matching. Bare names resolve to `topic/` (or the root) before `notes/`. The root-file tiebreaker and generic ambiguity logic can probably go.
- **Hardcode the homepage** as `Home page.md`, and drop `permalink` and the home/index logic.
- **Canonical lowercase frontmatter keys.** This drops `getFrontmatterValue` and fixes the `Title:` bug.
- **Assets only from `image/` and `template/`**, which drops the whole-vault scan.
- **`abbreviations.json` and `alt-text.json` become required** and are simply imported.
- **Body EJS** could be replaced or retired, since only `Colophon.md` and `mt.md` use it.
- **Keep partial arguments.** They are in real use.
- **Unknown:** whether the fuzzy hyphen-as-space link matching is used. Measure it before removing.

### Partials (done 2026-10-02)
The feature is called **partials** everywhere in the code (`expandPartials`, `splitPartialArgs`, the `partials` map). Only `partial/` is consulted, by basename; everything in it is a partial and never a page, and its frontmatter is ignored, so the vault can drop it gradually. Verified byte-identical against the baseline.

Still to do, deliberately held back because it changes `dist/`: rename the HTML comments `<!-- embed not found: x -->`, `<!-- circular embed: x -->` to say "partial". Once the refactor ties out, do this as its own commit. `![[image]]` is Obsidian's image embed, a different feature, and keeps its name. The vault still has seven `{{[[violation-goals]]}}`/`{{[[draft]]}}` references to partials that don't exist; they sit in hidden pages, so they are silent.

### Template: stays in the vault or moves here?
`template/` holds the layout, CSS, JS and fonts. Content editors probably shouldn't need to touch it. If it moves to Press, the vault becomes pure content.

## 2. Verified bugs and surprises

Each item below was reproduced on 2026-10-01 in a scratch vault. None are fixed yet. They are listed roughly by user impact.

- **Markup injected into `<title>`.** Every post-processing pass rewrites the whole HTML file. So a page titled "The LORD …" produces `<title>The <span class="divine-name"…>` and the browser tab shows raw tags. Abbreviations, Bible refs, Roman numerals and initials can do the same.
- **Bible-ref false positives.** `BIBLE_REF_RE` is case-insensitive. "I am 30 years old" links to Amos 30, and "my job 2 years ago" links to Job 2. These also land in the Scripture index.
- **Distant translation capture.** In "Romans 3:23 is a great verse. Later the KJV renders it…", the KJV link applies to Romans 3:23. There is no adjacency requirement, unlike continuation refs.
- **"Romans 3, 5"** is read as Romans 3:5, not chapters 3 and 5. The linker and the Scripture collector agree, so this is at least consistent.
- **Uppercase words read as Roman numerals:** `MD`, `DC`, `MIX`, `CD`, `CV`, `LI`, …
- **Heading-ID entities:** `## Faith & Works` gets the id `faith-andamp-works` (slugify sees `&amp;`).
- **`~small~`, `%%comments%%`, wikilinks and partials are processed inside code spans and blocks.** `` `~x~` `` renders as literal `<small>x</small>`.
- **Backlinks count links inside `%%comments%%`** and self-links. The pre-pass runs before comment stripping.
- **Capitalised frontmatter keys** such as `Title:` give an empty `frontmatter.title` in the template.
- **Hidden pages' aliases still produce redirect stubs** to a non-existent page.
- **Path-qualified image wikilinks** (`[[topic/pic.png]]`) aren't resolved and emit a relative href.
- **`[[Page#Heading]]` is unsupported** and renders as broken.
- **`dist/` isn't cleaned.** Stale pages survive. On rebuilds the old Scripture-index files are post-processed twice in one run (23 vs 18 files processed in the test).
- **Unescaped interpolation** in several places: abbreviation `title`, image `alt`, alias redirect titles, fenced-div attributes, and search results (`innerHTML`). `$` in embed arguments is treated as a replacement pattern.
- **A non-string `title` or `permalink`** (for example `title: 1984`) would throw. This was found by reading the code, not reproduced.

**Dead or misleading code** to clean up when touched:
- The `TRANSLATIONS` Set is unused (the list is duplicated three times as regexes).
- The `osis` field is unused.
- The `permalink === ""` homepage branch is unreachable.
- Scripture URLs are added to `allKnownUrls` after all link classification has already run.
- The "slugify not initialised" comment on `_initBookCwmsToInfo` is wrong: ESM imports are hoisted.

## 3. Retire the Replit docs

`README.md` now carries the accurate reference. The Replit docs were moved to `archive/` on 2026-10-01. Joey will decide whether and when to delete them:
- `replit.md`
- `replit.txt` (a copy of `.replit`). It describes a Postgres/`npm run dev` template that never matched this project. The only real content is the dev loop `node build.js && npx serve -l 5000 dist`.
- `project-documents/`. Its task briefs are useful only as design history. Its README wrongly says the files are under `.agents`.

Ways the Replit docs drifted from the code (so nobody trusts them by accident):
- The heading-ID pass and the whole Scripture index are missing from `replit.md`'s pipeline. Its pass numbering is also internally inconsistent: the Roman numeral pass is called "pass 10" in one place and "11" in another.
- The divine-name docs list only LORD/GOD/YHWH. The code also handles the I AM / I WILL BE forms, and YHWH gets no initial span.
- The categorical index is described as "pages grouped under categories". It is actually a flat list of top-level categories.
- The featured index shows secondaries as inline "(and …)", not grouped beneath their primary.
- `bodyClasses` is a template variable but isn't documented.
- The homepage docs claim an empty permalink works. It doesn't.
- Task briefs describe the star as `entypo-icon ★`. The code uses Font Awesome classes.
- Task briefs describe the Scripture index as a `<ul>` with "Title (§Section)". The code uses a `<dl>` with `›` separators, and also excludes categories and asides.
- Backlinks are described as "other pages", but self-links are included.
