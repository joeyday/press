# Roman numeral span wrapping

## What & Why
After the abbreviation expansion pass, wrap every occurrence of a valid
uppercase Roman numeral in `<span class="roman-num">` so CSS can apply
distinct typography (e.g. letter-spacing, font-variant, small-caps) to them
later.

A key use case is WCF citations in the form `WCF X.III` or `WCF I.I` where
the chapter and section are each Roman numerals separated by a period. These
must be matched as a single span, and because chapter "I" alone is a
meaningful number in this context, single-character Roman numerals are allowed
as the left or right half of a dotted pair.

## Matching rules

Two branches are tried in alternation, with the dotted-pair branch first so
it wins the longer match when applicable:

**Branch 1 — Dotted pair** (`ROMAN.ROMAN`):
- Each half: a valid uppercase Roman numeral (1+ characters)
- Both halves validated with the standard structural regex:
  `M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})`
- Leading lookahead on each half ensures neither matches empty
- Pattern: `\b(?=[MDCLXVI])ROMAN\.(?=[MDCLXVI])ROMAN\b`
- Examples that match: `X.III`, `I.I`, `XIV.II`, `XXIII.IV`

**Branch 2 — Standalone** (2+ characters):
- A valid uppercase Roman numeral with at least 2 characters
- Leading lookahead `(?=[MDCLXVI]{2})` enforces minimum 2 chars, excluding
  standalone I, V, X, L, C, D, M (common abbreviations and the English
  pronoun "I")
- Pattern: `\b(?=[MDCLXVI]{2})ROMAN\b`
- Examples that match: `II`, `XIV`, `MCMLXXX`, `WCF`, `XLIX`
- Examples that do NOT match: `I`, `V`, `X`, `C`, `M`

The combined regex (dotted branch first):
```
/\b(?=[MDCLXVI])ROMAN_RE\.(?=[MDCLXVI])ROMAN_RE\b|\b(?=[MDCLXVI]{2})ROMAN_RE\b/g
```
where `ROMAN_RE` is the 1–3999 structural pattern above. Use a string
variable for the pattern and `new RegExp(...)` to assemble it.

## Pipeline position
Runs as a third post-processing pass, immediately after the abbreviation
expander (which runs after Bible ref linking). Abbreviations already wrapped
in `<abbr>` are protected by the skip-tag mechanism.

## Skip tags
`abbr`, `code`, `pre`, `script`, `style` — do NOT skip `<a>` (lesson from
task #8: anchor text should be processed).

## Output
`<span class="roman-num">XIV</span>` or `<span class="roman-num">X.III</span>`

No title or other attributes. The class name is the only addition.

## Done looks like
- A `wrapRomanNumerals(html)` function added to build.js, following the same
  tag-split / skip-stack pattern as `wrapAbbreviations`
- A post-processing loop in `build()` after the abbreviation expander loop,
  reporting "Roman numeral wrapper: processed N HTML file(s), rewrote M."
- The Roman numeral pass always runs (no external data file required)
- Spot-checked in built HTML:
  - A standalone multi-char Roman numeral (e.g. `II`) is wrapped
  - A dotted pair (e.g. `X.III`) is wrapped as a single span
  - A single Roman numeral letter (e.g. bare `I` or `X`) is NOT wrapped
  - An `<abbr>`-wrapped abbreviation is NOT re-wrapped

## Relevant files
- `build.js` — add `ROMAN_NUM_RE`, `wrapRomanNumerals()`, and its
  post-processing loop after the abbreviation expander block (~line 1305)
