import fs from "fs/promises";
import path from "path";
import { createWriter } from "./io.js";
import { collectBibleRefsFromHtml } from "./bible/collect.js";
import { linkBibleRefs } from "./bible/link.js";
import {
  addHeadingIds,
  applyAltText,
  fixSpacedEllipses,
  makeAbbreviationWrapper,
  wrapDivineNames,
  wrapInitials,
  wrapRomanNumerals,
} from "./html/passes.js";

// Reads a JSON object of { key: value } from the working directory, or returns
// null (with a note in the log) when the file is missing or malformed.
async function loadJsonMap(file, label) {
  let raw;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch {
    console.log(`${label}: ${file} not found, skipping.`);
    return null;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.log(`${label}: ${file} is not valid JSON, skipping.`);
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    console.log(`${label}: ${file} must be a JSON object, skipping.`);
    return null;
  }
  return data;
}

// Every HTML file goes through the post-passes in memory and is written once.
// Heading IDs come first so the Scripture collector can link to sections; the
// collector runs before the Bible-ref linker, which would hide the refs inside
// <a> tags.
//
//   emit(url, html)             any generated page, at the file its URL maps to
//   emitPage(url, html, from)   a content page; from is { url, title } if its
//                               Bible refs belong in the Scripture index
//   writeFile(relPath, data)    any other file under the output directory
//   fileFor(url)                the file a URL is written to
//   refs                        the collected refs
//   finish()                    waits for the writes, logs the pass counts
export async function createOutput({ outputDir }) {
  const abbrMap = await loadJsonMap("abbreviations.json", "Abbreviation expander");
  const altMap = await loadJsonMap("alt-text.json", "Alt text injector");
  const wrapAbbreviations =
    abbrMap && Object.keys(abbrMap).length > 0
      ? makeAbbreviationWrapper(abbrMap)
      : null;
  const useAlt = altMap && Object.keys(altMap).length > 0;

  const writer = createWriter();
  const refs = [];
  let files = 0;
  let pages = 0;
  const rewrites = {};

  // /foo is written to foo/index.html; / to index.html. GitHub Pages serves
  // 404.html as the custom 404 page.
  function fileFor(url) {
    if (url === "/404") return path.join(outputDir, "404.html");
    const dir = url === "/" ? outputDir : path.join(outputDir, url.substring(1));
    return path.join(dir, "index.html");
  }

  // The <title> is plain text; the passes would put markup in it (a span in a
  // tab title). Park it behind a comment, which every pass already skips.
  const TITLE_RE = /<title>[\s\S]*?<\/title>/i;
  const TITLE_SLOT = "<!--tsgen-title-->";

  async function process(url, html, collectFrom) {
    const title = TITLE_RE.exec(html)?.[0];
    let out = title ? html.replace(TITLE_RE, TITLE_SLOT) : html;
    const pass = (name, fn) => {
      const next = fn(out);
      if (next !== out) rewrites[name] = (rewrites[name] ?? 0) + 1;
      out = next;
    };
    pass("Heading IDs", addHeadingIds);
    if (collectFrom) {
      refs.push(...collectBibleRefsFromHtml(out, collectFrom.url, collectFrom.title));
    }
    pass("Bible ref linker", linkBibleRefs);
    if (wrapAbbreviations) pass("Abbreviation expander", wrapAbbreviations);
    pass("Initials wrapper", wrapInitials);
    pass("Roman numeral wrapper", wrapRomanNumerals);
    pass("Divine name wrapper", wrapDivineNames);
    pass("Ellipsis normaliser", fixSpacedEllipses);
    if (useAlt) pass("Alt text injector", (h) => applyAltText(h, altMap));
    if (title) out = out.replace(TITLE_SLOT, () => title);
    files++;
    await writer.write(fileFor(url), out);
  }

  return {
    refs,
    fileFor,
    emit: (url, html) => process(url, html, null),
    emitPage(url, html, collectFrom) {
      pages++;
      return process(url, html, collectFrom);
    },
    writeFile: (relPath, data) => writer.write(path.join(outputDir, relPath), data),
    pageCount: () => pages,
    async finish() {
      await writer.flush();
      for (const [name, count] of Object.entries(rewrites)) {
        console.log(`${name}: processed ${files} HTML file(s), rewrote ${count}.`);
      }
    },
  };
}
