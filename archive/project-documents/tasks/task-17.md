---
title: Root-file tiebreaker in link resolution + aside self-exclusion
---
# Root-file tiebreaker in link resolution

  ## What & Why
  When multiple files share the same basename (e.g. `Home page.md` at root and `aside/Home page.md`), a bare link `[[Home page]]` currently triggers the "ambiguous" path and silently drops aside associations and other links.

  The correct rule: if exactly one of the candidates lives at the filesystem root (no subfolder), a bare link unambiguously refers to that file — because there is no alternative syntax available to target a root-level file more precisely than a bare name. If the root file turns out to be the wrong target, that's the author's mistake to fix in their vault.

  A secondary rule — self-exclusion — also applies: when resolving an `aside of` target, the aside page itself should be filtered out of the candidates before any count check.

  Both rules together mean `aside/Home page.md` with `aside of: [[Home page]]` will correctly resolve to root `Home page.md`.

  ## Done looks like
  - `aside/Home page.md` with `aside of: [[Home page]]` shows "Aside of Home page" on the aside page and "Asides — Home page" on the home page.
  - A bare `[[Apple]]` link where `Apple.md` exists at root AND in subfolders resolves to the root file (no "ambiguous" warning).
  - A bare `[[Apple]]` link where `Apple.md` exists in two subfolders but NOT at root still produces the "Ambiguous" warning.
  - All existing aside associations (different filenames, no root collision) continue to work unchanged.
  - Build log emits no spurious "Ambiguous" warning for any case covered by these rules.

  ## Out of scope
  - Any change to how `fileMap` keys are constructed.
  - Path-qualified link resolution (the `trimmed.includes("/")` branch is unchanged).

  ## Tasks
  1. **Root-file tiebreaker in `resolveLink`** — After applying self-exclusion filtering, if there are still multiple URL candidates, check how many belong to files with `relDir === ""` (root-level files). If exactly one, return that URL as unambiguous. Otherwise fall through to `{ ambiguous: true }`.
  2. **Self-exclusion parameter** — Add an optional `excludeUrl` parameter to `resolveLink`. Filter it from the candidate list before both the length check and the tiebreaker. Pass `fileInfo.finalUrlPath` at the two `asideOf` call sites (asidesMap building and per-page asideOfResolved).

  ## Relevant files
  - `build.js:1343-1369`
  - `build.js:1695-1720`
  - `build.js:1950-1960`