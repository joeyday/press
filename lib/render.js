import path from "path";
import ejs from "ejs";
import { resolveLink } from "./links.js";
import { md, protectFencedAttrs } from "./markdown.js";
import { expandPartials } from "./partials.js";
import { IMAGE_EXTENSIONS } from "./vault.js";

// Renders one page's Markdown source to HTML (no layout): partials, wikilinks,
// body EJS, comments, small text, then markdown-it. These are plain text passes
// over the raw Markdown, so they also apply inside code spans and blocks.
export function renderBody(fileInfo, { partials, fileMap, index, imageMap }) {
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
  return htmlContent;
}
