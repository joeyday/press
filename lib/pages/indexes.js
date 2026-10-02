import { NAMESPACES, nsName } from "../model.js";
import { compareTitles } from "../titles.js";

// The alphabetical index for each namespace, plus the categorical, featured
// and drafts indexes. /index/alphabetical itself is a stub redirecting to the
// Topic list.
export async function writeIndexes({
  output,
  renderLayout,
  filesToProcess,
  listedNamespaces,
  alphabeticalByNs,
  featuredPages,
  draftPages,
  featuredWithMap,
}) {
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

    await output.emit(`/index/${indexPage.slug}`, html);
    console.log(`Built (index): /index/${indexPage.slug}`);
  }

  // /index/alphabetical is a stub that sends visitors to the Topic index.
  {
    const toUrl = "/index/alphabetical/topic";
    await output.emit(
      "/index/alphabetical",
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
}
