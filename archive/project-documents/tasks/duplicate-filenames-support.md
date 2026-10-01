# Support Duplicate Filenames Across Folders

## What & Why
Currently `fileMap` is keyed by bare filename, so two files with the same name in different folders (e.g. `topic/Trinity.md` and `aside/Trinity.md`) silently collide — the second file processed overwrites the first in the map. This change makes duplicate names safe: each key tracks all matching URLs, path-qualified wikilinks are resolved precisely, and unresolvable ambiguous links are left as broken links (with the `broken` CSS class) rather than silently pointing to the wrong page.

## Done looks like
- Two files with the same name in different folders both build correctly and are independently reachable at their respective URLs.
- A bare wikilink like `[[Trinity]]` that matches exactly one file resolves as before.
- A bare wikilink like `[[Trinity]]` that matches two or more files produces a broken-classed link and a build warning naming the ambiguous target.
- A path-qualified wikilink like `[[topic/Trinity]]` or `[[aside/Trinity]]` resolves to the correct file unambiguously.
- The same disambiguation logic applies to embed transclusions (`{{Trinity}}`).
- Aliases continue to work correctly and do not introduce false ambiguity.

## Out of scope
- Any changes to how Obsidian authors or maintains the source files.
- Automatically choosing one target when a link is ambiguous (the broken-link approach is intentional).
- UI or template changes.

## Tasks
1. **Make `fileMap` multi-valued.** Change `fileMap` from `key → url` to `key → url[]`. Update the population loop so each key accumulates all matching URLs rather than overwriting. Update the alias-population code similarly so aliases never stomp existing entries.

2. **Add a path-qualified lookup path.** When a wikilink or embed target contains a `/` (e.g. `topic/Trinity`), resolve it by matching the folder prefix and bare name against the known file list rather than doing a flat key lookup. This is how Obsidian writes disambiguated links.

3. **Update `resolveFileMapKey` and wikilink resolution.** Teach the wikilink replacement block to use the new multi-valued map: if the resolved key has exactly one URL, emit a normal markdown link; if it has zero or more than one, emit a plain-text span or anchor with the `broken` class and log a build warning. Apply the same logic to embed resolution in `resolveEmbeds`.

4. **Update all other `fileMap` consumers.** Audit every other place in `build.js` that reads from `fileMap` (aside/category lookups, featured-with, etc.) and update them to work with the new array-valued structure.

## Relevant files
- `build.js:922-929`
- `build.js:931-970`
- `build.js:1055-1064`
- `build.js:1100-1118`
- `build.js:1294-1335`
