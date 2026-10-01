---
title: Fix: add dotted-pair Roman numeral matching (X.III, I.I)
---
# Fix: add dotted-pair Roman numeral matching (e.g. X.III, I.I)

## What & Why
The Roman numeral wrapper (task #9) only built the standalone branch of the
regex. The dotted-pair branch — needed for WCF citations like `X.III` or
`I.I` — was in the task spec but was not implemented by the task agent.

Currently `ROMAN_NUM_RE` is:
  `/\b(?=[MDCLXVI]{2})M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})\b/g`

This has two problems for the dotted-pair case:
1. No branch to match `ROMAN.ROMAN` as a single unit
2. The `(?=[MDCLXVI]{2})` lookahead excludes single-char left-hand sides
   like `X` or `I` (which are valid WCF chapter numbers)

## Done looks like
`ROMAN_NUM_RE` is replaced with a two-branch pattern assembled via
`new RegExp(...)` so the structural subpattern can be shared:

```javascript
const ROMAN_RE_SRC =
  "M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})";

const ROMAN_NUM_RE = new RegExp(
  // Branch 1: ROMAN.ROMAN  (dotted pair; each half ≥ 1 char)
  `\\b(?=[MDCLXVI])${ROMAN_RE_SRC}\\.(?=[MDCLXVI])${ROMAN_RE_SRC}\\b` +
  // Branch 2: standalone   (≥ 2 chars)
  `|\\b(?=[MDCLXVI]{2})${ROMAN_RE_SRC}\\b`,
  "g",
);
```

The existing `match.length >= 2` guard in the replacement callback is
retained as an extra safety net against empty matches.

Build output is verified:
- `X.III` → `<span class="roman-num">X.III</span>` (single span)
- `I.I` → `<span class="roman-num">I.I</span>`
- `XIV.II` → `<span class="roman-num">XIV.II</span>`
- `III` (standalone) → still wrapped
- bare `I`, `X` → still NOT wrapped

## Relevant files
- `build.js` — `ROMAN_NUM_RE` constant (~line 462)