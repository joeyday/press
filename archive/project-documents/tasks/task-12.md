---
title: Add `unlisted` property; remove root-directory index exclusion
---
# Add `unlisted` frontmatter property; remove root-directory exclusion

## What & Why
Pages currently in the vault root are excluded from all indexes via a single
`if (fileInfo.relDir === "") continue;` guard in the `allPages` loop.  The user
wants root-level pages to be indexable like any other page, with a new opt-in
`unlisted` YAML property to achieve the same exclusion effect.

An unlisted page:
- Builds and is accessible at its URL as normal
- Has proper (non-broken) internal links pointing to it
- Is excluded from all four named indexes (alphabetical, categorical, featured, drafts)
- Is excluded from the search document list
- Still participates in `asidesMap` (page-level structural relationship, not an index)

## Changes — all in build.js

### 1. Parse `unlisted` from frontmatter (~line 983)
After the `draft` parse, add:
```js
const unlisted = !!getFrontmatterValue(parsed.data, "unlisted");
```
Add `unlisted` to the `filesToProcess.push({...})` object.

### 2. Remove root-directory exclusion from `allPages` (~line 1173)
Delete the line:
```js
if (fileInfo.relDir === "") continue;
```

### 3. Add `unlistedUrls` Set alongside `hiddenUrls` (~line 1105)
```js
const unlistedUrls = new Set(
  filesToProcess.filter((f) => f.unlisted).map((f) => f.finalUrlPath),
);
```
Do NOT add `unlistedUrls` to the `allKnownUrls` filter — unlisted pages must
remain valid link targets.

### 4. Add `if (fileInfo.unlisted) continue;` guards in six loops:
- `featuredPages`/`draftPages` loop (~line 1039)
- `featuredWithMap` loop (~line 1059)
- `membersMap` loop (~line 1087)
- `allPages` loop (~line 1174) — alongside removing the relDir check
- `searchDocs` loop (~line 1197)

### 5. Extend `topLevelCategoryPages` filter (~line 1368)
Add `!unlistedUrls.has(fileMap[key])` alongside the existing
`!hiddenUrls.has(fileMap[key])` check.

## Done looks like
- Existing root-level pages (Home page.md, About, Colophon) with no `unlisted`
  property now appear in the alphabetical index
- Adding `unlisted: true` to any page (root or subdirectory) causes it to
  disappear from all four indexes and from search
- Links to unlisted pages in content still render as valid internal links
- Build log is unchanged