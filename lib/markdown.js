import markdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import markdownItMark from "markdown-it-mark";
import markdownItContainer from "markdown-it-container";
import markdownItBracketedSpans from "markdown-it-bracketed-spans";
import markdownItAttrs from "markdown-it-attrs";

function parseFencedAttrs(info) {
  const attrs = { classes: [], id: null, other: {} };
  if (!info) return attrs;
  const m = info.match(/^\x01(.*)\x01$/);
  if (!m) {
    attrs.classes.push(info);
    return attrs;
  }
  const tokens = m[1].match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  for (const token of tokens) {
    if (token.startsWith(".")) {
      attrs.classes.push(token.slice(1));
    } else if (token.startsWith("#")) {
      attrs.id = token.slice(1);
    } else if (token.includes("=")) {
      const eq = token.indexOf("=");
      const key = token.slice(0, eq);
      let val = token.slice(eq + 1);
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      attrs.other[key] = val;
    }
  }
  return attrs;
}

export function protectFencedAttrs(text) {
  return text.replace(
    /^(:::)\s*\{([^}]+)\}/gm,
    (m, colons, content) => colons + "\x01" + content + "\x01",
  );
}

export const md = markdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
})
  .enable("strikethrough")
  .use(markdownItFootnote)
  .use(markdownItMark)
  .use(markdownItBracketedSpans)
  .use(markdownItContainer, "", {
    validate: () => true,
    render(tokens, idx) {
      const info = tokens[idx].info.trim();
      if (tokens[idx].nesting === 1) {
        if (!info) return "<div>\n";
        const parsed = parseFencedAttrs(info);
        let tag = "<div";
        if (parsed.id) tag += ` id="${parsed.id}"`;
        if (parsed.classes.length)
          tag += ` class="${parsed.classes.join(" ")}"`;
        for (const [k, v] of Object.entries(parsed.other)) {
          tag += ` ${k}="${v}"`;
        }
        return tag + ">\n";
      }
      return "</div>\n";
    },
  })
  .use(markdownItAttrs);
