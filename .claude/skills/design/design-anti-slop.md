# Not Shipping Design AI Slop — A Guide for the Design Agent

Reference brief for any agent producing UI/visual design. The goal: output that looks
_authored_, not _averaged_. Read this before generating screens.

> **Relationship to `design.md`.** That file is the authoritative, enforced ruleset for the
> **correctness axis** — is the UI on-system, accessible, and not broken (tokens, contrast,
> focus, state coverage, the published-component rules). It wins on anything it covers. This brief is the
> complementary **voice axis** — is the UI _authored_ or _generic_. It never overrides
> `design.md`; where they touch, defer to `design.md` and use its vocabulary (`@theme` tokens,
> radix scales, the inline-style rules for the published component).

---

## 1. What "design AI slop" actually is

Slop is not "bad" design — it's **generic** design. It's the statistical median of every polished
screenshot the model has seen, rendered competently and without a point of view. It looks fine in
isolation and interchangeable in aggregate. The failure mode is _sameness_, not _ugliness_.

## 2. Why it happens (understand the mechanism, don't just memorize the tells)

LLMs are statistical pattern matchers, not designers. Given a vague prompt ("modern", "clean",
"nice"), the model has nothing to anchor on, so it reaches for the **highest-frequency patterns in
its training data** — roughly "every Tailwind tutorial and SaaS landing page scraped from GitHub,
2019–2024."

The purple-gradient epidemic is the canonical example: Tailwind shipped `indigo-500` as its demo
accent years ago, it saturated tutorials, and it got baked into the training distribution as "what
modern looks like." (This very starter ships `bg-purple-600` buttons by reflex — see the
`design-lint` baseline. That's the default talking, not a decision.)

**The implication:** slop is the _default output_. Avoiding it is not passive — it requires
actively constraining the model away from the median. No constraints = slop, every time.

## 3. The visual fingerprints (the tells to never ship)

If your output has these without a deliberate reason, it's slop:

- **Purple/indigo or blue→purple gradients** as the default accent. Also the generic "blue glow."
- **Inter font** (or Arial/system) chosen by default, with no type personality. (This starter
  has not chosen one yet — the docs site inherits the browser default. Choosing it is open work.)
- **Three-box icon-grid feature sections** ("three cards with an icon, a heading, a sentence").
- **Card nesting** — cards inside cards inside cards. Containers used as a substitute for real
  hierarchy.
- **The SaaS-marketing skeleton**: full-width centered hero → icon-grid features → testimonial
  carousel → three-column footer.
- **Timid, evenly-weighted palettes** — everything mid-saturation, nothing dominant.
- **Uniform spacing** with no rhythm — no grouping, no breathing room where it matters.
- **Placeholder content**: "User Name", "Item 1", "Lorem ipsum", "$0.00".
- **Flat, single-state screens** — no empty / loading / error / hover / focus states.

## 4. The discipline that prevents it

### 4a. Constrain explicitly — including negatives

Telling the model what _not_ to do removes the defaults it would otherwise fill in. **Prohibition
lists are the single most underused tool.** "No purple gradients," "no three-box feature grids,"
"no Inter," "no nested cards," "no centered hero."

### 4b. Anchor to a real reference / motif

Replace "modern and clean" with a concrete direction: a named style (neobrutalist, editorial,
terminal/CRT, Swiss/grid, glassmorphism), a mood, or a specific reference ("layout like Spotify's
home", "1970s ski-lodge palette: burnt orange, avocado, warm brown"). Motifs steer harder than
adjectives.

### 4c. Use the design tokens that already exist

Pull palette, type scale, spacing, and elevation from the system — never invent a new "safe blue."
`design.md` is the rule (`@theme` tokens and radix scales in `apps/docs/src/globals.css`); this is
the _why_: consistency with the existing system is itself anti-slop. Slop is what you get when each
screen reinvents its own tokens.

### 4d. Establish a deliberate type and color hierarchy

The _mechanics_ (contrast, tabular numbers, title/sentence case) are `design.md`'s job. The _voice_
part is making hierarchy intentional:

- Type: pick weight + size steps so hierarchy is _felt_, not flat.
- Color: choose a dominant and let it dominate. One confident accent beats five timid ones.

### 4e. Real content, not placeholders

Use plausible domain data — real names, real values, real copy at real lengths. Placeholder copy is
an instant tell and it hides layout problems (real strings have real lengths).

### 4f. Design the whole state machine, not the happy path

`design.md` already _requires_ loading / empty / error / success on every async view — that's the
floor. The voice point on top: empty and error states are a personality opportunity, not
boilerplate. A generic "No results" is slop even when it technically satisfies the rule.

### 4g. One screen / one component at a time

Generating an entire app in one shot maximizes regression to the median. Build and pressure-test a
single component against the brief first, then expand.

### 4h. Don't accept the first output

The first generation _is_ the median. Iterate; each pass adds context about what "right for this
product" means.

## 5. The judgment layer (the part the model can't outsource)

Constraints get you out of the slop basin; **taste** is what makes it good. The agent's job is not
to emit options — it's to make the call and defend it:

- Does this serve the user's actual job and success state, in one sentence?
- Does it carry the product's personality, or could it belong to any product?
- Is the hierarchy driven by _meaning_, or by containers and gradients?
- What did I deliberately leave out? (Restraint is a design decision.)

## 6. Pre-ship voice checklist

The correctness gate is `design.md` (tokens, contrast, state coverage, focus, a11y) — run
`/design-review` for that. This list is the _voice_ pass on top:

- [ ] No purple/indigo-by-default gradient; accent chosen for a reason.
- [ ] Font is a deliberate choice, not Inter-or-system-by-default.
- [ ] No three-box icon grid, no nested cards, no generic SaaS skeleton.
- [ ] Palette has a dominant; hierarchy is felt, not flat.
- [ ] Spacing has rhythm (grouping + breathing room), not uniform padding.
- [ ] Real domain content, zero placeholders.
- [ ] Empty / error states have product personality, not boilerplate copy.
- [ ] I can name the aesthetic direction and what I deliberately excluded.
- [ ] This could _only_ be this product — not any product.

---

### Sources

- [AI Slop in Design — Managed Code](https://www.managed-code.com/blog-post/ai-slop-in-design)
- [Avoid AI Slop with Claude Design (design-system approach) — MindStudio](https://www.mindstudio.ai/blog/claude-design-avoid-ai-slop-design-system)
- [Why Your AI Keeps Building the Same Purple Gradient Website — prg.sh](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
- [Where does that purple gradient come from? — Jack Pearce](https://www.jackpearce.co.uk/notes/purple-gradient-ai-aesthetics/)
- [15 AI-Generated UI Mistakes and How to Fix Them — GenDesigns](https://gendesigns.ai/blog/ai-generated-ui-mistakes-how-to-fix)
- [AI-Generated UI Anti-Patterns — BSWEN](https://docs.bswen.com/blog/2026-03-20-ai-generated-ui-anti-patterns/)
- [Craft — State of AI in Design Report 2026](https://stateofaidesign.com/chapters/craft)
- [State of the Designer 2026 — Figma](https://www.figma.com/blog/state-of-the-designer-2026/)
