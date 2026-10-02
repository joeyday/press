import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import slugify from "slugify";
import { BuildError } from "./errors.js";
import { mapLimit } from "./io.js";
import { notesParentDir, parseNameList, pathKey, stripBrackets } from "./links.js";

// Reading the vault: finding files, copying assets, and turning each Markdown
// file into a page record. The vault is the working directory.

const SKIP_FILES = new Set(["replit.md"]);
const ASSET_SKIP_FILES = new Set(["build.js"]);

// Folders that may hold Markdown (vault-relative, "/"-separated).
const PAGE_DIRS = ["topic", "category", "commentary", "summary"];
const KNOWN_DIRS = new Set([
  "",
  "notes",
  "partial",
  ...PAGE_DIRS,
  ...PAGE_DIRS.map((d) => `${d}/notes`),
]);

// Directories the scans never enter (dot-prefixed ones are skipped too).
function skipDirs(outputDir, extra = []) {
  return new Set([
    "node_modules",
    "dist",
    path.basename(outputDir),
    ".git",
    ".github",
    ".local",
    ...extra,
  ]);
}

export const IMAGE_EXTENSIONS = new Set([
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
      // iCloud leaves ".Name.md.icloud" for a file that isn't downloaded; the
      // build would silently drop that page or image.
      if (entry.name.endsWith(".icloud")) {
        throw new BuildError(
          `"${fullPath}" isn't downloaded from iCloud; download it and build again`,
        );
      }
      const item = filter(entry, fullPath, rootDir);
      if (item) results.push(item);
    }
  }
  return results;
}

function findMarkdownFiles(dir, outputDir) {
  return findFiles(dir, {
    skipDirs: skipDirs(outputDir, ["template"]),
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

function findAssetFiles(dir, outputDir) {
  return findFiles(dir, {
    skipDirs: skipDirs(outputDir),
    filter: (entry, fullPath) => {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ASSET_EXTENSIONS.has(ext)) return null;
      if (ASSET_SKIP_FILES.has(entry.name)) return null;
      return { filePath: fullPath, fileName: entry.name };
    },
  });
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

// Copies the vault's and the template's assets flat into <outputDir>/asset/.
// Returns the image map: lowercase filename → URL.
export async function copyAssets({ outputDir, templateDir }) {
  const imageMap = {};
  const assetFiles = [
    ...(await findAssetFiles(".", outputDir)),
    ...(await findAssetFiles(templateDir, outputDir)),
  ];
  const assetsOutDir = path.join(outputDir, "asset");
  if (assetFiles.length > 0) {
    await fs.mkdir(assetsOutDir, { recursive: true });
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
    console.log(`Copied ${assetFiles.length} asset(s) to ${path.join(outputDir, "asset")}/`);
  }
  return imageMap;
}

// Reads every Markdown file into a page record. partial/ files go to
// `partials` instead and are never pages.
export async function loadVault({ outputDir }) {
  const fileMap = {};
  const partials = {}; // basename (lowercase) → body, from partial/
  const filesToProcess = [];
  // Exact lookups for link resolution: lowercase "dir/basename" and URL → file.
  const index = { byPath: {}, byUrl: {} };

  const mdFiles = await findMarkdownFiles(".", outputDir);

  // Markdown lives in the root, in the page folders, and in a notes/ folder
  // next to each (the root's included). Anything else is a mistake.
  const unknownDirs = new Set(
    mdFiles.map((f) => f.relDir).filter((d) => !KNOWN_DIRS.has(d)),
  );
  if (unknownDirs.size > 0) {
    throw new BuildError(
      `Markdown in unknown folder(s): ${[...unknownDirs].map((d) => `"${d}"`).join(", ")}. ` +
        `Pages belong in the root or in ${PAGE_DIRS.join("/, ")}/ (with notes in a notes/ folder beside them); partials in partial/.`,
    );
  }

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

  // Two pages at one URL: the later would silently replace the earlier.
  const sourceByUrl = new Map();
  const collisions = [];
  for (const src of sources) {
    if (getFrontmatterValue(src.parsed.data, "hidden")) continue;
    const earlier = sourceByUrl.get(src.finalUrlPath);
    if (earlier) {
      collisions.push(
        `"${earlier.filePath}" and "${src.filePath}" both build ${src.finalUrlPath}`,
      );
    }
    sourceByUrl.set(src.finalUrlPath, src);
  }
  if (collisions.length > 0) throw new BuildError(collisions.join("\n"));

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

  // Aliases belong to the page. Each also redirects the page's notes page
  // (/topic/alias/notes → /topic/foo/notes) when it has one, so a notes page
  // has no aliases of its own. Hidden pages build nothing, so they get no stubs.
  const aliasRedirects = [];
  const redirectByUrl = new Map();
  const problems = [];
  const addRedirect = (fromUrlPath, toUrl, toTitle, who) => {
    const page = index.byUrl[fromUrlPath];
    const earlier = redirectByUrl.get(fromUrlPath);
    if (page && !page.hidden) {
      problems.push(`Alias of "${who}" would replace the page "${page.filePath}" at ${fromUrlPath}`);
    } else if (earlier && earlier.toUrl !== toUrl) {
      problems.push(`Aliases of "${who}" and "${earlier.who}" both redirect ${fromUrlPath}`);
    } else if (!earlier) {
      const redirect = { fromUrlPath, toUrl, toTitle };
      redirectByUrl.set(fromUrlPath, { toUrl, who });
      aliasRedirects.push(redirect);
    }
  };
  for (const fileInfo of filesToProcess) {
    if (fileInfo.aliases.length === 0) continue;
    if (fileInfo.isNote) {
      problems.push(
        `"${fileInfo.filePath}" is a notes page and can't have aliases; give them to its page`,
      );
      continue;
    }
    const notes = index.byUrl[`${fileInfo.finalUrlPath === "/" ? "" : fileInfo.finalUrlPath}/notes`];
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
      if (fileInfo.hidden) continue;
      addRedirect(aliasUrlPath, fileInfo.finalUrlPath, fileInfo.title, fileInfo.filePath);
      if (notes?.isNote && !notes.hidden) {
        addRedirect(`${aliasUrlPath}/notes`, notes.finalUrlPath, notes.title, fileInfo.filePath);
      }
    }
  }
  if (problems.length > 0) throw new BuildError(problems.join("\n"));

  return { fileMap, partials, filesToProcess, index, aliasRedirects };
}
