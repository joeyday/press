#!/usr/bin/env node
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ejs from "ejs";
import slugify from "slugify";
import { findCategory, pathKey, resolveLink } from "./lib/links.js";
import { createLayout } from "./lib/layout.js";
import { md, protectFencedAttrs } from "./lib/markdown.js";
import { createOutput } from "./lib/output.js";
import { NAMESPACES, buildModel, nsName } from "./lib/model.js";
import { compareTitles } from "./lib/titles.js";
import { expandPartials } from "./lib/partials.js";
import { IMAGE_EXTENSIONS, copyAssets, loadVault } from "./lib/vault.js";

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

async function build() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const imageMap = await copyAssets({
    outputDir: OUTPUT_DIR,
    templateDir: TEMPLATE_DIR,
  });
  const { fileMap, partials, filesToProcess, index, aliasRedirects } =
    await loadVault({ outputDir: OUTPUT_DIR });

  const {
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
  } = buildModel({ filesToProcess, index, fileMap, partials, imageMap, aliasRedirects });

  const renderLayout = createLayout({
    template: await fs.readFile(TEMPLATE_PATH, "utf-8"),
    draftUrls,
    categoryUrls,
    asideUrls,
    featuredUrls,
    allKnownUrls,
  });

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
    .sort(compareTitles);

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
