---
status: proposed
---

# No dev warning for unoptimized local-looking sources

**Not ratified.** Open question 6 from `VISION.md`.

## Context

When the plugin sees `<Image src={someVar} />` it leaves it alone, and the component falls
back to a `?meta` fetch. If `someVar` happened to hold a static local path, the consumer
silently missed the build-time optimization.

A dev-mode warning could point that out: "this looks local — it would have been optimized if
written as a literal."

The detection is necessarily heuristic. A template literal with a static prefix
(`` `./images/${name}.jpg` ``) genuinely cannot be resolved at build, and warning about it
tells the consumer to do something impossible. False positives in a dev console train people
to ignore the console.

## Decision (proposed)

**No warning.** The plugin stays silent on what it doesn't transform.

## Consequences

- Consumers get no feedback when they accidentally leave an optimization on the table. This is
  the real cost, and it is a genuine DX gap.
- No false positives, and no pressure to build a heuristic that must be tuned per project.
- Consistent with precision-over-recall: the plugin doesn't guess about code it doesn't own,
  and that applies to diagnostics as much as to transforms.
- A better answer probably exists later — a build-summary report ("42 images optimized, 3
  dynamic") is opt-in, aggregate, and carries no per-site false-positive cost. Worth a
  follow-up ADR rather than bolting it onto this one.
