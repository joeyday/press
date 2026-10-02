import path from "path";
import { IMAGE_EXTENSIONS } from "./vault.js";
import { findCategory, pathKey, resolveLink } from "./links.js";
import { expandPartials } from "./partials.js";
import { compareTitles } from "./titles.js";

// The relationships between pages: categories, featured and draft lists,
// notes pairs, the alphabetical lists per namespace, and backlinks.

// Each top-level folder is a namespace with its own alphabetical index; root
// pages are "meta". A namespace with nothing listed has no index page.
// The keys set the menu order; the values are the menu labels.
export const NAMESPACES = {
  topic: "Topics",
  category: "Categories",
  commentary: "Commentaries",
  summary: "Summaries",
  meta: "Meta",
};

export const nsName = (ns) => ns[0].toUpperCase() + ns.slice(1);

export function buildModel({ filesToProcess, index, fileMap, partials, imageMap, aliasRedirects }) {
  // ─── Categories ───
  // A category is a page in category/. A page's `categories` names are looked
  // up there, and its members are the listed pages that name it. An empty
  // category is unlisted, which can in turn empty its parent, so repeat until
  // nothing changes.
  let membersMap;
  for (let changed = true; changed; ) {
    membersMap = {};
    for (const fileInfo of filesToProcess) {
      if (fileInfo.hidden || fileInfo.unlisted) continue;
      for (const catName of fileInfo.categories) {
        const target = findCategory(index, catName);
        if (!target) continue;
        (membersMap[target.finalUrlPath] ??= []).push({
          title: fileInfo.title,
          url: fileInfo.finalUrlPath,
        });
      }
    }
    changed = false;
    for (const fileInfo of filesToProcess) {
      if (!fileInfo.isCategory || fileInfo.hidden || fileInfo.unlisted) continue;
      if (membersMap[fileInfo.finalUrlPath]) continue;
      fileInfo.unlisted = true;
      changed = true;
    }
  }
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden || fileInfo.unlisted) continue;
    for (const catName of fileInfo.categories) {
      if (!findCategory(index, catName)) {
        console.warn(
          `Warning: Could not find category "${catName}" in "${fileInfo.filePath}"`,
        );
      }
    }
  }

  const featuredPages = [];
  const draftPages = [];

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    if (fileInfo.unlisted) continue;
    if (fileInfo.featured) {
      featuredPages.push({ title: fileInfo.title, url: fileInfo.finalUrlPath });
    }
    if (fileInfo.draft) {
      draftPages.push({ title: fileInfo.title, url: fileInfo.finalUrlPath });
    }
  }

  featuredPages.sort(compareTitles);
  draftPages.sort(compareTitles);

  // Map from primary page URL → secondary pages that declare "featured with" pointing to it.
  // Secondary pages appear alongside their primary on the featured topics index.
  const featuredWithMap = {};
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    if (fileInfo.unlisted) continue;
    if (!fileInfo.featuredWith) continue;
    const resolved = resolveLink(
      fileInfo.featuredWith,
      fileMap,
      index,
      fileInfo.nsDir,
    );
    if (!resolved.url) continue;
    const targetUrl = resolved.url;
    if (!featuredWithMap[targetUrl]) featuredWithMap[targetUrl] = [];
    featuredWithMap[targetUrl].push({
      title: fileInfo.title,
      url: fileInfo.finalUrlPath,
    });
  }

  // notesByPage: page URL → URL of its notes page, and the reverse. A notes
  // page is <dir>/notes/X.md for the page <dir>/X.md; either may exist alone.
  const notesByPage = {};
  const pageByNotes = {};
  for (const fileInfo of filesToProcess) {
    if (!fileInfo.isNote) continue;
    const page = index.byPath[pathKey(fileInfo.nsDir, fileInfo.baseName)];
    if (!page || page.isNote) continue;
    if (!fileInfo.hidden) notesByPage[page.finalUrlPath] = fileInfo.finalUrlPath;
    if (!page.hidden) {
      pageByNotes[fileInfo.finalUrlPath] = { url: page.finalUrlPath };
    }
  }

  // Sort each category's member list article-aware alphabetically so category
  // pages and subcategory pages render in consistent order regardless of file
  // discovery order.
  for (const arr of Object.values(membersMap)) {
    arr.sort(compareTitles);
  }

  const hiddenUrls = new Set(
    filesToProcess.filter((f) => f.hidden).map((f) => f.finalUrlPath),
  );
  const allKnownUrls = new Set([
    ...Object.values(fileMap)
      .flat()
      .filter((url) => !hiddenUrls.has(url)),
    ...aliasRedirects.map((r) => r.fromUrlPath),
    ...Object.values(imageMap),
    "/search",
    "/random",
  ]);

  // Register every non-hidden page's backlinks URL so classifyLinks never
  // marks a link to it as broken (e.g. the footer link added by the template).
  for (const fi of filesToProcess) {
    if (fi.hidden) continue;
    allKnownUrls.add(
      fi.finalUrlPath === "/" ? "/backlinks" : `${fi.finalUrlPath}/backlinks`,
    );
  }
  const draftUrls = new Set(draftPages.map((p) => p.url));
  const featuredUrls = new Set(featuredPages.map((p) => p.url));
  const categoryUrls = new Set(
    filesToProcess.filter((f) => f.isCategory).map((f) => f.finalUrlPath),
  );
  const asideUrls = new Set(
    filesToProcess.filter((f) => f.isNote).map((f) => f.finalUrlPath),
  );

  // ─── Namespaces ───
  // Each top-level folder is a namespace with its own alphabetical index; root
  // pages are "meta". A namespace with nothing listed has no index page.
  const alphabeticalByNs = Object.fromEntries(
    Object.keys(NAMESPACES).map((ns) => [ns, []]),
  );
  for (const fileInfo of filesToProcess) {
    if (fileInfo.isNote) continue;
    if (fileInfo.hidden) continue;
    if (fileInfo.unlisted) continue;
    const list = alphabeticalByNs[fileInfo.relDir || "meta"];
    if (!list) continue;

    list.push({
      title: fileInfo.title,
      url: fileInfo.finalUrlPath,
      featured: fileInfo.featured || !!fileInfo.featuredWith,
    });
    for (const aliasName of fileInfo.aliases) {
      list.push({
        title: aliasName,
        redirect: { title: fileInfo.title, url: fileInfo.finalUrlPath },
      });
    }
  }
  for (const list of Object.values(alphabeticalByNs)) {
    list.sort(compareTitles);
  }
  const listedNamespaces = Object.keys(NAMESPACES).filter(
    (ns) => alphabeticalByNs[ns].length > 0,
  );

  // ── Backlinks pre-pass ───────────────────────────────────────────────────────
  // Scan every non-hidden page's wikilinks (after partial expansion, matching the
  // same resolveLink logic used in the main loop) and build a map of
  //   targetUrl → [{title, url}]   (sorted alphabetically by title)
  // This must run BEFORE the main render loop so each page can receive its
  // backlinkCount for the footer link.

  const backlinksMap = {}; // targetUrl → [{title, url}]

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;
    const sourceUrl = fileInfo.finalUrlPath;

    const fullMarkdown = expandPartials(fileInfo.parsed.content, partials);

    fullMarkdown.replace(/(?:!?)\[\[(.*?)\]\]/g, (_match, inner) => {
      let target = inner;
      if (inner.includes("|")) {
        target = inner.split("|")[0];
      }
      let searchTarget = target.trim();
      const ext = path.extname(searchTarget).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) return _match;
      if (searchTarget.toLowerCase().endsWith(".md")) {
        searchTarget = searchTarget.slice(0, -3);
      }
      const resolved = resolveLink(searchTarget, fileMap, index, fileInfo.nsDir);
      if (resolved.url) {
        if (!backlinksMap[resolved.url]) backlinksMap[resolved.url] = [];
        // Avoid duplicates (same source linking to same target multiple times)
        if (!backlinksMap[resolved.url].some((e) => e.url === sourceUrl)) {
          backlinksMap[resolved.url].push({
            title: fileInfo.title,
            url: sourceUrl,
          });
        }
      }
      return _match;
    });
  }

  // Sort each backlinks list article-aware alphabetically by title
  for (const arr of Object.values(backlinksMap)) {
    arr.sort(compareTitles);
  }

  // ── End Backlinks pre-pass ───────────────────────────────────────────────────

  return {
    membersMap,
    featuredPages,
    draftPages,
    featuredWithMap,
    notesByPage,
    pageByNotes,
    allKnownUrls,
    draftUrls,
    featuredUrls,
    categoryUrls,
    asideUrls,
    alphabeticalByNs,
    listedNamespaces,
    backlinksMap,
  };
}
