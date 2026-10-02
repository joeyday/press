import ejs from "ejs";

// Compiles the page layout once and returns renderLayout(content, locals),
// which wraps content in the layout and classifies every link in the result.
// The URL sets say which classes an internal link gets: draft, category,
// notes (a notes page), featured, or broken (not a known URL).
export function createLayout({
  template,
  draftUrls,
  categoryUrls,
  notesUrls,
  featuredUrls,
  allKnownUrls,
  cacheBust,
}) {
  const renderTemplate = ejs.compile(template);

  function classifyLinks(html) {
    return html.replace(
      /<a\s([^>]*href="([^"]*)"[^>]*)>/g,
      (match, attrs, href) => {
        const classes = [];
        if (/^https?:\/\//.test(href)) {
          classes.push("external");
        } else {
          classes.push("internal");
          if (href.startsWith("/")) {
            // Strip fragment (#section) before checking URL sets
            const baseHref = href.split("#")[0];
            if (draftUrls.has(baseHref)) classes.push("draft");
            if (categoryUrls.has(baseHref)) classes.push("category");
            if (notesUrls.has(baseHref)) classes.push("notes");
            if (featuredUrls.has(baseHref)) classes.push("featured");
            if (!allKnownUrls.has(baseHref) && !baseHref.startsWith("/index/"))
              classes.push("broken");
          }
        }
        if (/class="/.test(attrs)) {
          return `<a ${attrs.replace(/class="([^"]*)"/, `class="$1 ${classes.join(" ")}"`)}>`;
        }
        return `<a class="${classes.join(" ")}" ${attrs}>`;
      },
    );
  }

  // A page's body classes are its URL's path segments:
  // "/index/scripture/romans" → ["index", "scripture", "romans"]; "/" → ["home"].
  function urlBodyClasses(url) {
    if (url === "/") return ["home"];
    return (url || "").split("/").filter(Boolean);
  }

  return function renderLayout(content, locals = {}) {
    return classifyLinks(
      renderTemplate({
        frontmatter: locals.frontmatter || {},
        bodyClasses: urlBodyClasses(locals.url),
        content,
        cacheBust,
        nsLabel: locals.nsLabel || "Meta page",
        isNote: locals.isNote || false,
        notePage: locals.notePage || null,
        noteUrl: locals.noteUrl || null,
        backlinksUrl: locals.backlinksUrl || null,
        categories: locals.categories || [],
        subcategories: locals.subcategories || [],
        pages: locals.pages || [],
        featuredWith: locals.featuredWith || null,
        featured: locals.featured || false,
      }),
    );
  };
}
