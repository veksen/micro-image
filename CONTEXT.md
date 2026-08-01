# Context

Operational detail for working in this repo. `CLAUDE.md` is the charter; this file is the map.

## Packages

npm workspaces (`apps/*`, `packages/*`) orchestrated by turbo.

| Path                             | Name                       | What it is                                              | Published |
| -------------------------------- | -------------------------- | ------------------------------------------------------- | --------- |
| `apps/cache`                     | `micro-image-cache`        | Fastify + sharp image proxy. Downloads, resizes, caches. | no        |
| `apps/docs`                      | `@micro-image/docs`        | Next.js docs site (pages router, Tailwind).              | no        |
| `apps/imgproxy`                  | `imgproxy`                 | Dockerfile only — imgproxy deployed as a render service. | no        |
| `packages/micro-image-image`     | `@micro-image/image`       | The React `<Image>` + `ImageCacheProvider`.              | **yes**   |
| `packages/micro-image-utils`     | `@micro-image/utils`       | Shared React utilities.                                  | **yes**   |
| `packages/micro-image-tsconfig`  | `@micro-image/tsconfig`    | Shared tsconfigs.                                        | no        |
| `packages/eslint-config-micro-image` | `eslint-config-micro-image` | Shared ESLint preset.                                | no        |

`.changeset/config.json` ignores the unpublished ones. Any change to a published package
needs a changeset; `CHANGELOG.md` files are generated, never hand-edited.

## Providers

`packages/micro-image-image/src/providers/` is the extension point: `base.ts` declares
`IProviderOptions`, and `micro-image.ts`, `ipx.ts`, `imgproxy.ts` each export a `generateUrl`.
Adding a provider is the archetypal change in this repo — see
`.claude/skills/image-meta-contract/` before making one.

## Commands

| Command             | Effect                                                       |
| ------------------- | ------------------------------------------------------------ |
| `npm ci`            | Install. **Never `npm install`** — see Toolchain below.       |
| `npm run test`      | `turbo run test` → vitest in cache, docs, and image.          |
| `npm run lint`      | `turbo run lint`. Note: `apps/cache` has no lint script.      |
| `npm run format`    | Prettier over `**/*.{ts,tsx,md}`.                             |
| `npm run build`     | `turbo run build`.                                            |
| `npm run changeset` | Author a changeset.                                           |
| `npm run dev`       | **Do not run.** Persistent watchers that never exit.          |

## Toolchain

> **Several of these pins are temporary.** A parallel branch is bumping libraries. The
> versions below record the current state so nothing is mistaken for intent — they are what
> the repo pins today, not what it wants long-term. Expected to change: eslint + prettier
> (→ oxlint/oxfmt), Tailwind v3 (→ v4), turbo 1.x (→ 2.x), node 20 (→ 24), React 18 (→ 19).
> The harness pieces coupled to them land in a follow-up PR, not this one.

- **node** 20.11.1 (`.nvmrc`), npm 10.2.4.
- **turbo** — root `package.json` says `"turbo": "latest"`; the lockfile pins **1.12.4**.
  `turbo.json` uses the v1 `pipeline` key, which turbo 2+ renamed to `tasks`. A fresh
  `npm install` without the lockfile resolves `latest` and breaks every task. Use `npm ci`.
  `render.yaml` runs `npm install` — a real hazard if the lockfile ever drifts.
- **eslint** 8.56 + prettier 3.2, via `eslint-config-micro-image` (extends next, turbo, prettier).
- **Tailwind** v3 in `apps/docs`, with `tailwindcss-radix-colors` (`disableSemantics: true`).
  `@theme` is v4 syntax and does not exist here; tokens go in `theme.extend`.
- **React** 18, Next.js pages router, tsup for the published packages.

## Environment variables

`turbo.json` `globalEnv` and `render.yaml` must stay in sync. A `NEXT_PUBLIC_*` added to one
and not the other is silently `undefined` in the deployed docs site. Currently four:
`PORT`, `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_IMAGE_PROXY_URL`, `NEXT_PUBLIC_IMGPROXY_URL`.

## Deployment

`render.yaml` defines three services: the cache proxy (node), the docs site (node), and
imgproxy (docker, `apps/imgproxy/Dockerfile`, with `IMGPROXY_KEY`/`IMGPROXY_SALT` unsynced).

## Known bugs

`BUGS.md` is the ledger. Read it before fixing anything in the proxy or the component — every
known defect is already pinned by two tests, and the file explains the workflow for retiring
one. **Never delete an `it.fails` ledger test to make CI pass.**

One deserves calling out here because vision milestone 2 walks straight into it:

**BUG-18 — `isAnimatedGif` misfires on ordinary JPEGs.** The guard reads byte 10, where it
expects the GIF logical screen descriptor; in a JPEG that byte is the first quantization-table
entry, whose value is set by encoder quality. It compares with bitwise AND rather than
equality, so it passes on any byte pair sharing a single bit. On one fixed image, qualities
60, 90 and 100 are all detected as animated GIFs. The route then returns the original bytes
uncompressed and unresized — and caches them under a key claiming the requested width. That
is a correctness bug and a cache-poisoning bug at once.

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
