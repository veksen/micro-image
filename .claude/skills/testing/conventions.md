# Testing conventions

157 tests across three packages, run by `npm run test` → `turbo run test` → `vitest run` per
package.

## Layout

| Package                      | Config              | Tests                                                 |
| ---------------------------- | ------------------- | ----------------------------------------------------- |
| `apps/cache`                 | `vitest.config.mts` | `src/*.test.ts` — proxy, cache keys, GIF guard        |
| `packages/micro-image-image` | `vitest.config.ts`  | `src/**/*.test.{ts,tsx}` — providers, component, hook |
| `apps/docs`                  | `vitest.config.mts` | `src/**/*.test.{ts,tsx}` + `src/__tests__/`           |

The `.mts` extension is load-bearing. `apps/cache` and `apps/docs` are not
`"type": "module"`, so Vite would try to load a `.ts` config as CommonJS and fail on its
`import`. `packages/micro-image-image` is `"type": "module"` and keeps the plain `.ts`.

`apps/docs` additionally sets `oxc.jsx` in its config. Next.js requires `jsx: "preserve"` in
tsconfig, Vite honours that, and un-transformed JSX then fails import analysis.

Tests are **colocated** with their source (`imgproxy.ts` → `imgproxy.test.ts`). The one
`__tests__/` directory in the docs app holds tests with no single source file to sit beside
(`api-meta.test.ts`).

CI runs `.github/workflows/test.yml` on push to `main` and on every PR: `npm ci` → lint →
format check → test → build.

## Environment

Each config sets `environment: "node"` and `globals: false`. That means:

- **Import your test API explicitly** — `import { describe, it, expect } from "vitest"`.
  There are no globals.
- **Opt into jsdom per file**, with a docblock at the top, only where a DOM is genuinely
  needed:

```ts
/**
 * @vitest-environment jsdom
 */
```

Provider URL builders are pure functions and run in node. Component and hook tests opt into
jsdom. Don't move a pure test into jsdom for convenience — node is faster and the separation
is what keeps the provider tests honest about having no DOM dependency.

## Stubs

Each package has a `test-helpers.ts`/`.tsx` next to its tests. Use them rather than
hand-rolling a stub in a test file.

`packages/micro-image-image/src/test-helpers.tsx` provides `FakeImage`, `FakeResizeObserver`,
and `installDomStubs()`. jsdom loads no images and has no `ResizeObserver`, so both are faked.

Crucially, **every instance is recorded**. That is what lets a test observe requests the
component makes and then discards — which is exactly how BUG-1 (an image fetched whose bytes
are thrown away) is pinned. When adding a stub, record its instances for the same reason:
a test that can only see final rendered output can't catch wasted work.

## Fixtures

Byte-level tests use real encoded images, not hand-written buffers. BUG-18 exists because
byte 10 of a JPEG was read as if it were a GIF field, and its value varies with encoder
quality — a synthetic buffer would have hidden that. When testing format detection, generate
fixtures at several quality settings and assert across all of them.

## Naming

- Characterization tests carry the bug tag at the end: `"… [BUG-5]"`.
- Ledger tests lead with it: `"BUG-5: blur should be absent …"`, and state the _wanted_
  behavior, not the current one.
- Ordinary tests need no tag.
