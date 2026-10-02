# Tota Scriptura Static Site Generator

A static site generator with a deliberately boring name. It turns an Obsidian-style Markdown vault into a GitHub Pages site. It was originally vibe-coded with Replit Agent; Claude now maintains it.

- `build.js`: the CLI entry point and orchestrator (about 190 lines). It wires together the modules in `lib/`; the real logic lives there. Code is the source of truth, not the docs.
- `lib/`: the generator, one concern per file: `vault.js` (file discovery, assets, page records), `links.js`, `partials.js`, `markdown.js`, `render.js` (Markdown → body HTML), `model.js` (categories, featured/draft, notes pairs, per-namespace lists, backlinks), `layout.js` (compiled layout, link classification), `output.js` (in-memory post-passes and the writer), `io.js`, `titles.js`, `html/` (the tag walker and the pure HTML passes), `bible/` (ref table, linker, Scripture collector) and `pages/` (one file per kind of generated page).
- `serve.js`: the local preview server behind `tsgen serve`.
- `README.md`: the feature reference, written from the code. Keep it in sync whenever behaviour changes.
- `docs/plan.md`: roadmap, missing files, verified bugs, and the Replit-doc retirement list.
- `archive/` (`replit.md`, `replit.txt`, `project-documents/`): legacy Replit Agent docs, kept until Joey decides whether to delete them. **Don't trust them.** They have drifted from the code in many places (listed in `docs/plan.md`). Read them for intent or history only, and always check claims against the code.

## Working rules

- Read the code before believing any doc. When code and docs disagree, tell Joey rather than silently picking one.
- tsgen is a **bespoke generator for exactly one site**. It will never be a general-purpose tool. There is a slim chance it will someday also serve one very similar second site, which would need at most one or two settings. Hardcode decisions such as folder roles, file names and frontmatter keys rather than adding options, config or plugin hooks. Prefer YAGNI over DRY, and treat removing abstractions as an improvement. Libraries are fine for things that must be bulletproof, such as Markdown parsing.
- Build speed is a first-class goal. Don't add another full pass over the corpus without a reason.
- The site's *content* lives in a separate vault repo. The generator's code lives here, even though that code is site-specific.
- Match the existing style: 2-space indent, double quotes, trailing commas, Prettier-ish wrapping, `// ─── Section ───` banners, and explanatory comments on the non-obvious regexes.
- Only commit when asked. Pushing tags or touching the content repo needs Joey's explicit go-ahead.
- For test builds, set `TSGEN_OUT` to the scratchpad. `~/.tsgen/dist` (Joey's own `TSGEN_OUT`) is outside my default workspace.

## Running and testing

`vault/` (gitignored) holds a local **copy** of the real site content. It was copied from `~/Documents/Obsidian/Tota Scriptura` and excludes `.git`, `.obsidian`, `.github`, `build.js` and the package files. It is test data: never commit it, and never write to the real vault. Refresh it with the same `rsync` (see `docs/plan.md`).

Search tools skip gitignored paths, so target `vault/` explicitly when searching it.

```sh
npm ci                                                      # once
cd vault && rm -rf dist && node ../build.js                 # build (cwd must be the vault)
node ../scripts/compare-dist.mjs ../baseline/dist dist      # must say IDENTICAL for pure refactors
```

- All paths in `build.js` are relative to the cwd. From the repo root, the build would publish this repo's own Markdown.
- Output goes to `./dist`, or to `$TSGEN_OUT` when set (an absolute or cwd-relative path). The build doesn't clean it, so always `rm -rf` it first.
- `baseline/dist` (gitignored) is the reference output of the original `build.js` for the current `vault/` copy. Regenerate it whenever `vault/` is refreshed, or whenever an output change is accepted on purpose.
- The layout uses `Date.now()` cache-busters, so raw `diff -r` always differs. `compare-dist.mjs` normalises them.
- For edge cases the vault lacks, use a scratch vault in the scratchpad.

## Releasing

The content repo (`joeyday/totascriptura.org`, cloned at `~/Documents/Obsidian/Tota Scriptura`) depends on `github:joeyday/tota-scriptura-static-site-generator#vX.Y.Z` and runs `npm run build` → `tsgen` in CI. Nothing in tsgen reaches the live site until a tag is bumped there.

To release:
1. Bump `version` in `package.json`.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. In the content repo, update the tag in `package.json` and run `npm update tsgen --package-lock-only` (never a full `npm install` inside the iCloud vault). Plain `npm install --package-lock-only` does **not** re-resolve a git dependency whose lock entry already exists, so CI would keep building with the old tsgen. Then run `npm audit fix --package-lock-only` there too: the content repo's lockfile pins tsgen's nested dependencies (tsgen's own lockfile is ignored when it is installed as a dependency), so patched versions only arrive when the content repo's lockfile is refreshed. Check that `package-lock.json`'s `node_modules/tsgen` entry shows the new `version` and the new tag's commit (`git rev-parse --short vX.Y.Z`) before committing. Content migrations and the tag bump go in one commit, since the push is what deploys.
4. Commit and push. Only do this with Joey's go-ahead, since it deploys the live site.

`template/` (layout, CSS, JS, fonts) belongs to tsgen. It is resolved from `build.js`'s own directory, and its assets are copied alongside the vault's.

## Architecture in one breath

`build()` does the following, in order:

1. Copies assets flat to `dist/asset/`, then parses every `.md` file (`loadVault`) into page records plus the `fileMap` and `index` lookups. Files in `partial/` go to a separate `partials` map and are never pages.
2. `buildModel` derives the relationships: aliases, categories (a category is a page in `category/`; an empty one is unlisted), featured, `featured with`, notes pairs, the per-namespace alphabetical lists, and backlinks.
3. Renders each page (`renderBody`: partials → wikilinks → EJS → `%%` strip → `~small~` → markdown-it), wraps it in the layout (`classifyLinks` runs on the result), and hands it to `output.emitPage`.
4. Writes the generated pages: alias redirects, backlinks pages, the indexes, search, random and the Scripture index.
5. Every page, content or generated, goes through the same in-memory post-passes inside `output` before its single write: heading IDs → Scripture collection (content pages only) → Bible-ref linker → abbreviations → initials → Roman numerals → divine names → ellipses → alt text. The passes share one tag-splitter (`lib/html/walk.js`). None of them skip `<head>` or `<title>`.

Key helpers:
- `resolveLink`: exact path matching for qualified links; bare names narrow to the source's folder, then `topic/`, then the root. A `notes/` folder next to a page is its notes page (`/…/foo/notes`).
- `expandPartials`: recursive, with positional arguments. Looks up `partial/` basenames only.
- `getFrontmatterValue` (`lib/vault.js`): case-insensitive key lookup.
- `compareTitles` (`lib/titles.js`): sorts ignoring leading articles and case.
