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

Still proposed, though the mechanism has now landed in full.

The cache-key prerequisite above is met (#8). The key now carries format, so a WebP and a
JPEG of the same source no longer collide.

The proxy encodes to an explicitly requested format (#9), via `?format=`.

The proxy negotiates on `Accept` when a request names no format (`negotiateFormat` in
`apps/cache/src/server.ts`):

- Only an exact `image/avif` or `image/webp` entry with q > 0 counts. The `image/*` and `*/*`
  tails every engine sends formally match AVIF (RFC 9110 §12.5.1), but a wildcard is also what
  curl sends, so reading it as a request for AVIF would convert for clients that never asked.
  Highest q wins; a tie goes to AVIF.
- The **resolved** format goes into the id, and that id is shared by the cache and the request
  coalescer, so an AVIF and a WebP of one source never share an entry or an in-flight result.
- Every negotiated response carries `Vary: Accept`, including the ones that kept the source
  format. An explicit `?format=`, including `original`, does not vary.
- `?format=auto` stays unimplemented. An absent format already means "negotiate", so a second
  spelling would only split the cache.

On the `Vary: Accept` / `immutable` question raised in `docs/research/image-format-coverage.md`
§10: the pair is not a contradiction. RFC 8246 defines `immutable` as "the response will not be
updated during its freshness lifetime"; `Vary` selects which stored response answers a request.
Each Accept-keyed representation is itself immutable, so both hold. The live risk is a shared
cache that **ignores** `Vary`, which would serve one client's format to every client. Cloudflare,
for one, does not honour `Vary: Accept` for images unless its "Vary for Images" setting is turned
on (developers.cloudflare.com/cache/advanced-configuration/vary-for-images/). Any CDN put in
front of the proxy needs this checked first. Whether the current host adds one is unchecked.

What ratification would still require: a decision to make this the default. The proxy now
negotiates for every request without a `format`, which moves Chromium and Firefox traffic onto
AVIF and its roughly 10x encode CPU on a cold miss.
