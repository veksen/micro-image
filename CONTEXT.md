# Context

Operational detail for working in this repo. `CLAUDE.md` is the charter; this file is the map.

## Packages

npm workspaces (`apps/*`, `packages/*`) orchestrated by turbo.

| Path                            | Name                    | What it is                                               | Published |
| ------------------------------- | ----------------------- | -------------------------------------------------------- | --------- |
| `apps/cache`                    | `micro-image-cache`     | Fastify + sharp image proxy. Downloads, resizes, caches. | no        |
| `apps/docs`                     | `@micro-image/docs`     | Next.js docs site (pages router, Tailwind).              | no        |
| `apps/imgproxy`                 | `imgproxy`              | Dockerfile only — imgproxy deployed as a render service. | no        |
| `packages/micro-image-image`    | `@micro-image/image`    | The React `<Image>` + `ImageCacheProvider`.              | **yes**   |
| `packages/micro-image-utils`    | `@micro-image/utils`    | Shared React utilities.                                  | **yes**   |
| `packages/micro-image-tsconfig` | `@micro-image/tsconfig` | Shared tsconfigs.                                        | no        |

`.changeset/config.json` ignores the unpublished ones. Any change to a published package
needs a changeset; `CHANGELOG.md` files are generated, never hand-edited.

## Providers

`packages/micro-image-image/src/providers/` is the extension point: `base.ts` declares
`IProviderOptions`, and `micro-image.ts`, `ipx.ts`, `imgproxy.ts` each export a `generateUrl`.
Adding a provider is the archetypal change in this repo — see
`.claude/skills/image-meta-contract/` before making one.

## Glossary

Use these terms as defined here. When output names one of these concepts — an issue title, a
test name, a proposal — use the term, not a synonym.

- **`ImageMeta`** — the six-field contract (`src`, `width`, `height`, `srcset`,
  `placeholder?`, `sizes?`) that every acquisition path produces and the component consumes.
  Not "image data" or "image info".
- **Provider** — a URL builder for one image proxy, under
  `packages/micro-image-image/src/providers/`. Each exports `generateUrl`. `ipx`, `imgproxy`,
  and `micro-image` are providers; the proxy in `apps/cache` is a _proxy_, not a provider.
- **Proxy** — the server that resizes, compresses, and caches. Self-hosted. `apps/cache` is a
  reference implementation of one.
- **Core** — the framework-agnostic half of the planned build-time plugin: the `?micro`
  loader, cache layer, `ImageMeta` codec, config resolution.
- **Adapter** — a `@micro-image/plugin-*` package. Finds `<Image>` and rewrites it. Nothing
  else. Not "plugin" on its own, which is ambiguous between the two.
- **LQIP** — the inline low-quality placeholder carried in `ImageMeta.placeholder`. Encoding
  is undecided (ADR-0002).
- **srcset ladder** — the set of widths emitted in `srcset`, clamped to intrinsic width
  (ADR-0003). Not "breakpoints", which are a CSS concept.
- **Characterization test** — asserts what the code does _today_, tagged `[BUG-n]`. Keeps CI
  green and catches regressions.
- **Ledger test** — an `it.fails` test asserting what the code _should_ do. Passes while the
  bug exists, fails when it is fixed. See `BUGS.md`.

## Commands

| Command             | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| `npm ci`            | Install. The default — see Toolchain below.                |
| `npm run test`      | `turbo run test` → vitest in cache, docs, and image.       |
| `npm run typecheck` | `turbo run typecheck` → `tsc --noEmit` in every package.   |
| `npm run lint`      | `oxlint` over the whole repo. Not a turbo task.            |
| `npm run format`    | `oxfmt` over the whole repo. `format:check` verifies only. |
| `npm run build`     | `turbo run build`.                                         |
| `npm run changeset` | Author a changeset.                                        |
| `npm run dev`       | **Do not run.** Persistent watchers that never exit.       |

Lint and format are single repo-wide binaries, not per-package turbo tasks. There is no
`lint` script in any workspace and no `lint` task in `turbo.json`.

## Toolchain

Every dependency is pinned to an explicit range. Nothing resolves `latest`.

- **node** 24.18.0 (`.nvmrc`, `engines`), npm 11.16.0 (`packageManager`).
- **turbo** 2.10.8. `turbo.json` uses the v2 `tasks` key; v1 called it `pipeline`. v2 also
  dropped `globalDotEnv`, so `.env` is listed under `globalDependencies`.
- **TypeScript** 7.0.2, the native port. It removed `baseUrl` and `moduleResolution: node10`
  and requires an explicit `rootDir` when emitting. Next.js cannot use its compiler API, so
  `apps/docs` sets `experimental.useTypeScriptCli`.
- **oxlint** 1.76 (`.oxlintrc.json`) and **oxfmt** 0.61 (`.oxfmtrc.json`), replacing eslint
  and prettier. `turbo/no-undeclared-env-vars` has no oxlint equivalent and is simply gone;
  `turbo.json` `globalEnv` remains the only declaration of those vars.
- **Tailwind** v4 in `apps/docs`, configured CSS-first in `src/globals.css`. There is no
  `tailwind.config.js`. PostCSS loads `@tailwindcss/postcss`; autoprefixer is built in.
  `tailwindcss-radix-colors` 2.x is a pure-CSS package with no JS plugin — the old
  `disableSemantics: true` is now an import of `dist/all-colors-only.css`.
- **React** 19, Next.js 16 pages router, **tsdown** for the published packages. Both publish
  dual ESM/CJS behind an `exports` map and declare `"type": "module"`.
- **vitest** 4 on Vite 8. `apps/cache` and `apps/docs` name their configs `vitest.config.mts`
  because neither package is `"type": "module"` and Vite will not load an ESM `.ts` config.
- **rolldown** 1.2, a devDependency of `packages/micro-image-image` only. It is the bundler
  tsdown already runs; it is declared explicitly there because `tree-shaking.test.ts` and
  `scripts/provider-size.mjs` import it directly rather than relying on hoisting.

### Installing

`npm ci` is the default: it installs exactly what the lockfile records and never rewrites it.
Use `npm install` only when deliberately changing a dependency, then commit the lockfile it
produces. `.claude/hooks/guard-write.sh` enforces that the lockfile is not hand-edited.

## Environment variables

`turbo.json` `globalEnv` and `render.yaml` must stay in sync. A `NEXT_PUBLIC_*` added to one
and not the other is silently `undefined` in the deployed docs site. Currently four:
`PORT`, `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_IMAGE_PROXY_URL`, `NEXT_PUBLIC_IMGPROXY_URL`.

## Deployment

`render.yaml` defines three services: the cache proxy (node), the docs site (node), and
imgproxy (docker, `apps/imgproxy/Dockerfile`, with `IMGPROXY_KEY`/`IMGPROXY_SALT` unsynced).

The imgproxy provider generates **unsigned** URLs — it emits the literal `insecure` in the
signature position, because computing the HMAC would mean shipping the key to the browser. So
that imgproxy service has to run with no key and no salt set; setting either one makes it
reject everything `@micro-image/image` generates. The docs showcase renders its imgproxy
section only when `NEXT_PUBLIC_IMGPROXY_URL` is set, and says so when it is not.

## Known bugs

`BUGS.md` is the ledger. Read it before fixing anything in the proxy or the component — every
known defect is already pinned by two tests, and the file explains the workflow for retiring
one. **Never delete an `it.fails` ledger test to make CI pass.**

One deserves calling out here because vision milestone 2 walks straight into it:

**Animation detection, and why it is not a byte parser any more.** The proxy used to decide
whether an image animated by reading fixed offsets out of the GIF container, and it got the
answer wrong in both directions. BUG-18 was the false positive: byte 10 of a JPEG is a
quantization-table entry whose value is set by encoder quality, the guard compared with
bitwise AND rather than equality, and on one fixed image qualities 60, 90 and 100 all came
back as animated GIFs — so the route returned the original bytes uncompressed and unresized,
and cached them under a key claiming the requested width. #52 was the false negative left
behind by that fix: every looping GIF puts a NETSCAPE 2.0 Application Extension at exactly the
offset the guard expected a Graphics Control Extension, so 30 frames went in and 1 came out,
and animated WebP was never checked at all.

`apps/cache/src/is-animated.ts` now asks libvips — `metadata().pages`, a header read on a
default load — and the route passes any multi-frame image through untouched. Read it before
adding a format: mime cannot express animation, and only the container can.

## Roadmap

From `VISION.md`. Each step is independently useful and does not strictly require the next.

1. **Fix the component runtime** — `sizes="auto"`, drop dead fetches, capped srcset,
   aspect-ratio via CSS. No server changes.
2. **Proxy quick wins** — `Cache-Control` on hits, request coalescing, `Accept`-based
   AVIF/WebP, and format in the cache key.
3. **Proxy `?meta` endpoint** — retires `getImageProportions`, which downloads a whole image
   to read two integers.
4. **Component `?meta` fallback** — dynamic `src` becomes one small JSON request.
5. **`unplugin` scaffold + `?micro` loader** — framework-agnostic core, no JSX transform yet.
6. **React JSX transform** — the transparent DX layer, lowered onto step 5.
7. **Vue / Svelte / Astro transforms** — one at a time, on the shared core.

By the end of step 4 the runtime story is complete. Steps 5–7 unlock the zero-config DX.
