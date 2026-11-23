# micro-image — vision digest (always-on)

Short, always-in-context form of `VISION.md`. Read the full file for the architecture,
non-goals, and open decisions.

**North star.** Write `<Image src="./hero.jpg" />` and get the correct-sized,
format-optimized image for the container it renders into — starting from the HTML alone, no
placeholder round trip, no manual dimensions, no framework lock-in.

**Guiding principle.** Container-width selection + self-hosted proxy + framework-agnostic.
All three, or it is just another image library. Judge every change by whether it holds all
three at once; a change that trades one away for convenience is the wrong change.

**Who it is for.** The maintainer's sites first, Query Doctor's included; then self-hosting
developers; later a paid hosted proxy. The hosted proxy deploys the open-source one and is
never a fork.

**What wins a trade-off.** Trust, then speed, then ease. Speed is the top workstream; replace
any part of the stack, the proxy's language included, only when a benchmark shows it is
faster. Packages stay on `0.0.x`, where design decisions are experiments the benchmark can
reverse.

**Query Doctor dogfood.** Run Query Doctor on any database change and record the result in
the PR before it merges.

**How the work should feel** (values, in priority order — they trade off; name the trade-off
rather than pretend it away):

- **Nothing in the critical path.** `srcset` and a real `sizes` ship in the first paint, so
  the preload scanner starts the image before any JS runs. A `ResizeObserver` may raise
  `sizes`, never lower it: lowering recovers no bytes, and while the large variant is still
  downloading it adds a second fetch. `sizes="auto"` alone is not the mechanism: it needs
  `loading="lazy"`, which is wrong for the hero image. A feature that adds a round trip
  states why in its PR.
- **One contract, many paths.** Build-time, runtime, and no-proxy all produce the same
  `ImageMeta`. Divergence here is the failure mode that ends the project.
- **Precision over recall.** Never transform what you cannot prove is yours — a missed
  optimization degrades gracefully, a wrong one corrupts a build.
- **Thin adapters.** Framework packages find and rewrite `<Image>`; everything else lives in
  the shared core. An adapter that grows a second job is a bug.

Full detail → `VISION.md`. Open decisions → `docs/adr/`.
