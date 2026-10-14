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

| Path              | Who fills `ImageMeta`                      | Cost                   |
| ----------------- | ------------------------------------------ | ---------------------- |
| Build-time static | `unplugin` + `?micro` loader, at build     | zero runtime           |
| Runtime dynamic   | proxy `?meta` endpoint                     | one small JSON request |
| No proxy          | native `srcset` + `sizes` (`auto` if lazy) | zero, but no LQIP      |

If a path starts producing a differently-shaped object, the component has to learn where its
props came from — and at that point every future framework adapter has to learn it too. That
is the failure mode this contract exists to prevent.

## Rules

- **`srcset` is capped at the intrinsic width.** Never emit entries wider than the source. A
  phantom `2400w` for a 900px image asks the browser to download an upscale.
- **`width`/`height` are intrinsic pixels**, not rendered size. They exist to reserve layout
  space and prevent CLS, via `aspect-ratio` — not to select a variant.
- **`sizes` ships in the first paint, and the observer refines it.** The build knows the
  image; a `ResizeObserver` knows the container. A lazy image uses `sizes="auto"`, which picks
  from the container width after layout with no guess. An eager (above-the-fold) image cannot
  wait for layout, so the build bakes an initial `sizes` and the observer corrects it.
  Browsers upgrade a candidate on resize but never downgrade, so a bake that is too large
  costs bytes the observer cannot take back. `sizes="auto"` alone is never the mechanism for
  an eager image: it requires `loading="lazy"`. See `VISION.md` § How container-width
  selection works.
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

The component does not implement all of this yet. It generates its own srcset (100px steps,
capped at intrinsic width and at 1900w) rather than consuming one, and fetches a blurred placeholder over the network instead of inlining it
(BUG-2). It has no build-time `sizes`: a lazy image uses `sizes="auto"`, and an eager one
falls back to the viewport capped at intrinsic width unless the caller passes `sizes`. Read the
ledger tests before changing this code — they encode the target behavior.

BUG-10 is closed: `srcset` and `sizes` ship in the first paint. BUG-1 is closed. The `useImage` hook that called a URL whose bytes were discarded is gone, and
the rendered element's own `onError` reports failure.
