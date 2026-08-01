Audit the UI changes in the current diff against this repo's design rules.

**Scope check first.** Run `git diff` (and `git diff --staged`). If nothing touches
`apps/docs/src/**/*.{ts,tsx}`, `**/*.css`, or `packages/micro-image-image/src/**/*.tsx`, say so
and stop — there is nothing to review.

**Baseline.** Read `.claude/skills/design/design.md` before anything else. It is the
authoritative ruleset and it distinguishes two layers: the docs site, and the published
component where only `[pkg]` rules apply.

**Specialist references**, when the finding calls for them:

- `.claude/skills/design/better-colors/` — OKLCH, palette generation, gamut, Tailwind 4 theming
- `.claude/skills/design/better-typography/` — scale, hierarchy, spacing, wrapping, OpenType
- `apca-contrast` (user-level skill) — run it rather than eyeballing contrast
- `emil-design-eng`, `apple-design`, `review-animations` (user-level) — interaction and motion

## Review dimensions

Work through each; report only what the diff actually touches.

1. **Color & tokens** — no raw hex, `rgb()`, `hsl()`. Radix scale utilities or `@theme` tokens
   from `apps/docs/src/globals.css`. Neutrals consolidated to one hue. No reflex purple.
2. **Contrast** — WCAG AA against the real composited background, in **both** themes; the root
   `<Html>` carries `dark` and `globals.css` declares the `@custom-variant`.
3. **Typography** — deliberate scale and hierarchy. `tabular-nums` on any number that updates
   in place or is compared across rows.
4. **Interactions** — `focus-visible:` never bare `focus:`; a visible hover state on everything
   clickable; `cursor-pointer` only on real controls; hit targets ≥40px on touch.
5. **Keyboard & a11y** — every flow operable without a mouse; labels associated; no removed
   focus ring left unreplaced.
6. **State coverage** — loading, empty, error, success all handled. Watch for falsy-zero bugs
   specifically; BUG-13 is exactly that failure in `Compare`.
7. **Motion** — `prefers-reduced-motion` respected; `transform`/`opacity` only; ≤200ms for
   feedback; interruptible.
8. **Layout** — CSS-driven sizing, no fixed heights that clip, no horizontal scroll, long
   strings wrap or truncate deliberately.
9. **The published component** — no Tailwind, no stylesheet, no CSS-in-JS in
   `packages/micro-image-image`. No color opinions. Any change to what it renders or styles is
   a public-API change needing a changeset.
10. **Voice** — real images at real dimensions in examples, not placeholders. Hierarchy from
    meaning, not nested containers. Could this screen only be _this_ product?

## Output

- Tag every finding with its rule and `file:line`: `[lint]`, `[axe]`, `[review]`, `[pkg]`.
- Separate **hard gates** (`[lint]`, `[axe]`) from **judgment calls** (`[review]`).
- Order by severity.
- Run `npm run lint` and report the `design-lint` result explicitly — the baseline is empty, so
  any violation is new.
- If the diff is clean, say "passes all checks" rather than inventing findings.
