# Shared core, thin adapters

The build-time plugin ships as **`unplugin`**, so one implementation covers Vite, Rollup,
Webpack, esbuild, Rspack, and Rolldown.

## The boundary

**The shared core owns everything that isn't template syntax:**

- the `?micro` module loader — reads a local image path, runs sharp, emits hashed assets,
  returns `ImageMeta`
- the cache layer, keyed on file hash + config, so rebuilds stay fast
- the `ImageMeta` codec (serialize/deserialize into module output)
- config resolution — srcset ladder, format preferences, LQIP strategy, quality

The core has **zero framework knowledge**.

**Each adapter does exactly one thing:** find `<Image>` elements whose import binding resolves
to `@micro-image/image`, and rewrite them to hoist a `?micro` import and spread its result.

```jsx
// authored
<Image src="./hero.jpg" alt="…" />;

// after transform (conceptual)
import _micro0 from "./hero.jpg?micro";
<Image {..._micro0} alt="…" />;
```

| Package                      | Transforms                    | Parser              |
| ---------------------------- | ----------------------------- | ------------------- |
| `@micro-image/plugin-react`  | JSX in `.jsx`/`.tsx`          | babel or oxc        |
| `@micro-image/plugin-solid`  | JSX (same shape as React)     | babel               |
| `@micro-image/plugin-preact` | JSX (same shape as React)     | babel               |
| `@micro-image/plugin-vue`    | `<Image>` in SFC `<template>` | `@vue/compiler-sfc` |
| `@micro-image/plugin-svelte` | `<Image>` in `.svelte`        | `svelte/compiler`   |
| `@micro-image/plugin-astro`  | `<Image>` in `.astro`         | `@astrojs/compiler` |

**An adapter that grows a second job is a bug.** The moment file reading or resizing leaks
into one, the next framework costs thousands of lines instead of hundreds — and the success
criterion in `VISION.md` is explicitly that adding a framework stays in the hundreds.

## Binding detection

Do **not** hand-roll data-flow analysis. Use the parser's own scope/binding API to check that
a given `<Image>` identifier resolves to a module import from `@micro-image/image`. That
handles renames, shadowing, and reassignment for free, and safely skips anything indirect.

## Precision, not recall

Never transform something you cannot prove is yours.

This is safe because the runtime path already works: a missed static resolution degrades to a
`?meta` fetch — one small JSON request. So the transform is a **pure optimization**, and its
failure mode is a slightly slower page.

A wrong transform is not symmetric. It rewrites code the plugin doesn't own, and the failure
surfaces at build time in someone else's project.

When the analysis genuinely can't reach a case — barrel re-exports, HOC wrappers — the
query-import stays available as an explicit override:

```ts
import hero from "./hero.jpg?micro";
<Image {...hero} />;
```

Not the DX the north star promises, but the pressure valve for the 1% the sugar can't reach.

## Scope guard

**Don't ship framework packages until the shared core stabilizes.** React first, then
Vue/Svelte/Astro, then Solid/Preact. Six adapters against an unstable core means six rewrites.

`0005` (framework integration — coexist with `getImage()`/`<NuxtImg>` or ship our own
everywhere) and `0008` (Turbopack/Rspack coverage) are open ADRs that shape this. Resolve
before building the adapter they affect.
