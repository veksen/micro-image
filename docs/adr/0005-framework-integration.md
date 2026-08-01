---
status: proposed
---

# Ship our own `<Image>` everywhere, coexisting with each framework's conventions

**Not ratified.** Open question 4 from `VISION.md`. This is the least settled of the seven.

## Context

Astro, Nuxt, and SvelteKit already have image conventions — `getImage()`, `<NuxtImg>`, and
their own asset pipelines. Two strategies:

- **Integrate** with each host's convention, so `getImage()` in Astro routes through
  micro-image's proxy.
- **Coexist** — ship `<Image>` everywhere, and let consumers choose per-image which system
  they use.

Integration is better DX inside a framework that already has an opinion. But the north star
is explicitly framework-agnostic, and integration means the `ImageMeta` contract has to
survive translation into a shape each host defines and controls. That is exactly the
divergence `.claude/skills/image-meta-contract/` exists to prevent.

## Decision (proposed)

**Coexist.** Ship `<Image>` and the adapter for each framework; do not adapt to host image
APIs. Revisit per framework only if adoption stalls specifically on it.

## Consequences

- One contract, one component API, one mental model across six frameworks. Adding a framework
  stays in the hundreds of lines, which is a stated success criterion.
- Consumers on Astro or Nuxt run two image systems side by side, which is a real DX cost and
  the strongest argument against this decision.
- Container-width selection is the differentiator, and no host API exposes it — so integrating
  would mean giving up the one axis that makes this project worth building. That asymmetry is
  the main reason to coexist.
- If this is reversed later, it should be reversed per framework with its own ADR, not
  globally.
