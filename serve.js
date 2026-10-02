import http from "http";
import fs from "fs/promises";
import path from "path";

// Local preview server that mimics GitHub Pages: /foo/ serves foo/index.html,
// /foo redirects to /foo/ when foo is a directory, and anything unmatched
// serves 404.html with a 404 status. Bound to localhost only.

const PORT = 4000;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

// Resolve a request path to a file inside root, or null if there isn't one.
// Returns { file } or { redirect } (directory requested without a trailing slash).
async function resolveRequest(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const target = path.join(root, decoded);
  // Refuse anything that escapes root (e.g. "/../secret").
  if (target !== root && !target.startsWith(root + path.sep)) return null;

  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return null;
  }
  if (stat.isFile()) return { file: target };
  if (!stat.isDirectory()) return null;
  if (!urlPath.endsWith("/")) return { redirect: urlPath + "/" };
  const index = path.join(target, "index.html");
  try {
    if ((await fs.stat(index)).isFile()) return { file: index };
  } catch {}
  return null;
}

async function send(req, res, status, file) {
  const body = await fs.readFile(file);
  res.writeHead(status, {
    "Content-Type":
      CONTENT_TYPES[path.extname(file).toLowerCase()] ||
      "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(req.method === "HEAD" ? undefined : body);
}

export function serve(dir) {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        return res.end();
      }
      const { pathname, search } = new URL(req.url, "http://localhost");
      const found = await resolveRequest(root, pathname);
      if (found?.redirect) {
        res.writeHead(301, { Location: found.redirect + search });
        return res.end();
      }
      if (found?.file) return await send(req, res, 200, found.file);

      const notFound = path.join(root, "404.html");
      try {
        await send(req, res, 404, notFound);
      } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
      }
    } catch (err) {
      console.error("Serve error:", err);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("500 Internal Server Error");
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      reject(
        err.code === "EADDRINUSE"
          ? new Error(`Port ${PORT} is already in use (is another press serve running?)`)
          : err,
      );
    });
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`Serving ${root} at http://localhost:${PORT}/  (Ctrl-C to stop)`);
      resolve(server);
    });
  });
}
