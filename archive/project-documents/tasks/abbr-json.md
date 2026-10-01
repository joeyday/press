# Switch abbreviation source from YAML frontmatter to abbreviations.json

## What & Why
Obsidian's Properties UI doesn't handle YAML maps well — it shows them as
raw YAML text instead of offering structured editing. Replace `abbreviations.md`
(with its YAML frontmatter map) with a plain `abbreviations.json` file at the
vault root. The build script reads JSON natively with no extra parsing.

## Done looks like
- `abbreviations.json` exists at the vault root containing a JSON object
  mapping abbreviation strings to their expansion strings, with the same
  entries currently in `abbreviations.md`
- `loadAbbrMap()` in `build.js` reads `abbreviations.json` with
  `fs.readFile` + `JSON.parse` instead of gray-matter parsing
- Console messages updated to reference `abbreviations.json`
- `abbreviations.md` is deleted
- Build completes cleanly and the abbreviation expander log line still reports
  rewrites as before

## Relevant files
- `build.js` — `loadAbbrMap()` function (~line 361)
- `abbreviations.md` — delete this file
- `abbreviations.json` — create this file
