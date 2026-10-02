#!/usr/bin/env node
import { execFileSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import slugify from "slugify";
import { createLayout } from "./lib/layout.js";
import { findCategory } from "./lib/links.js";
import { buildModel, nsName } from "./lib/model.js";
import { createOutput } from "./lib/output.js";
import { writeBacklinksPages } from "./lib/pages/backlinks.js";
import { writeIndexes } from "./lib/pages/indexes.js";
import { writeRandom } from "./lib/pages/random.js";
import { writeAliasRedirects } from "./lib/pages/redirects.js";
import { writeScriptureIndex } from "./lib/pages/scripture.js";
import { writeSearch } from "./lib/pages/search.js";
import { renderBody } from "./lib/render.js";
import { copyAssets, loadVault } from "./lib/vault.js";

// The vault (content) is the working directory; the template ships with tsgen.
// Output goes to ./dist unless TSGEN_OUT names another directory (local use
// only, e.g. to keep build output out of the iCloud-synced vault; CI sets nothing).
const OUTPUT_DIR = process.env.TSGEN_OUT
  ? path.resolve(process.env.TSGEN_OUT)
  : "dist";
const TEMPLATE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "template",
);
const TEMPLATE_PATH = path.join(TEMPLATE_DIR, "layout.ejs");

// ─── Cache-buster ───
// The content repo's commit (CI sets GITHUB_SHA; locally, the vault's HEAD), so
// assets are refetched exactly when a deploy changes something. Without a repo,
// one timestamp for the whole build.
function cacheBuster() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return String(Math.floor(Date.now() / 1000));
  }
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
    cacheBust: cacheBuster(),
  });

  const searchDocs = [];

  const output = await createOutput({ outputDir: OUTPUT_DIR });

  for (const fileInfo of filesToProcess) {
    if (fileInfo.hidden) continue;

    const htmlContent = renderBody(fileInfo, { partials, fileMap, index, imageMap });

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
      backlinksUrl: fileInfo.finalUrlPath === "/" ? "/backlinks" : `${fileInfo.finalUrlPath}/backlinks`,
      categories: resolvedCategories,
      subcategories,
      pages,
      featuredWith: fileInfo.featuredWith || null,
      featured: fileInfo.featured || false,
    });

    const outFilePath = output.fileFor(fileInfo.finalUrlPath);
    // Notes pages, category pages and unlisted pages stay out of the Scripture index.
    await output.emitPage(
      fileInfo.finalUrlPath,
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

  await writeAliasRedirects({ output, aliasRedirects });

  await writeBacklinksPages({ output, renderLayout, filesToProcess, backlinksMap });
  await writeIndexes({
    output,
    renderLayout,
    filesToProcess,
    listedNamespaces,
    alphabeticalByNs,
    featuredPages,
    draftPages,
    featuredWithMap,
  });
  await writeSearch({ output, renderLayout, searchDocs });
  await writeRandom({ output, renderLayout, listedNamespaces, alphabeticalByNs });
  await output.writeFile(".nojekyll", "");
  await writeScriptureIndex({ output, renderLayout });

  await output.finish();
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
// tsgen [build]  build the site (what CI runs)
// tsgen serve    build, then serve the output locally (see serve.js)

const command = process.argv[2] ?? "build";
if (command !== "build" && command !== "serve") {
  console.error("Usage: tsgen [build|serve]");
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
