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

## Progress

Still proposed. Two steps have landed, and they are the half of this ADR that does not
depend on ratifying it.

The cache-key prerequisite above is met (#8). The key now carries format, so a WebP and a
JPEG of the same source no longer collide.

The proxy encodes to an explicitly requested format (#9), via `?format=`. That is the
mechanism this ADR assumes, but not the policy: selection is still the caller's, not the
proxy's.

What ratification would still require:

- Negotiation keyed on `Accept`, which is the actual decision here.
- The cache key must then include the **resolved** format rather than the requested one, and
  responses need `Vary: Accept`. Keying on the request alone would let a WebP answer a client
  that did not accept it.
- **`Vary: Accept` conflicts with the `immutable` currently in `cacheControl`.** RFC 9110 §12.5.5
  makes `Vary` expand the cache key; `immutable` asserts the response never changes. A shared
  cache may resolve that pair badly, and CDN-specific behaviour here is unresearched. Settle it
  before ratifying — see `docs/research/image-format-coverage.md` §10.
- Negotiation must parse media ranges per §12.5.1 precedence, not substring-match. Every shipping
  engine terminates its image `Accept` with `image/*;q=0.8` or `*/*;q=0.5`, which formally matches
  AVIF at a lower weight — so `header.includes("image/avif")` is wrong. Safari also announces
  `image/heic`, which this build cannot decode, and Lockdown Mode announces only WebP.
- `?format=auto` is deliberately unimplemented and reserved for exactly that meaning. It is
  not a synonym for the source format — `?format=original` is.
