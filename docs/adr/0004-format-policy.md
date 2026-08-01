---
status: proposed
---

# The proxy owns format negotiation; the build emits source format only

**Not ratified.** Open question 3 from `VISION.md`.

## Context

AVIF and WebP need to reach browsers that support them and not those that don't. Two places
can decide:

- **The proxy**, at request time, from the `Accept` header.
- **The build**, ahead of time, by pre-generating variants and emitting `<picture>` sources.

Doing both is redundant work and two sources of truth for the same question.

There is a constraint that makes this less symmetric than it looks: the build cannot know
what the requesting browser accepts. Build-time format selection means shipping every format
and letting `<picture>` choose, which multiplies build time and asset count by the number of
formats.

## Decision (proposed)

**The proxy owns format negotiation**, keyed on `Accept`. The build-time path emits the
source format only, and the format lives in the cache key so a WebP and an AVIF of the same
source never collide.

Multi-source `<picture>` output stays a future addition, not a launch requirement.

## Consequences

- One implementation of format policy, in one place, changeable without a rebuild.
- The `?micro` loader stays fast — it emits one asset per image, not three.
- Static images still require the proxy to get an optimal format. That is consistent with the
  non-goal "not eliminating the proxy for static images", but it does mean the build-time path
  is a latency optimization, not an independence one.
- Format must be in the cache key. It currently isn't — the proxy's key includes only width
  and blur, which is a live bug (see `BUGS.md`) and a correctness prerequisite for this ADR.
