// Each alias writes a meta-refresh redirect at /{relDir}/{slugify(alias)}.
export async function writeAliasRedirects({ output, aliasRedirects }) {
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
    await output.emit(fromUrlPath, redirectHtml);
    console.log(`Built (alias redirect): ${fromUrlPath} -> ${toUrl}`);
  }
}
