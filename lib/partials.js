// Split a partial's args string on | separators, but treat [[...]] as atomic
// so pipes inside wikilinks (display text) are not treated as separators.
// e.g. "[[topic/Trinity|Trinity]]|simple" → ["[[topic/Trinity|Trinity]]", "simple"]
function splitPartialArgs(argsStr) {
  const args = [];
  let current = "";
  let depth = 0;
  let i = 0;
  while (i < argsStr.length) {
    if (argsStr[i] === "[" && argsStr[i + 1] === "[") {
      depth++;
      current += "[[";
      i += 2;
    } else if (argsStr[i] === "]" && argsStr[i + 1] === "]") {
      depth--;
      current += "]]";
      i += 2;
    } else if (argsStr[i] === "|" && depth === 0) {
      args.push(current.trim());
      current = "";
      i++;
    } else {
      current += argsStr[i];
      i++;
    }
  }
  args.push(current.trim());
  return args;
}

// Expand {{name}} / {{name|arg1|arg2}} using the files in partial/. Names are
// looked up by basename only (case-insensitive); there is no path syntax.
export function expandPartials(text, partials, seen = new Set()) {
  return text.replace(
    /\{\{([^}|]+?)(?:\|([^}]*))?\}\}/g,
    (match, name, argsStr) => {
      name = name.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
      const key = name.toLowerCase().trim();

      // Numeric names are unfilled positional placeholders — leave as empty
      if (/^\d+$/.test(key)) return "";

      if (seen.has(key)) {
        console.warn(`Warning: Circular partial detected — "${name}"`);
        return `<!-- circular partial: ${name} -->`;
      }

      let partial = partials[key];
      if (partial === undefined) {
        console.warn(`Warning: Partial not found — "${name}"`);
        return `<!-- partial not found: ${name} -->`;
      }

      const args = argsStr ? splitPartialArgs(argsStr) : [];

      for (let i = 0; i < args.length; i++) {
        partial = partial.replace(
          new RegExp(`\\{\\{${i + 1}\\}\\}`, "g"),
          args[i],
        );
      }

      // Replace any remaining unfilled {{N}} placeholders with empty string
      partial = partial.replace(/\{\{\d+\}\}/g, "");

      partial = partial.replace(/\{\{\$args\}\}/g, args.join(", "));
      partial = partial.replace(/\{\{\$n\}\}/g, String(args.length));

      return expandPartials(partial, partials, new Set(seen).add(key));
    },
  );
}
