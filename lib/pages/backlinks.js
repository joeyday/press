// Minimal HTML escaper for inline text/attribute interpolation.
const escHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function writeBacklinksPages({
  output,
  renderLayout,
  filesToProcess,
  backlinksMap,
}) {
  // ── Backlinks sub-pages ──────────────────────────────────────────────────────
  // Generate a /pageurl/backlinks page for every non-hidden content page.

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

    await output.emit(blUrl, blHtml);
    backlinksPageCount++;
  }
  console.log(
    `Backlinks pages: generated ${backlinksPageCount} page(s) (${Object.values(backlinksMap).reduce((s, a) => s + a.length, 0)} total inbound link(s) recorded).`,
  );
  // ── End Backlinks sub-pages ──────────────────────────────────────────────────
}
