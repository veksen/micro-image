---
status: proposed
---

# A provider is selected by passing its generator in, not by naming it

**Not ratified.** Answers [#40](https://github.com/veksen/micro-image/issues/40).

## Context

`image-cache-provider.tsx` statically imports all three URL builders and picks one in
`getGeneralUrlFunction`, a `switch` over a runtime string. A switch over a value that is not
known until render is not statically analysable, so no bundler can drop the untaken branches.
Every consumer ships every provider. The packaging is not the problem — `sideEffects: false`
is set and tsdown emits real ESM — the shape of the code is.

### What it costs today

Run `npm run size -w @micro-image/image` to reproduce. The script bundles a minimal consumer
(`<ImageCacheProvider>` wrapping one `<Image>`) with rolldown 1.2.1, minified, react external,
from `src/index.tsx` — once per provider. The counterfactual is the same source with
`image-cache-provider.tsx` replaced by a module that imports and returns exactly one provider,
spelled out in full in the script so the numbers can be re-derived rather than trusted. That
counterfactual is the floor any pay-for-what-you-use design can reach.

| consumer selects | today (min/gzip) | shaken (min/gzip) | cost of the other two |
| ---------------- | ---------------: | ----------------: | --------------------: |
| micro-image      |      3503 / 1513 |       2678 / 1223 |         825 B / 290 B |
| ipx              |      3495 / 1517 |       2692 / 1229 |         803 B / 288 B |
| imgproxy         |      3500 / 1517 |       2902 / 1339 |         598 B / 178 B |

So 300–410 B minified per unused provider, and 12–19% of the library's own payload — a share of
the package, not of an application, since React is external.

**That doubled while this ADR was being written.** Measured against the parent of
[#11](https://github.com/veksen/micro-image/issues/11) and
[#12](https://github.com/veksen/micro-image/issues/12), the same table read 583–607 B minified
and 142–163 B gzip. Making the ipx and imgproxy URLs correct grew `imgproxy.ts` from 27 lines to
72 and `ipx.ts` from 24 to 34, and every byte of that went to consumers of neither. Nothing was
added to the provider list to cause it. This is the trajectory argument arriving early: the
survey in [#41](https://github.com/veksen/micro-image/issues/41) contemplates six more
providers, and correctness alone moves the number without them.

Bytes are the smaller half of the argument. A signed provider (imgix, Thumbor, Cloudinary) needs
an HMAC implementation, and a switch makes every provider's dependencies mandatory for every
consumer. The byte cost is linear and visible; the dependency cost is neither.

### Three facts that narrow the options

**A string-keyed compatibility shim cannot work.** Any mapping from `"ipx"` to a module has to
reference every module it can return, which is the thing being removed. The string either goes
away or nothing is gained.

**The published type surface is narrower than it looks.** `dist/index.d.mts` declares
`SupportedProviders` and `IImageCacheProviderConfig`, but `index.tsx` re-exports neither, so no
consumer can import them by name. The break lands at the call site — `provider="ipx"` stops
type-checking — not on an imported identifier.

**CJS can never be shaken.** `dist/index.cjs` (9.54 kB raw, 3.43 kB gzip) contains `btoa`, the
imgproxy-only call, and always will. No code shape fixes `require()`; only separate entry
points do.

## Decision (proposed)

`provider` takes the generator function itself.

```tsx
import Image, { ImageCacheProvider, ipx } from "@micro-image/image";

<ImageCacheProvider provider={ipx} cacheProxyUrl={URL}>
  <Image src="./hero.jpg" width={1600} height={900} />
</ImageCacheProvider>;
```

The consumer's import _is_ the selection, so shaking needs no cooperation from the bundler beyond
ESM. `SupportedProviders` is replaced by the generator's own signature,
`(options: IProviderOptions) => string`, which is already the shape `image.component.tsx`
consumes.

Omitting `provider` still selects `micro-image`, so the zero-config path in `VISION.md`
survives. That default is unshakeable by construction — an ipx consumer retains it — and was
measured at **239 B minified / 48 B gzip**, which is not worth making `provider` required for.

**What this gives the build-time plugin, and what it does not.** The plugin
([ADR 0005](0005-framework-integration.md)) has to know the provider to bake URLs at build time.
A string tells it nothing about which module to load; it would have to resolve the value through
a config file, an env var, or a JSX attribute first. A generator is resolved by the mechanism
`VISION.md` already mandates for `<Image>` itself — the parser's scope/binding API, asking
whether an identifier traces to an import from `@micro-image/image`. Renames, shadowing and
reassignment come free with it.

It does not make the general case resolvable. A generator behind a barrel re-export, an HOC, or
a conditional will not trace, and precision-over-recall says leave it alone: an unresolved
provider degrades to the `?meta` runtime path, which is the same pressure valve the transform
already relies on. So this decision removes one lookup from the plugin's job. It does not remove
the need for a fallback, and specifying that fallback stays the plugin's own ADR.

Subpath exports (`@micro-image/image/providers/ipx`) are **deferred, not rejected**. They add
nothing for ESM consumers, who already reach the floor above, and they turn the `exports` map
into public API. Revisit them when either the CJS build gains an audience worth optimizing for
or a provider arrives with a dependency heavy enough that keeping it out of the root module's
graph is worth the entry point.

Rejected: a runtime registry. Registration is a side effect at module scope, which contradicts
`sideEffects: false`, and a registry lookup is exactly as opaque to the build-time plugin as the
switch it replaces.

## Consequences

- **Breaking, and it needs a changeset.** `provider="micro-image" | "ipx" | "imgproxy"` stops
  compiling. The package is at 0.0.3, so this is as cheap as it will ever be. The changeset must
  spell out the string → function migration; there is no deprecation path, per the shim argument
  above.
- Adding a provider stops taxing every consumer, which is what makes #41 affordable.
- CJS consumers are unaffected and stay unaffected. That is a real gap, documented rather than
  hidden.
- **BUG-35 pins this.** `src/tree-shaking.test.ts` bundles a one-provider consumer and asserts
  against rolldown's module graph. That is a behavioural fact, exact and reproducible, where a
  byte budget would churn on a pre-1.0 library. The `it.fails` ledger test goes red the day this
  ADR is implemented. It reads the provider list off disk, so a provider added later is covered
  without editing it. The byte counts above are not gated; `npm run size` recomputes them.
