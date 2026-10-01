# Show star next to featured pages in alphabetical index

## What & Why
Pages with `featured: true` in frontmatter should have a star icon appended
after their link in the alphabetical index, using the Entypo icon span the
site already uses for other icons.

## Done looks like
- Featured pages in the alphabetical index render as:
  `<a href="/topic/foo">Foo</a> <span class="entypo-icon">★</span>`
- Non-featured pages are unchanged
- The star does NOT appear in the categorical, featured, or drafts indexes
  (redundant in "Featured topics"; irrelevant in the others)
- Build log is unchanged; no new console output needed

## Changes required in build.js

1. **Carry `featured` through to `allPages` items** (~line 1049):
   ```js
   // Before:
   allPages.push({ title: fileInfo.title, url: fileInfo.finalUrlPath });
   // After:
   allPages.push({ title: fileInfo.title, url: fileInfo.finalUrlPath, featured: fileInfo.featured });
   ```
   Alias redirect entries (the `for (const aliasName...)` push) do not need
   the flag — they're redirect stubs that never render as real links.

2. **Append star in the list template** (~line 1259):
   ```js
   // Before:
   listHtml += `  <li><a href="${item.url}">${item.title}</a></li>\n`;
   // After:
   const starHtml = indexPage.slug === "alphabetical" && item.featured
     ? ' <span class="entypo-icon">★</span>'
     : "";
   listHtml += `  <li><a href="${item.url}">${item.title}</a>${starHtml}</li>\n`;
   ```

## Relevant files
- `build.js` ~lines 1049 and 1259
