# micro-image — vision digest (always-on)

Short, always-in-context form of `VISION.md`. Read the full file for the architecture,
non-goals, and open decisions.

**North star.** Write `<Image src="./hero.jpg" />` and get the correct-sized,
format-optimized image for the container it renders into — no runtime measurement, no
placeholder round trip, no manual dimensions, no framework lock-in.

**Guiding principle.** Container-width selection + self-hosted proxy + framework-agnostic.
All three, or it is just another image library. Judge every change by whether it holds all
three at once; a change that trades one away for convenience is the wrong change.

**How the work should feel** (values, in priority order — they trade off; name the trade-off
rather than pretend it away):

- **Nothing in the critical path.** The browser picks the right variant with no JS gate. A
  feature that costs a round trip has to earn it out loud.
- **One contract, many paths.** Build-time, runtime, and no-proxy all produce the same
  `ImageMeta`. Divergence here is the failure mode that ends the project.
- **Precision over recall.** Never transform what you cannot prove is yours — a missed
  optimization degrades gracefully, a wrong one corrupts a build.
- **Thin adapters.** Framework packages find and rewrite `<Image>`; everything else lives in
  the shared core. An adapter that grows a second job is a bug.

Full detail → `VISION.md`. Open decisions → `docs/adr/`.
