// Usage: node scripts/compare-dist.mjs <dirA> <dirB>
// Byte-compares two build outputs, ignoring the layout's Date.now() cache-busters.
// Exit 0 when identical, 1 otherwise.
import fs from "fs"; import path from "path";
const [a, b] = process.argv.slice(2);
const list = (d, r = "") => fs.readdirSync(path.join(d, r), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? list(d, path.join(r, e.name)) : [path.join(r, e.name)]);
const norm = (buf, f) => f.endsWith(".html") ? buf.toString().replace(/\?(v=)?\d{10}"/g, '?$1TS"') : buf;
const A = new Set(list(a)), B = new Set(list(b)); let bad = 0;
for (const f of A) if (!B.has(f)) { console.log("only in A:", f); bad++; }
for (const f of B) if (!A.has(f)) { console.log("only in B:", f); bad++; }
for (const f of A) if (B.has(f)) {
  const x = norm(fs.readFileSync(path.join(a, f)), f), y = norm(fs.readFileSync(path.join(b, f)), f);
  if (Buffer.compare(Buffer.from(x), Buffer.from(y))) { console.log("differs:", f); bad++; } }
console.log(bad ? `${bad} difference(s)` : `IDENTICAL (${A.size} files)`); process.exit(bad ? 1 : 0);
