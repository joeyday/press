#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import ejs from "ejs";
import slugify from "slugify";
import {
  findCategory,
  notesParentDir,
  parseNameList,
  pathKey,
  resolveLink,
  stripBrackets,
} from "./lib/links.js";
import { mapLimit } from "./lib/io.js";
import { createLayout } from "./lib/layout.js";
import { md, protectFencedAttrs } from "./lib/markdown.js";
import { createOutput } from "./lib/output.js";
import { expandPartials } from "./lib/partials.js";

// The vault (content) is the working directory; the template ships with Press.
// Output goes to ./dist unless PRESS_OUT names another directory (local use
// only, e.g. to keep build output out of the iCloud-synced vault; CI sets nothing).
const OUTPUT_DIR = process.env.PRESS_OUT
  ? path.resolve(process.env.PRESS_OUT)
  : "dist";
const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "template",
);
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, "layout.ejs");
const SKIP_FILES = new Set(["replit.md"]);
const MD_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  path.basename(OUTPUT_DIR),
  ".git",
  ".github",
  ".local",
  "template",
]);
const ASSET_SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  path.basename(OUTPUT_DIR),
  ".git",
  ".github",
  ".local",
]);
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
]);
const ASSET_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".css",
  ".js",
  ".eot",
  ".otf",
  ".ttf",
  ".woff",
  ".woff2",
]);

async function ensureDir(dir) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function findFiles(dir, { skipDirs, filter, rootDir }) {
  rootDir = rootDir || dir;
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  // readdir order is up to the filesystem; sort so output doesn't depend on it.
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || entry.name.startsWith(".")) continue;
      const subResults = await findFiles(fullPath, {
        skipDirs,
        filter,
        rootDir,
      });
      results.push(...subResults);
    } else if (entry.isFile()) {
      const item = filter(entry, fullPath, rootDir);
      if (item) results.push(item);
    }
  }
  return results;
}

function findMarkdownFiles(dir) {
  return findFiles(dir, {
    skipDirs: MD_SKIP_DIRS,
    filter: (entry, fullPath, rootDir) => {
      if (
        !entry.name.endsWith(".md") ||
        SKIP_FILES.has(entry.name.toLowerCase())
      )
        return null;
      const relDir = path.relative(rootDir, path.dirname(fullPath));
      return { filePath: fullPath, relDir, fileName: entry.name };
    },
  });
}

const ASSET_SKIP_FILES = new Set(["build.js"]);

function findAssetFiles(dir) {
  return findFiles(dir, {
    skipDirs: ASSET_SKIP_DIRS,
    filter: (entry, fullPath) => {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ASSET_EXTENSIONS.has(ext)) return null;
      if (ASSET_SKIP_FILES.has(entry.name)) return null;
      return { filePath: fullPath, fileName: entry.name };
    },
  });
}

function getOutputPaths(finalUrlPath) {
  // GitHub Pages serves dist/404.html as the custom 404 page.
  if (finalUrlPath === "/404") {
    return {
      outDirPath: OUTPUT_DIR,
      outFilePath: path.join(OUTPUT_DIR, "404.html"),
    };
  }
  let outDirPath;
  if (finalUrlPath === "/") {
    outDirPath = OUTPUT_DIR;
  } else {
    outDirPath = path.join(OUTPUT_DIR, finalUrlPath.substring(1));
  }
  return { outDirPath, outFilePath: path.join(outDirPath, "index.html") };
}

function getFrontmatterValue(data, key) {
  const lowerKey = key.toLowerCase();
  for (const k of Object.keys(data)) {
    if (k.toLowerCase() === lowerKey) {
      return data[k];
    }
  }
  return undefined;
}

// ─── Article-aware title helpers ─────────────────────────────────────────────

// English articles stripped from the front of a title before alphabetic
// comparison.  Matching is case-insensitive; "A", "An", and "The" are the
// only English articles; "An" is tested before "A" to avoid a prefix match.
const ARTICLE_RE = /^(the|an|a)\s+/i;

// Returns the sort key for a title: leading article moved to end.
// "The law of Christ" → "law of Christ" (used only for comparisons)
function sortableTitle(title) {
  return title.replace(ARTICLE_RE, "").trim();
}

// ─── End Article-aware title helpers ─────────────────────────────────────────

async function build() {
  await ensureDir(OUTPUT_DIR);

  const fileMap = {};
  const partials = {}; // basename (lowercase) → body, from partial/
  const filesToProcess = [];
  // Exact lookups for link resolution: lowercase "dir/basename" and URL → file.
  const index = { byPath: {}, byUrl: {} };

  const imageMap = {};
  const assetFiles = [
    ...(await findAssetFiles(".")),
    ...(await findAssetFiles(TEMPLATE_DIR)),
  ];
  const assetsOutDir = path.join(OUTPUT_DIR, "asset");
  if (assetFiles.length > 0) {
    await ensureDir(assetsOutDir);
  }
  // Asset names are flat; when two files share a name (case-insensitively) the
  // later one wins, and the build warns.
  const assetsByName = new Map();
  for (const { filePath: assetPath, fileName: assetName } of assetFiles) {
    const lowerName = assetName.toLowerCase();
    const earlier = assetsByName.get(lowerName);
    if (earlier) {
      console.warn(
        `Warning: Asset filename collision — "${assetName}" from "${assetPath}" overwrites "${earlier.assetPath}"`,
      );
    }
    assetsByName.set(lowerName, { assetPath, assetName });
    if (IMAGE_EXTENSIONS.has(path.extname(assetName).toLowerCase())) {
      imageMap[lowerName] = `/asset/${assetName}`;
    }
  }
  await mapLimit([...assetsByName.values()], ({ assetPath, assetName }) =>
    fs.copyFile(assetPath, path.join(assetsOutDir, assetName)),
  );
  if (assetFiles.length > 0) {
    console.log(`Copied ${assetFiles.length} asset(s) to ${path.join(OUTPUT_DIR, "asset")}/`);
  }

  const mdFiles = await findMarkdownFiles(".");

  const sources = [];
  const contents = await mapLimit(mdFiles, ({ filePath }) =>
    fs.readFile(filePath, "utf-8"),
  );
  for (const [i, { filePath, relDir, fileName }] of mdFiles.entries()) {
    const content = contents[i];
    let parsed;
    try {
      parsed = matter(content);
    } catch (err) {
      console.warn(
        `Warning: Failed to parse frontmatter in "${filePath}" — skipping (${err.message})`,
      );
      continue;
    }

    const baseName = path.basename(fileName, ".md");

    // partial/ holds only partials: never pages, and any frontmatter is ignored.
    if (relDir === "partial") {
      partials[baseName.toLowerCase().trim()] = parsed.content;
      continue;
    }

    sources.push({ filePath, relDir, fileName, baseName, parsed });
  }

  // Pages get their URL from the permalink. A notes page lives one segment
  // below its page (/topic/foo → /topic/foo/notes), so pages go first.
  const pageUrls = {}; // pathKey → URL
  for (const src of sources) {
    if (notesParentDir(src.relDir) !== null) continue;
    const { relDir, baseName, parsed } = src;

    let permalink = getFrontmatterValue(parsed.data, "permalink");
    if (typeof permalink === "string") {
      permalink = permalink.replace(/^\/+/, "");
    }

    if (!permalink) {
      permalink = slugify(baseName, { lower: true, strict: true });
    }

    let finalUrlPath;
    if (relDir === "" && permalink === "home") {
      finalUrlPath = "/";
    } else if ((relDir === "" && permalink === "index") || permalink === "") {
      finalUrlPath = "/";
    } else {
      if (relDir === "") {
        finalUrlPath = `/${permalink}`;
      } else {
        finalUrlPath = `/${relDir}/${permalink}`;
      }
    }

    src.permalink = permalink;
    src.finalUrlPath = finalUrlPath;
    pageUrls[pathKey(relDir, baseName)] = finalUrlPath;
  }
  for (const src of sources) {
    const parentDir = notesParentDir(src.relDir);
    if (parentDir === null) continue;

    // Notes with no page of their own still get the URL the page would have.
    const slug = slugify(src.baseName, { lower: true, strict: true });
    const pageUrl =
      pageUrls[pathKey(parentDir, src.baseName)] ??
      (parentDir === "" ? `/${slug}` : `/${parentDir}/${slug}`);

    src.permalink = slug;
    src.finalUrlPath = `${pageUrl === "/" ? "" : pageUrl}/notes`;
  }

  for (const src of sources) {
    const { filePath, relDir, fileName, baseName, parsed, permalink, finalUrlPath } =
      src;
    const parentDir = notesParentDir(relDir);

    const key = baseName.toLowerCase().trim();
    if (!fileMap[key]) fileMap[key] = [];
    fileMap[key].push(finalUrlPath);

    // Also index by permalink slug so wikilinks can use the permalink as the
    // target (e.g. [[home]] finding "Home page.md" whose permalink is "home").
    const permKey = permalink.toLowerCase().trim();
    if (permKey && permKey !== key) {
      if (!fileMap[permKey]) fileMap[permKey] = [];
      if (!fileMap[permKey].includes(finalUrlPath))
        fileMap[permKey].push(finalUrlPath);
    }

    parsed.data.permalink = permalink;

    const title = getFrontmatterValue(parsed.data, "title") || baseName;
    if (!getFrontmatterValue(parsed.data, "title")) {
      parsed.data.title = baseName;
    }

    const hidden = !!getFrontmatterValue(parsed.data, "hidden");
    const rawAliases = getFrontmatterValue(parsed.data, "aliases");
    const aliases = parseNameList(rawAliases);
    const rawCategories = getFrontmatterValue(parsed.data, "categories");
    const categories = parseNameList(rawCategories);
    const featured = !!getFrontmatterValue(parsed.data, "featured");
    const rawFeaturedWith = getFrontmatterValue(parsed.data, "featured with");
    const featuredWith = rawFeaturedWith
      ? stripBrackets(String(rawFeaturedWith))
      : null;
    const draft = !!getFrontmatterValue(parsed.data, "draft");
    const unlisted = !!getFrontmatterValue(parsed.data, "unlisted");

    const fileInfo = {
      relDir,
      isNote: parentDir !== null,
      isCategory: relDir === "category",
      // The folder a page "belongs to": its own, or its notes folder's parent.
      nsDir: parentDir ?? relDir,
      fileName,
      filePath,
      baseName,
      permalink,
      finalUrlPath,
      parsed,
      title,
      hidden,
      aliases,
      categories,
      featured,
      featuredWith,
      draft,
      unlisted,
    };
    filesToProcess.push(fileInfo);
    index.byPath[pathKey(relDir, baseName)] = fileInfo;
    index.byUrl[finalUrlPath] = fileInfo;
  }

  const aliasRedirects = [];
  for (const fileInfo of filesToProcess) {
    if (fileInfo.aliases.length === 0) continue;
    for (const aliasName of fileInfo.aliases) {
      const aliasSlug = slugify(aliasName, { lower: true, strict: true });
      const aliasUrlPath =
        fileInfo.relDir === ""
          ? `/${aliasSlug}`
          : `/${fileInfo.relDir}/${aliasSlug}`;
      const aliasKey = aliasName.toLowerCase().trim();
      if (!fileMap[aliasKey]) fileMap[aliasKey] = [];
      if (!fileMap[aliasKey].includes(fileInfo.finalUrlPath))
        fileMap[aliasKey].push(fileInfo.finalUrlPath);
      if (!fileMap[aliasSlug]) fileMap[aliasSlug] = [];
      if (!fileMap[aliasSlug].includes(fileInfo.finalUrlPath))
        fileMap[aliasSlug].push(fileInfo.finalUrlPath);
      aliasRedirects.push({
        fromUrlPath: aliasUrlPath,
        toUrl: fileInfo.finalUrlPath,
        toTitle: fileInfo.title,
      });
    }
  }

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

  featuredPages.sort((a, b) =>
    sortableTitle(a.title).localeCompare(
      sortableTitle(b.title),
      undefined,
      { sensitivity: "base" },
    ),
  );
  draftPages.sort((a, b) =>
    sortableTitle(a.title).localeCompare(
      sortableTitle(b.title),
      undefined,
      { sensitivity: "base" },
    ),
  );

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
    arr.sort((a, b) =>
      sortableTitle(a.title).localeCompare(
        sortableTitle(b.title),
        undefined,
        { sensitivity: "base" },
      ),
    );
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

  const renderLayout = createLayout({
    template: await fs.readFile(TEMPLATE_PATH, "utf-8"),
    draftUrls,
    categoryUrls,
    asideUrls,
    featuredUrls,
    allKnownUrls,
  });

  // ─── Namespaces ───
  // Each top-level folder is a namespace with its own alphabetical index; root
  // pages are "meta". A namespace with nothing listed has no index page.
  // The keys set the menu order; the values are the menu labels.
  const NAMESPACES = {
    topic: "Topics",
    category: "Categories",
    commentary: "Commentaries",
    summary: "Summaries",
    meta: "Meta",
  };
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
    list.sort((a, b) =>
      sortableTitle(a.title).localeCompare(
        sortableTitle(b.title),
        undefined,
        { sensitivity: "base" },
      ),
    );
  }
  const listedNamespaces = Object.keys(NAMESPACES).filter(
    (ns) => alphabeticalByNs[ns].length > 0,
  );
  const nsName = (ns) => ns[0].toUpperCase() + ns.slice(1);

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
    arr.sort((a, b) =>
      sortableTitle(a.title).localeCompare(
        sortableTitle(b.title),
        undefined,
        { sensitivity: "base" },
      ),
    );
  }

  // ── End Backlinks pre-pass ───────────────────────────────────────────────────

  const searchDocs = [];

  const output = await createOutput();

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;

    let markdownContent = expandPartials(fileInfo.parsed.content, partials);

    markdownContent = markdownContent.replace(
      /(!?)\[\[(.*?)\]\]/g,
      (match, bang, inner) => {
        const isEmbed = bang === "!";
        let target = inner;
        let text = inner;
        if (inner.includes("|")) {
          const parts = inner.split("|");
          target = parts[0];
          text = parts.slice(1).join("|");
        }

        let searchTarget = target.trim();

        const ext = path.extname(searchTarget).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const imgUrl = imageMap[searchTarget.toLowerCase()] || searchTarget;
          if (isEmbed) {
            let attrs = "";
            const dimMatch = text.match(/^(\d+)(?:x(\d+))?$/);
            if (dimMatch) {
              attrs += ` width="${dimMatch[1]}"`;
              if (dimMatch[2]) attrs += ` height="${dimMatch[2]}"`;
              return `<figure><img src="${imgUrl}" alt="${searchTarget}"${attrs}></figure>`;
            }
            const alt = text === inner ? searchTarget : text;
            return `<figure><img src="${imgUrl}" alt="${alt}"></figure>`;
          } else {
            const linkText = text === inner ? searchTarget : text;
            return `[${linkText}](${imgUrl})`;
          }
        }

        if (searchTarget.toLowerCase().endsWith(".md")) {
          searchTarget = searchTarget.substring(0, searchTarget.length - 3);
        }

        const resolved = resolveLink(searchTarget, fileMap, index, fileInfo.nsDir);
        if (resolved.shadowed) {
          console.warn(
            `Warning: Bare wikilink "${searchTarget}" in "${fileInfo.filePath}" matches several pages — using ${resolved.url}; qualify it`,
          );
        }
        if (resolved.url) {
          return `[${text}](${resolved.url})`;
        }
        if (resolved.ambiguous) {
          console.warn(
            `Warning: Ambiguous wikilink — "${searchTarget}" matches multiple files`,
          );
          return `<span class="broken">${text}</span>`;
        }
        return `<span class="broken">${text}</span>`;
      },
    );

    try {
      markdownContent = ejs.render(markdownContent, {
        frontmatter: fileInfo.parsed.data,
        fileMap,
        imageMap,
      });
    } catch (err) {
      console.warn(
        `Warning: EJS render error in "${fileInfo.filePath}" — ${err.message}`,
      );
      markdownContent = `<!-- EJS render error in: ${fileInfo.fileName} -->`;
    }

    markdownContent = markdownContent.replace(/%%[\s\S]*?%%/g, "");

    markdownContent = markdownContent.replace(
      /(?<!~)~(?!~)([^~\n]+?)(?<!~)~(?!~)/g,
      "<small>$1</small>",
    );

    markdownContent = protectFencedAttrs(markdownContent);
    const htmlContent = md.render(markdownContent);

    const resolvedCategories = fileInfo.categories.map((catName) => {
      const target = findCategory(index, catName);
      return target
        ? { title: target.title, url: target.finalUrlPath }
        : {
            title: catName,
            url: `/${slugify(catName, { lower: true, strict: true })}`,
          };
    });

    const allMembers = membersMap[fileInfo.finalUrlPath] || [];
    const subcategories = [];
    const pages = [];
    for (const member of allMembers) {
      if (categoryUrls.has(member.url)) {
        subcategories.push(member);
      } else {
        pages.push(member);
      }
    }

    const finalHtml = renderLayout(htmlContent, {
      url: fileInfo.finalUrlPath,
      frontmatter: fileInfo.parsed.data,
      // The page's folder names its namespace: "topic" → "Topic page". Root pages: "Meta page".
      nsLabel: `${nsName(fileInfo.nsDir || "meta")} page`,
      isNote: fileInfo.isNote,
      notePage: pageByNotes[fileInfo.finalUrlPath] || null,
      noteUrl: notesByPage[fileInfo.finalUrlPath] || null,
      categories: resolvedCategories,
      subcategories,
      pages,
      featuredWith: fileInfo.featuredWith || null,
      featured: fileInfo.featured || false,
    });

    const { outFilePath } = getOutputPaths(fileInfo.finalUrlPath);
    // Notes pages, category pages and unlisted pages stay out of the Scripture index.
    await output.emitPage(
      outFilePath,
      finalHtml,
      fileInfo.unlisted ||
        categoryUrls.has(fileInfo.finalUrlPath) ||
        asideUrls.has(fileInfo.finalUrlPath)
        ? null
        : { url: fileInfo.finalUrlPath, title: fileInfo.title },
    );
    console.log(
      `Built: ${fileInfo.filePath} -> ${outFilePath} (URL: ${fileInfo.finalUrlPath})`,
    );

    if (!fileInfo.unlisted) {
      const bodyText = htmlContent
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      searchDocs.push({
        id: fileInfo.finalUrlPath,
        title: fileInfo.title,
        url: fileInfo.finalUrlPath,
        body: bodyText.slice(0, 5000),
      });
    }
  }

  for (const { fromUrlPath, toUrl, toTitle } of aliasRedirects) {
    const redirectHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${toUrl}">
  <link rel="canonical" href="${toUrl}">
  <title>Redirecting to ${toTitle}</title>
</head>
<body>
  <p>Redirecting to <a href="${toUrl}">${toTitle}</a>...</p>
</body>
</html>`;
    const { outFilePath } = getOutputPaths(fromUrlPath);
    await output.emit(outFilePath, redirectHtml);
    console.log(`Built (alias redirect): ${fromUrlPath} -> ${toUrl}`);
  }

  // ── Backlinks sub-pages ──────────────────────────────────────────────────────
  // Generate a /pageurl/backlinks page for every non-hidden content page.

  // Minimal HTML escaper for inline text/attribute interpolation.
  const escHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  let backlinksPageCount = 0;
  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;

    const pageUrl = fileInfo.finalUrlPath;
    const blUrl = pageUrl === "/" ? "/backlinks" : `${pageUrl}/backlinks`;
    const inbound = backlinksMap[pageUrl] || [];

    let listHtml;
    if (inbound.length === 0) {
      listHtml = "<p>No pages link to this page.</p>";
    } else {
      listHtml =
        "<ul>\n" +
        inbound
          .map(
            (b) => `  <li><a href="${escHtml(b.url)}">${escHtml(b.title)}</a></li>`,
          )
          .join("\n") +
        "\n</ul>";
    }

    const blHtml = renderLayout(listHtml, {
      url: blUrl,
      frontmatter: {
        title: `Backlinks \u2014 ${fileInfo.title}`,
        permalink: blUrl.replace(/^\//, ""),
      },
    });

    const { outFilePath } = getOutputPaths(blUrl);
    await output.emit(outFilePath, blHtml);
    backlinksPageCount++;
  }
  console.log(
    `Backlinks pages: generated ${backlinksPageCount} page(s) (${Object.values(backlinksMap).reduce((s, a) => s + a.length, 0)} total inbound link(s) recorded).`,
  );
  // ── End Backlinks sub-pages ──────────────────────────────────────────────────

  // pagesWithCategories: URLs of pages that have categories themselves
  // (i.e. they belong to a parent category, so they appear as subcategories).
  const pagesWithCategories = new Set();
  for (const fileInfo of filesToProcess) {
    if (fileInfo.categories.length > 0) {
      pagesWithCategories.add(fileInfo.finalUrlPath);
    }
  }

  const topLevelCategoryPages = filesToProcess
    .filter(
      (fi) =>
        fi.isCategory &&
        !fi.hidden &&
        !fi.unlisted &&
        !pagesWithCategories.has(fi.finalUrlPath),
    )
    .map((fi) => ({ title: fi.title, url: fi.finalUrlPath }))
    .sort((a, b) =>
      sortableTitle(a.title).localeCompare(
        sortableTitle(b.title),
        undefined,
        { sensitivity: "base" },
      ),
    );

  const indexPages = [
    ...listedNamespaces.map((ns) => ({
      slug: `alphabetical/${ns}`,
      title: `Alphabetical index: ${nsName(ns)} pages`,
      items: alphabeticalByNs[ns],
      menuNs: ns,
    })),
    {
      slug: "categorical",
      title: "Categorical index",
      items: topLevelCategoryPages,
    },
    { slug: "featured", title: "Featured topics", items: featuredPages },
    { slug: "drafts", title: "Drafts", items: draftPages },
  ];

  for (const indexPage of indexPages) {
    let listHtml = "";
    if (indexPage.menuNs) {
      listHtml += '<ul class="namespace-menu">\n';
      for (const ns of listedNamespaces) {
        listHtml +=
          ns === indexPage.menuNs
            ? `  <li class="selected">${NAMESPACES[ns]}</li>\n`
            : `  <li><a href="/index/alphabetical/${ns}">${NAMESPACES[ns]}</a></li>\n`;
      }
      listHtml += "</ul>\n";
    }
    if (indexPage.items.length === 0) {
      listHtml += "<p>No pages yet.</p>";
    } else {
      listHtml += "<ul>\n";
      for (const item of indexPage.items) {
        if (item.redirect) {
          listHtml += `  <li>${item.title} <small>(see <a href="${item.redirect.url}">${item.redirect.title}</a>)</small></li>\n`;
        } else {
          const starHtml =
            indexPage.menuNs && item.featured
              ? ' <span class="featured-badge fa-sharp fa-solid fa-star"></span>'
              : "";
          let withHtml = "";
          if (indexPage.slug === "featured") {
            const secondaries = featuredWithMap[item.url];
            if (secondaries && secondaries.length > 0) {
              const parts = secondaries.map(
                (w) => `<a href="${w.url}">${w.title}</a>`,
              );
              withHtml = ` <small>(and ${parts.join(", ")})</small>`;
            }
          }
          listHtml += `  <li><a href="${item.url}">${item.title}</a>${starHtml}${withHtml}</li>\n`;
        }
      }
      listHtml += "</ul>";
    }

    const html = renderLayout(listHtml, {
      url: `/index/${indexPage.slug}`,
      frontmatter: { title: indexPage.title, permalink: indexPage.slug },
    });

    await output.emit(path.join(OUTPUT_DIR, "index", indexPage.slug, "index.html"), html);
    console.log(`Built (index): /index/${indexPage.slug}`);
  }

  // /index/alphabetical is a stub that sends visitors to the Topic index.
  {
    const toUrl = "/index/alphabetical/topic";
    await output.emit(
      path.join(OUTPUT_DIR, "index", "alphabetical", "index.html"),
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=${toUrl}">
  <link rel="canonical" href="${toUrl}">
  <title>Redirecting to the alphabetical index</title>
</head>
<body>
  <p>Redirecting to the <a href="${toUrl}">alphabetical index</a>...</p>
</body>
</html>`,
    );
    console.log(`Built (index): /index/alphabetical -> ${toUrl}`);
  }

  await fs.writeFile(
    path.join(OUTPUT_DIR, "search-index.json"),
    JSON.stringify(searchDocs),
  );
  console.log(`Built search index: ${searchDocs.length} document(s)`);

  const searchJs = `(function() {
  var index = null;
  var docs = null;
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");

  function render(hits) {
    if (!hits.length) {
      results.innerHTML = input.value.trim() ? "<p>No results found.</p>" : "";
      return;
    }
    var html = "<ul>";
    for (var i = 0; i < hits.length; i++) {
      html += '<li><a href="' + hits[i].url + '">' + hits[i].title + '</a></li>';
    }
    html += "</ul>";
    results.innerHTML = html;
  }

  function doSearch() {
    if (!index) return;
    var q = input.value.trim();
    var url = new URL(window.location);
    if (q) {
      url.searchParams.set("q", q);
    } else {
      url.searchParams.delete("q");
    }
    history.replaceState(null, "", url);
    if (!q) { render([]); return; }
    var hits = index.search(q, { prefix: true, fuzzy: 0.2, boost: { title: 2 } });
    var mapped = [];
    for (var i = 0; i < hits.length; i++) {
      var doc = docs.find(function(d) { return d.id === hits[i].id; });
      if (doc) mapped.push({ title: doc.title, url: doc.url });
    }
    render(mapped);
  }

  fetch("/search-index.json")
    .then(function(r) { return r.json(); })
    .then(function(data) {
      docs = data;
      index = new MiniSearch({ fields: ["title", "body"], storeFields: ["title", "url"] });
      index.addAll(docs);
      var params = new URLSearchParams(window.location.search);
      var q = params.get("q");
      if (q) { input.value = q; }
      doSearch();
    });

  input.addEventListener("input", doSearch);
})();
`;
  await fs.writeFile(path.join(OUTPUT_DIR, "search.js"), searchJs);

  const searchContent = `<div id="search-page">
  <input type="text" id="search-input" placeholder="Search…" autofocus>
  <div id="search-results"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/minisearch@7/dist/umd/index.min.js"><\/script>
<script src="/search.js"><\/script>`;

  const searchHtml = renderLayout(searchContent, {
    url: "/search",
    frontmatter: { title: "Search", permalink: "search" },
  });

  await output.emit(path.join(OUTPUT_DIR, "search", "index.html"), searchHtml);
  console.log("Built: /search");

  // Randomizer page — picks a random content page and redirects immediately
  const randomUrls = listedNamespaces
    .filter((ns) => ns !== "category")
    .flatMap((ns) => alphabeticalByNs[ns])
    .filter((item) => item.url) // exclude alias redirect stubs
    .map((item) => item.url);
  const randomContent = `<script>
  (function() {
    var pages = ${JSON.stringify(randomUrls)};
    if (!pages.length) { return; }
    window.location.replace(pages[Math.floor(Math.random() * pages.length)]);
  })();
  <\/script>
  <div><p><em>The lot is cast into the lap, but its every decision is from the <abbr>LORD</abbr>.<br><small>—Proverbs 16:33</small></em></p></div>
  <noscript><div><p>JavaScript is required for this feature. <a href="/index/alphabetical">Browse the index</a> instead.</p></div></noscript>`;
  const randomHtml = renderLayout(randomContent, {
    url: "/random",
    frontmatter: { title: "Random page", permalink: "random" },
  });
  await output.emit(path.join(OUTPUT_DIR, "random", "index.html"), randomHtml);
  console.log(`Built: /random (${randomUrls.length} page(s))`);

  await fs.writeFile(path.join(OUTPUT_DIR, ".nojekyll"), "");

  // ── Scripture Index ────────────────────────────────────────────────────────
  console.log(
    `Scripture collector: ${output.refs.length} ref(s) from ${output.pageCount()} page(s).`,
  );

  // Group refs by book, then by canonical ref key (for deduplication).
  // refsByBook: Map<bookIndex, { bookSlug, bookName, entryMap }>
  // entryMap:   Map<entryKey, { chapterNum, verseStart, rangeVal, endVerse,
  //                             displayShort, occMap }>
  // occMap:     Map<occKey, { pageUrl, pageTitle, sectionId, sectionTitle }>
  const refsByBook = new Map();
  for (const ref of output.refs) {
    let bookData = refsByBook.get(ref.bookIndex);
    if (!bookData) {
      bookData = {
        bookSlug: ref.bookSlug,
        bookName: ref.bookName,
        bookCwms: ref.bookCwms,
        entryMap: new Map(),
      };
      refsByBook.set(ref.bookIndex, bookData);
    }
    const entryKey = `${ref.chapterNum}|${ref.verseStart ?? ""}|${ref.rangeVal ?? ""}|${ref.endVerse ?? ""}|${ref.endChapter ?? ""}`;
    let entry = bookData.entryMap.get(entryKey);
    if (!entry) {
      entry = {
        chapterNum: ref.chapterNum,
        verseStart: ref.verseStart,
        rangeVal: ref.rangeVal,
        endVerse: ref.endVerse,
        displayShort: ref.displayShort,
        occMap: new Map(),
      };
      bookData.entryMap.set(entryKey, entry);
    }
    // Collapse multiple occurrences of the same ref on the same page+section
    const occKey = `${ref.pageUrl}|${ref.sectionId ?? ""}`;
    if (!entry.occMap.has(occKey)) {
      entry.occMap.set(occKey, {
        pageUrl: ref.pageUrl,
        pageTitle: ref.pageTitle,
        sectionId: ref.sectionId,
        sectionTitle: ref.sectionTitle,
      });
    }
  }

  // Referenced books in canonical (Genesis → Revelation) order
  const referencedBooks = [...refsByBook.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, bookData]) => bookData);

  const scriptureRootDir = path.join(OUTPUT_DIR, "index", "scripture");

  // Root page: /index/scripture — lists all referenced books
  {
    let listHtml =
      referencedBooks.length === 0
        ? "<p>No Scripture references found.</p>"
        : "<ul>\n" +
          referencedBooks
            .map(
              (b) =>
                `  <li><a href="/index/scripture/${b.bookSlug}">${b.bookName}</a></li>`,
            )
            .join("\n") +
          "\n</ul>";
    const rootHtml = renderLayout(listHtml, {
      url: "/index/scripture",
      frontmatter: { title: "Scripture index", permalink: "scripture" },
    });
    await output.emit(path.join(scriptureRootDir, "index.html"), rootHtml);
    allKnownUrls.add("/index/scripture");
    console.log("Built (index): /index/scripture");
  }

  // Per-book pages: /index/scripture/{book-slug}
  for (const book of referencedBooks) {
    const entries = [...book.entryMap.values()];
    // Sort canonically: chapter → verse (chapter-only before verse) → range
    entries.sort((a, b) => {
      if (a.chapterNum !== b.chapterNum) return a.chapterNum - b.chapterNum;
      const vsA = a.verseStart ?? -1;
      const vsB = b.verseStart ?? -1;
      if (vsA !== vsB) return vsA - vsB;
      const rvA = a.rangeVal !== undefined ? parseInt(a.rangeVal) : -1;
      const rvB = b.rangeVal !== undefined ? parseInt(b.rangeVal) : -1;
      if (rvA !== rvB) return rvA - rvB;
      const evA = a.endVerse !== undefined ? parseInt(a.endVerse) : -1;
      const evB = b.endVerse !== undefined ? parseInt(b.endVerse) : -1;
      return evA - evB;
    });

    let listHtml = "<dl>\n";
    for (const entry of entries) {
      const innerItems = [...entry.occMap.values()]
        .map((occ) => {
          const href = occ.sectionId
            ? `${occ.pageUrl}#${occ.sectionId}`
            : occ.pageUrl;
          const label =
            occ.sectionId && occ.sectionTitle
              ? `<span class="page-title">${occ.pageTitle}</span>&nbsp;&rsaquo; <span class="section-title">${occ.sectionTitle}</span>`
              : `<span class="page-title">${occ.pageTitle}</span>`;
          return `<li><a href="${href}">${label}</a></li>`;
        })
        .join("\n");
      listHtml += `<dt class="scripture-reference">${book.bookCwms} ${entry.displayShort}</dt>\n<dd>\n<ul>\n${innerItems}\n</ul>\n</dd>\n`;
    }
    listHtml += "</dl>";

    const bookHtml = renderLayout(listHtml, {
      url: `/index/scripture/${book.bookSlug}`,
      frontmatter: {
        title: `Scripture index: ${book.bookName}`,
        permalink: book.bookSlug,
      },
    });
    await output.emit(path.join(scriptureRootDir, book.bookSlug, "index.html"), bookHtml);
    allKnownUrls.add(`/index/scripture/${book.bookSlug}`);
    console.log(`Built (index): /index/scripture/${book.bookSlug}`);
  }

  // ── End Scripture Index ────────────────────────────────────────────────────

  await output.finish();
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// press [build]  build the site (what CI runs)
// press serve    build, then serve the output locally (see serve.js)

const command = process.argv[2] ?? "build";
if (command !== "build" && command !== "serve") {
  console.error("Usage: press [build|serve]");
  process.exit(1);
}

try {
  await build();
} catch (err) {
  console.error("Build failed:", err);
  process.exit(1);
}

if (command === "serve") {
  try {
    const { serve } = await import("./serve.js");
    await serve(OUTPUT_DIR);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
