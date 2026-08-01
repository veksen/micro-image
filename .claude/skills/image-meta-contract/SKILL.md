---
name: image-meta-contract
description: Use whenever touching how image metadata or image URLs are produced or consumed in this repo — adding or changing a provider under packages/micro-image-image/src/providers/, changing the <Image> component's props or its srcset/sizes/placeholder output, adding or changing the proxy's ?meta endpoint, or writing any part of the planned unplugin core or a @micro-image/plugin-* framework adapter. Covers the ImageMeta contract that every path must produce, the shared-core-vs-thin-adapter boundary, and the precision-over-recall rule for AST transforms. Load before designing the change, not after.
---

# The ImageMeta contract

Two invariants hold this project together. Neither is enforced by tooling, and both decay
silently as the repo grows from four packages to roughly eight. The detail lives in the files
next to this one — read the one that matches what you're changing.

- **`contract.md`** — the `ImageMeta` shape, why every path must produce it, and what changing
  it costs.
- **`adapters.md`** — the shared-core-vs-adapter boundary, and the binding-detection rule for
  framework transforms.

## The short version

**One shape, three paths.** Build-time (`unplugin` + `?micro` loader), runtime-dynamic (proxy
`?meta` endpoint), and no-proxy (`sizes="auto"` + native `srcset`) all produce the same
`ImageMeta`. The component takes every field as an optional prop: present → use it, missing →
fetch it. That invariant is what lets one component serve all three. A change that makes one
path produce a different shape is the failure mode that ends the project.

**Adapters do one thing.** A `@micro-image/plugin-*` package finds `<Image>` elements whose
import binding resolves to `@micro-image/image` and rewrites them to hoist a `?micro` import
and spread its result. File reading, sharp, caching, the `ImageMeta` codec, and LQIP live in
the shared core. An adapter that grows a second job is a bug — it means the next framework
costs thousands of lines instead of hundreds.

**Precision, not recall.** Never transform what you cannot prove is yours. Use the parser's
own scope/binding API; never hand-roll data-flow analysis. This is safe because a missed
static resolution degrades to a `?meta` fetch — the transform is a pure optimization, and the
`?micro` query-import is the escape hatch for what the analysis can't reach. A wrong transform
corrupts a build; a missed one costs one small JSON request.

## Before you change the contract

Adding a field is additive and cheap. Renaming or removing one breaks every path at once and
is a published-API change to `@micro-image/image` — it needs a changeset and an ADR. Several
of the open ADRs in `docs/adr/` (`0002` LQIP encoding, `0003` srcset ladder, `0006` prop
injection surface) decide parts of this shape. Resolve the relevant one rather than settling
it implicitly in code.
