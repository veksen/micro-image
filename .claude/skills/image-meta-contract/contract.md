# The `ImageMeta` shape

```ts
interface ImageMeta {
  src: string; // canonical URL or emitted asset URL
  width: number; // intrinsic pixel width
  height: number; // intrinsic pixel height
  srcset: string; // capped at intrinsic width
  placeholder?: string; // data-URI LQIP or blurhash
  sizes?: string; // optional viewport-based hint for above-the-fold
}
```

## Why every path produces it

The component accepts each field as an **optional prop**. Present → use it. Missing → fetch it
from the proxy `?meta` endpoint at runtime.

That single rule is what lets one component serve three different acquisition paths without
branching on which one produced its data:

| Path              | Who fills `ImageMeta`                       | Cost                   |
| ----------------- | ------------------------------------------- | ---------------------- |
| Build-time static | `unplugin` + `?micro` loader, at build      | zero runtime           |
| Runtime dynamic   | proxy `?meta` endpoint                      | one small JSON request |
| No proxy          | `sizes="auto"` + native `srcset`, at layout | zero, but no LQIP      |

If a path starts producing a differently-shaped object, the component has to learn where its
props came from — and at that point every future framework adapter has to learn it too. That
is the failure mode this contract exists to prevent.

## Rules

- **`srcset` is capped at the intrinsic width.** Never emit entries wider than the source. A
  phantom `2400w` for a 900px image asks the browser to download an upscale.
- **`width`/`height` are intrinsic pixels**, not rendered size. They exist to reserve layout
  space and prevent CLS, via `aspect-ratio` — not to select a variant.
- **`sizes` is an escape hatch, not the mechanism.** Container-width selection comes from
  `sizes="auto"`. An explicit `sizes` is only for above-the-fold images that opt out via
  `priority`, where the preload scanner has to act before layout.
- **`placeholder` is optional and always inline.** If producing it costs a network request at
  runtime, don't produce it — the round trip is worse than no placeholder.

## Changing the shape

Adding an optional field is additive and cheap.

Renaming or removing a field breaks all three paths simultaneously **and** is a published-API
change to `@micro-image/image`. It needs a changeset and an ADR.

Three of the open ADRs decide parts of this shape directly — resolve the relevant one instead
of settling it implicitly in code:

- `0002` — LQIP encoding (data-URI vs blurhash) decides what `placeholder` holds.
- `0003` — srcset ladder (fixed vs per-image) decides how `srcset` is generated.
- `0006` — prop injection surface (spread `{...meta}` vs a single `_micro` prop) decides
  whether these are props at all.

## Today's gap

The component does not implement this yet. It currently generates a 19-entry srcset uncapped
at intrinsic width, attaches it with a `ResizeObserver` after mount rather than on the first
paint, and fetches a blurred placeholder over the network instead of inlining it. Those are
BUG-2 and BUG-10 in `BUGS.md`, and vision milestone 1 is the work of closing them. Read the
ledger tests before changing this code — they encode the target behavior.

BUG-1 is closed. The `useImage` hook that called a URL whose bytes were discarded is gone, and
the rendered element's own `onError` reports failure.
