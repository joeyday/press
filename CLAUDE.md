# Press

A static site generator with a deliberately boring name. It turns an Obsidian-style Markdown vault into a GitHub Pages site. It was originally vibe-coded with Replit Agent; Claude now maintains it.

- `build.js`: the entire generator, a single ESM script of about 2,800 lines. **It is the source of truth.**
- `README.md`: the feature reference, written from the code. Keep it in sync whenever behaviour changes.
- `docs/plan.md`: roadmap, missing files, verified bugs, and the Replit-doc retirement list.
- `archive/` (`replit.md`, `replit.txt`, `project-documents/`): legacy Replit Agent docs, kept until Joey decides whether to delete them. **Don't trust them.** They have drifted from the code in many places (listed in `docs/plan.md`). Read them for intent or history only, and always check claims against `build.js`.

## Working rules

- Read the code before believing any doc. When code and docs disagree, tell Joey rather than silently picking one.
- Press is being split away from the site content, which used to share the repo. Keep vault-specific content and config out of this repo, and flag anything hardcoded in `build.js` that is really site config.
- Match the existing style: 2-space indent, double quotes, trailing commas, Prettier-ish wrapping, `// ─── Section ───` banners, and explanatory comments on the non-obvious regexes.
- Nothing is committed yet (no commits on `main`). Only commit when asked.

## Running and testing

There is no `package.json`, lockfile, template or test suite in the repo yet (see `docs/plan.md`). To exercise the script, use a scratch vault:

```sh
# in a scratch dir: package.json {"type":"module"} plus
npm i gray-matter markdown-it markdown-it-footnote markdown-it-mark markdown-it-container \
      markdown-it-bracketed-spans markdown-it-attrs ejs slugify
mkdir template && echo '<title><%= frontmatter.title %></title><%- content %>' > template/layout.ejs
# add some .md files, then:
node /path/to/build.js       # cwd = the vault; output goes to ./dist
```

All paths in `build.js` are relative to the cwd. Bare imports resolve from `build.js`'s own directory. Delete `dist/` between runs, because the build doesn't clean it.

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
