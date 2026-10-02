# Press

A static site generator with a deliberately boring name. It turns an Obsidian-style Markdown vault into a GitHub Pages site. It was originally vibe-coded with Replit Agent; Claude now maintains it.

- `build.js`: the entire generator, a single ESM script of about 2,800 lines. **It is the source of truth.**
- `README.md`: the feature reference, written from the code. Keep it in sync whenever behaviour changes.
- `docs/plan.md`: roadmap, missing files, verified bugs, and the Replit-doc retirement list.
- `archive/` (`replit.md`, `replit.txt`, `project-documents/`): legacy Replit Agent docs, kept until Joey decides whether to delete them. **Don't trust them.** They have drifted from the code in many places (listed in `docs/plan.md`). Read them for intent or history only, and always check claims against `build.js`.

## Working rules

- Read the code before believing any doc. When code and docs disagree, tell Joey rather than silently picking one.
- Press is a **bespoke generator for exactly one site**. It will never be a general-purpose tool. There is a slim chance it will someday also serve one very similar second site, which would need at most one or two settings. Hardcode decisions such as folder roles, file names and frontmatter keys rather than adding options, config or plugin hooks. Prefer YAGNI over DRY, and treat removing abstractions as an improvement. Libraries are fine for things that must be bulletproof, such as Markdown parsing.
- Build speed is a first-class goal. Don't add another full pass over the corpus without a reason.
- The site's *content* lives in a separate vault repo. The generator's code lives here, even though that code is site-specific.
- Match the existing style: 2-space indent, double quotes, trailing commas, Prettier-ish wrapping, `// ─── Section ───` banners, and explanatory comments on the non-obvious regexes.
- Nothing is committed yet (no commits on `main`). Only commit when asked.

## Running and testing

`vault/` (gitignored) holds a local **copy** of the real site content. It was copied from `~/Documents/Obsidian/Tota Scriptura` and excludes `.git`, `.obsidian`, `.github`, `build.js` and the package files. It is test data: never commit it, and never write to the real vault. Refresh it with the same `rsync` (see `docs/plan.md`).

Search tools skip gitignored paths, so target `vault/` explicitly when searching it.

```sh
npm ci                                                      # once
cd vault && rm -rf dist && node ../build.js                 # build (cwd must be the vault)
node ../scripts/compare-dist.mjs ../baseline/dist dist      # must say IDENTICAL for pure refactors
```

- All paths in `build.js` are relative to the cwd. From the repo root, the build would publish this repo's own Markdown.
- Output goes to `./dist`, or to `$PRESS_OUT` when set (an absolute or cwd-relative path). The build doesn't clean it, so always `rm -rf` it first.
- `baseline/dist` (gitignored) is the reference output of the original `build.js` for the current `vault/` copy. Regenerate it whenever `vault/` is refreshed, or whenever an output change is accepted on purpose.
- The layout uses `Date.now()` cache-busters, so raw `diff -r` always differs. `compare-dist.mjs` normalises them.
- For edge cases the vault lacks, use a scratch vault in the scratchpad.

## Releasing

The content repo (`joeyday/totascriptura.org`, cloned at `~/Documents/Obsidian/Tota Scriptura`) depends on `github:joeyday/press#vX.Y.Z` and runs `npm run build` → `press` in CI. Nothing in Press reaches the live site until a tag is bumped there.

To release:
1. Bump `version` in `package.json`.
2. Commit, then tag `vX.Y.Z` and push the tag.
3. In the content repo, update the tag in `package.json` and run `npm install --package-lock-only` (never a full `npm install` inside the iCloud vault).
4. Commit and push. Only do this with Joey's go-ahead, since it deploys the live site.

`template/` (layout, CSS, JS, fonts) belongs to Press. It is resolved from `build.js`'s own directory, and its assets are copied alongside the vault's.

## Architecture in one breath

`build()` does the following, in order:

1. Copies assets flat to `dist/asset/`.
2. Parses every `.md` file into `filesToProcess`, and builds `fileMap`, `contentMap` and `titleMap`.
3. Derives the relationship maps: aliases, featured, `featured with`, asides, category members, all pages.
4. Runs a backlinks pre-pass.
5. Renders each page: embeds → wikilinks → EJS → `%%` strip → `~small~` → markdown-it → layout → `classifyLinks`.
6. Writes the generated pages: alias redirects, backlinks pages, the four indexes, search and random.
7. Re-reads every HTML file in `dist/` for the string-rewriting post-passes: heading IDs → Scripture collection and index pages → Bible-ref linker → abbreviations → initials → Roman numerals → divine names → ellipses → alt text.

Every post-pass uses the same hand-rolled tag-splitter-plus-skip-stack pattern (`TAG_RE`). None of them skip `<head>` or `<title>`.

Key helpers:
- `resolveLink`: path-qualified matching, a root-file tiebreaker, and `excludeUrl`.
- `resolveEmbeds`: recursive, with positional arguments.
- `getFrontmatterValue`: case-insensitive key lookup.
- `sortableTitle`: ignores leading articles when sorting.
