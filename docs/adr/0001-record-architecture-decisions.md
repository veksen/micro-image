---
status: accepted
---

# Record Architecture Decisions

We keep a log of the architecturally significant decisions on this project, one Markdown file
per decision, in `docs/adr/`.

Decisions get made and then lost. Six months later someone asks "why is it done this way?",
the people who knew have moved on, and the reasoning is reconstructed — often wrongly, and
sometimes reversed at cost. This project has already lost two and a half years to dormancy;
the reasoning behind its current shape survives only in the code. A short record written at
the moment of the decision keeps the _why_ next to the code, and lets a later reader change
it deliberately instead of by accident.

The cost is small: a few paragraphs per real decision. The rule is judgment — record the
choices that are expensive to reverse or non-obvious, skip the routine ones. This ADR is
itself the first record, following Michael Nygard's
[original ADR pattern](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).
