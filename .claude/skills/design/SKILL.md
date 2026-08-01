---
name: design
description: Use for any UI work in this repo — building or reviewing pages, layouts, or components in apps/docs/src, editing apps/docs/src/globals.css or any stylesheet, or changing what the published <Image> component renders or styles inline. Load before writing UI so the output is on-system and not AI-slop: radix scales and @theme tokens over raw hex, focus-visible over bare focus, tabular-nums on numbers that change, all four async states, a deliberate accent rather than reflex purple, and no Tailwind inside the published package. Covers the enforced correctness ruleset, the anti-slop voice guide, and vendored color and typography references.
---

# Design

Four things sit next to this file. Read the first two before UI work; reach for the other two
when the specific question comes up.

- **`design.md`** — the enforced ruleset. Tags each rule `[lint]`, `[axe]`, `[review]`, or
  `[pkg]`. Read this first.
- **`design-anti-slop.md`** — the voice guide: keeping UI authored rather than averaged.
- **`better-colors/`** — OKLCH scales, palette generation, gamut, contrast, Tailwind 4 theming.
- **`better-typography/`** — type scale, font choice, spacing, wrapping, OpenType.

## The short version

**Two UI layers, different rules.** `apps/docs/src` is the Next.js docs site on Tailwind 4.
`packages/micro-image-image/src` is the published component, which uses inline style objects
and no Tailwind on purpose — it ships to consumers who own their CSS. Rules tagged `[pkg]`
apply to both; the rest apply only to the docs site.

**`[lint]` is a real gate.** `npm run lint` runs oxlint and then `scripts/design-lint.mjs`,
which checks five things regex can see: arbitrary hex, `rgb()`/`hsl()` literals, reflex
purple/indigo accents, bare `focus:`, and disabled paste. The baseline in
`scripts/design-lint-baseline.json` is **empty** — the repo has zero violations today, so any
new one fails CI. Burn nothing down; just don't add to it.

**There is no brand accent yet.** `globals.css` imports `tailwindcss` plus
`tailwindcss-radix-colors/dist/all-colors-only.css`, which gives raw `--color-<hue>-<step>`
scales and no semantic utilities. Radix hands you scales; it does not pick one. Choosing the
accent is an open decision — make it deliberately and record it in `@theme`.

**Check both themes.** `globals.css` declares `@custom-variant dark (&:where(.dark, .dark *))`
and the root `<Html>` carries the class. A contrast check against one theme is half a check.

## Reviewing rather than writing

Run `/design-review` over the diff. It resolves `[lint]` and `[axe]` findings as hard gates and
`[review]` findings as judgment calls, and pulls in `emil-design-eng`, `apple-design`,
`review-animations`, and `apca-contrast` from the user-level skills where they apply.
