# Plan

Living roadmap for Press. Update it as work lands; delete finished items rather than ticking them.

## 1. Disentangle Press from the content repo

Press and the site content used to share one GitHub repo. The goal is two repos: Press (this one) and the vault.

**Already true:** `build.js` resolves all inputs and outputs from the working directory. So `cd vault && node ../press/build.js` works today, with deps installed in `press/`. Tested 2026-10-01 against a scratch vault.

**Missing from this repo** (requested from Joey):
- `package.json` / `package-lock.json`: we need the real dependency versions. `markdown-it-attrs` and `markdown-it-container` behaviour varies by version.
- `template/layout.ejs` and anything else under `template/` (CSS, fonts, JS). Decide: is this a theme the vault owns, or a default that Press ships?
- `.github/workflows/deploy.yml`: shows how CI invokes the build. It will need to check out or install Press.
- `scripts/post-merge.sh`: referenced by the Replit config. Probably Replit-only.
- For reference only (content, stays in the vault): `abbreviations.json`, `alt-text.json`, `partials/`, `404.md`, `Colophon.md`, which holds the source of the Bible book abbreviation table.

**Site-specific things hardcoded in `build.js`.** Candidates to move into vault config:
- The `/random` page body (a Proverbs 16:33 quotation, with `LORD` wrapped in `<abbr>`, so the divine-name pass skips it).
- Font Awesome star classes on the alphabetical index (`fa-sharp fa-solid fa-star`).
- Index page titles and empty-state strings.
- The translation list and the ESV default.
- The MiniSearch CDN URL.
- The skip lists (`replit.md`, `.local`).

**Open question:** are the Bible-reference, divine-name, Roman-numeral and Scripture-index features core Press or site plugins? They are clearly specific to this site.

**Likely next steps:**
1. Add `package.json` (ESM, `bin`/`build` script) and `.gitignore`.
2. Accept the vault dir and out dir as CLI args, defaulting to cwd.
3. Add a regression harness: a fixture vault plus snapshot of `dist/`, so refactors are safe.
4. Consider splitting `build.js` into modules.

## 2. Verified bugs and surprises

Each item below was reproduced on 2026-10-01 in a scratch vault. None are fixed yet. They are listed roughly by user impact.

- **Markup injected into `<title>`.** Every post-processing pass rewrites the whole HTML file. So a page titled "The LORD …" produces `<title>The <span class="divine-name"…>` and the browser tab shows raw tags. Abbreviations, Bible refs, Roman numerals and initials can do the same.
- **Bible-ref false positives.** `BIBLE_REF_RE` is case-insensitive. "I am 30 years old" links to Amos 30, and "my job 2 years ago" links to Job 2. These also land in the Scripture index.
- **Distant translation capture.** In "Romans 3:23 is a great verse. Later the KJV renders it…", the KJV link applies to Romans 3:23. There is no adjacency requirement, unlike continuation refs.
- **"Romans 3, 5"** is read as Romans 3:5, not chapters 3 and 5. The linker and the Scripture collector agree, so this is at least consistent.
- **Uppercase words read as Roman numerals:** `MD`, `DC`, `MIX`, `CD`, `CV`, `LI`, …
- **Heading-ID entities:** `## Faith & Works` gets the id `faith-andamp-works` (slugify sees `&amp;`).
- **`~small~`, `%%comments%%`, wikilinks and embeds are processed inside code spans and blocks.** `` `~x~` `` renders as literal `<small>x</small>`.
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
