---
"@micro-image/image": minor
"@micro-image/utils": minor
---

Build with tsdown and publish as a dual ESM/CJS package with an `exports` map.

Both packages moved from tsup to tsdown. The emitted files changed name, so the
entry points moved with them:

| field    | before            | after              |
| -------- | ----------------- | ------------------ |
| `main`   | `dist/index.js`   | `dist/index.cjs`   |
| `module` | `dist/index.mjs`  | `dist/index.mjs`   |
| `types`  | `dist/index.d.ts` | `dist/index.d.mts` |

Both packages now declare `"type": "module"` and an `exports` map with
per-condition types (`index.d.mts` for `import`, `index.d.cts` for `require`).
Deep imports into `dist/` are no longer resolvable — import from the package
root instead.

React 18 is no longer supported. `@micro-image/image` moves its `react` /
`react-dom` peer range from `^18.2.0` to `^19.0.0`, and `@micro-image/utils`,
which previously declared no peer dependency at all, now requires `react`
`^19.0.0`. Both are built and tested against React 19.
