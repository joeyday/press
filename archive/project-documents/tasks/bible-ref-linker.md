# Bible Reference Auto-Linker

## What & Why
Add a post-processing step to the build pipeline that scans every generated HTML file and converts plain-text Bible references into hyperlinks pointing to ref.ly (ESV). This replaces the client-side RefTagger script with a build-time equivalent, so references are baked into the static HTML with no runtime dependency.

## Done looks like
- Every Bible reference in the form `John 3:16`, `1Co 13:4–7`, `Genesis 1`, `Ps 23:1-6`, etc. is wrapped in an `<a>` tag linking to the correct ref.ly URL for that passage in the ESV
- Links open in a new tab (`target="_blank" rel="noopener noreferrer"`) and carry `class="external bible-ref"`
- Spaces within a linked reference are replaced with non-breaking spaces so the reference never wraps mid-text
- Hyphens in verse ranges are normalized to en-dashes in the displayed link text
- A reference prefixed with `!` (e.g. `!John 3:16`) is left as plain text with no link
- Text inside `<a>`, `<code>`, `<pre>`, `<script>`, and `<style>` elements is never processed, nor are HTML tag attributes
- The step runs as the very last operation in `build()`, after all HTML files are written to `dist/`
- The build still completes cleanly with no errors on the existing test pages

## Out of scope
- Translation detection (future work — all links go to ESV for now)
- LDS Standard Works (future work)
- Any client-side scripture popup or tooltip behaviour

## Tasks
1. **Book data table** — Define an array of all 66 canonical Protestant books, each with its full name(s) (including singular/plural variants like Psalm/Psalms, Song of Solomon/Song of Songs) and its single CWMS abbreviation from the Colophon abbreviation table. Include a ref.ly-compatible OSIS abbreviation for URL generation.

2. **Reference regex** — Build a single compiled regex from the book table that matches an optional `!` opt-out prefix, optional numbered-book prefix (1/2/3 with optional space before abbreviated forms), the book name or abbreviation, required whitespace, a chapter number, and an optional `:verse` with optional `–endverse` range (including cross-chapter ranges). The regex must be word-boundary-anchored to avoid false positives on substrings.

3. **HTML text-node splitter** — Write a function that splits an HTML string into alternating chunks of raw HTML tags/skipped regions and plain text, processes only the plain-text chunks through the reference regex, and reassembles the result. Skip content inside `<a>`, `<code>`, `<pre>`, `<script>`, `<style>` opening tags (and their closing tags).

4. **Link builder** — For each matched reference, construct the ref.ly URL using the book's OSIS abbreviation and the chapter/verse numbers. Produce the `<a>` tag with correct attributes, link text with spaces → `&nbsp;` and hyphens in ranges → `–`, and honour the `!` opt-out by returning the raw text instead.

5. **Pipeline integration** — Add a `linkBibleRefs(html)` top-level function that wires steps 2–4 together. At the end of `build()`, after all page HTML files and index pages are written, iterate every `.html` file under `dist/` recursively and rewrite each one through `linkBibleRefs`. Log a count of files processed.

## Relevant files
- `build.js`
- `Colophon.md:22-97`
