# Design Rules

Imperative rules for any UI work in this repo. Keep this short and follow it; the long-form
reasoning lives in review, not here.

The UI layer here is small and has two halves, with different rules:

- **`apps/docs/src`** — the Next.js docs site. Tailwind 4, CSS-first config. Most rules below
  apply here.
- **`packages/micro-image-image/src`** — the published component. It uses **inline style
  objects and no Tailwind at all**, deliberately: it ships to consumers who own their own CSS.
  Only the rules marked **[pkg]** apply there.

Each rule is tagged with how it's enforced:

- **[lint]** — fails `npm run lint` (oxlint + `scripts/design-lint.mjs`). A hard gate.
- **[axe]** — belongs to accessibility tests (not yet wired; treat as hard until then).
- **[review]** — checked by `/design-review` against the diff. No machine gate; don't skip it.
- **[pkg]** — also applies to the published component, not just the docs site.

## Color & tokens

- **[lint]** **[pkg]** Never raw hex, `rgb()`, or `hsl()`. In the docs site use a radix scale
  utility (`bg-slate-3`, `text-slate-12`) or an `@theme` token. Tokens live in
  `apps/docs/src/globals.css`, which imports `tailwindcss` and
  `tailwindcss-radix-colors/dist/all-colors-only.css` — the latter defines raw
  `--color-<hue>-<step>` scales with no semantic utilities.
- **[lint]** No purple/indigo/violet/fuchsia accent chosen by reflex — the canonical AI-slop
  tell. The accent is a named `@theme` token picked for a reason (see `design-anti-slop.md`).
  The lint baseline is currently **empty**: the repo has zero violations, so any new one fails.
  Keep it that way rather than adding entries.
- **[review]** This project has no brand accent yet. Radix gives you the scales; it does not
  pick one. Choosing it is a real decision — make it deliberately and put it in `@theme`, don't
  let it accrete from whichever hue the first component reached for.
- **[review]** Consolidate neutrals. Scattering several radix grays across components is how a
  palette drifts into slop. Pick one neutral hue and use it consistently. See `better-colors/`
  next to this file for OKLCH scales, palette generation, gamut, and Tailwind 4 theming.
- **[axe]** Text meets contrast targets (WCAG AA: 4.5:1 body, 3:1 large/UI). Verify against the
  actual composited background. The repo carries `dark` as a `@custom-variant` on the root
  `<Html>`, so check both themes. Use the `apca-contrast` skill rather than eyeballing.

## Typography & numbers

- **[review]** The font is a deliberate choice, never Inter-or-system-by-default. This repo has
  no font token yet — the docs site inherits the browser default. That is a gap, not a style.
  See `better-typography/` next to this file for scale, hierarchy, and OpenType features.
- **[review]** Use `tabular-nums` for numbers the user compares or that update in place. The
  docs site's `Compare` component renders file sizes side by side and updates them after fetch;
  misaligned digits there are a bug, not a nitpick.
- **[review]** Headings and buttons: Title Case. Body copy and helper text: sentence case.
- **[review]** No layout shift from number changes — reserve width so a value ticking 9→10
  doesn't reflow the row.

## Interactions

- **[lint]** Style focus with `focus-visible:`, never bare `focus:`. Never remove a focus ring
  without replacing it with a visible one.
- **[lint]** Never disable paste on `<input>`/`<textarea>`.
- **[review]** Every clickable element has a visible hover state — a deliberate change on
  `:hover`, not just the cursor. A control that only responds on click reads as inert. Disabled
  controls are the exception. Use the `emil-design-eng` skill for interaction polish.
- **[review]** `cursor-pointer` only on genuinely clickable elements, never on text or disabled
  controls.
- **[review]** Hit targets are at least 40px on touch. Don't ship a 16px control.
- **[axe]** Every flow is fully keyboard-operable.

## State coverage

- **[review]** **[pkg]** Every async view handles four states explicitly: loading, empty, error,
  and success. A spinner-only happy path is incomplete. This one bites hardest in the component:
  BUG-13 is exactly a missing state, where a `0` content-length is falsy and `Compare` sits on
  "loading…" forever.
- **[review]** Empty and error states say something useful and offer the next action — not just
  "No results" or "Something went wrong".

## Motion

- **[review]** **[pkg]** Respect `prefers-reduced-motion` for any non-trivial animation. An
  image fading in from a placeholder counts.
- **[review]** Prefer CSS transitions over main-thread JS. Animate `transform` and `opacity`,
  never layout properties.
- **[review]** Animations are interruptible and short (≤ ~200ms for UI feedback).

## Layout & responsiveness

- **[review]** **[pkg]** Layouts are responsive and driven by CSS sizing (flex/grid/clamp), not
  fixed pixel heights that clip content. The component reserves space with an aspect-ratio box
  precisely so images don't shift layout — don't regress that into fixed heights.
- **[review]** No horizontal scroll at supported widths. Long strings truncate or wrap
  deliberately, never overflow.

## The published component

- **[pkg]** Inline styles are the deliberate choice, not an oversight. The component ships to
  consumers who own their CSS. Don't introduce Tailwind classes, a stylesheet, or a CSS-in-JS
  dependency into `packages/micro-image-image`.
- **[pkg]** Every style the component sets is a public API commitment. Changing a default
  `objectFit`, the wrapper's positioning, or the aspect-ratio mechanism changes how it renders
  in every consumer's app. That is a breaking change and needs a changeset.
- **[pkg]** Ship no color. The component renders an image and a placeholder; it has no business
  having an opinion about the consumer's palette.

## Clarity — don't make me think

Krug's first law: every screen should be **self-evident**. Failing that, **self-explanatory**.
A brief instruction is the last resort, never the plan.

- **[review]** A control explains itself — label, icon, and position make its purpose obvious.
  If it needs a tooltip just to be understood, the affordance failed first.
- **[review]** Convention over invention. Reinventing a familiar control forces users to stop
  and think.
- **[review]** Visual weight tracks meaning. The primary action outranks the secondary; the
  headline outranks the metadata.
- **[review]** Omit needless words. No happy talk, no "Welcome!" intros, no instructions for
  self-evident UI.
- **[review]** Design for scanning, not reading. Lead each row with its distinguishing fact.

## Voice (not generic)

The rules above keep UI correct. These keep it from looking AI-generated — the long-form
reasoning is in `design-anti-slop.md` next to this file.

- **[review]** No default-AI accent: no purple/indigo, no blue→purple gradient by reflex.
- **[review]** No generic skeleton: no three-box icon-grid feature section, no card-in-card
  nesting standing in for hierarchy, no centered-hero → features → testimonials → 3-col-footer
  template. Hierarchy comes from meaning, not containers.
- **[review]** Real content in any example. This is a docs site for an image library, so use
  real images at real dimensions with real file sizes — placeholders hide exactly the
  layout and payload bugs the product exists to fix.
- **[review]** The screen could only be _this_ product. A docs site for an image proxy should
  show images doing something only this proxy does. If it would fit any generic library
  unchanged, it's slop.
