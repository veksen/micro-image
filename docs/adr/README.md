# Architecture Decision Records

An ADR records one architectural decision, the context that forced it, and the consequences
we accepted. Write one when a choice is expensive to reverse, non-obvious, or likely to be
questioned later ("why is it done this way?"). Don't write one for routine choices.

## Format

- One file per decision: `NNNN-kebab-title.md`, numbered in order (`0001`, `0002`, …).
- Frontmatter carries the status; the body carries the decision and its reasoning.

```markdown
---
status: proposed
---

# <Decision, as a statement — "Reads are cached at the edge", not "Caching">

<The context: what forces this decision now. The decision itself, stated plainly.
The consequences — what this makes easy, what it makes hard, what we gave up.>
```

## Status lifecycle

- `proposed` — drafted, not yet ratified. **Nine of the ADRs here are proposed.** Six are open
  questions from `VISION.md`, each with a suggested default that has not been ratified; 0009,
  0010 and 0011 answer research issues instead. Resolve one before writing code that assumes
  its answer, rather than settling it implicitly.
- `blocked` — the decision cannot be made yet, because it rests on something not known. Say
  what would unblock it and how it would be measured. A `blocked` ADR is more useful than a
  `proposed` one built on an assumption, and it stops the next reader from ratifying a guess.
- `accepted` — in effect. This is the default for a decision already live in the code.
- `superseded by NNNN` — replaced by a later ADR. Never delete an ADR; supersede it so the
  history of _why_ stays intact.

## Convention

- The title is the decision, not the topic. "Placeholders are inline data URIs" — not "LQIP".
- Keep it short. One decision, the reason, the trade-off. If you're writing a page, it's two
  ADRs.
- The `domain-modeling` and `diagnosing-bugs` skills read this directory — keep it current.
