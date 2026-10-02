// /index/scripture lists the referenced books; /index/scripture/{book} lists
// each unique reference with the pages and sections it appears in.
export async function writeScriptureIndex({ output, renderLayout }) {
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
    await output.emit("/index/scripture", rootHtml);
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
    await output.emit(`/index/scripture/${book.bookSlug}`, bookHtml);
    console.log(`Built (index): /index/scripture/${book.bookSlug}`);
  }
}
