> [!WARNING]
> This set of package is still in development, not meant to be used at the time being.

# micro-image

This project is a multi-package with 2 main components:

- A self-hosted image proxy, meant to cache and compress images
- An image component (currently for React), that uses an image proxy to render the correctly

## Future plans

- Supporting (already partly implemented) multiple image proxy providers, like ipx (already supported), imgproxy, cloudinary.
- Providing components for various front-end frameworks.
- Providing the image proxy as a service

## Usage

Coming soon :)

### Apps and Packages

- `cache`: image proxy powered by [Fastify](https://fastify.dev/)
- `docs`: A placeholder documentation site powered by [Next.js](https://nextjs.org/)
- `@micro-image/image`: React image component
- `@micro-image/utils`: shared React utilities
- `@micro-image/tsconfig`: shared `tsconfig.json`s used throughout the monorepo

Each package and app is 100% [TypeScript](https://www.typescriptlang.org/).

Linting and formatting are repo-wide rather than per-package, configured in
`.oxlintrc.json` ([oxlint](https://oxc.rs/docs/guide/usage/linter)) and
`.oxfmtrc.json` ([oxfmt](https://oxc.rs/docs/guide/usage/formatter)).

### Useful commands

- `npm run build` - Build all packages, the image proxy and docs site
- `npm run dev` - Develop all packages, the image proxy and the docs site
- `npm run typecheck` - Type-check every package
- `npm run lint` - Lint the repo with oxlint
- `npm run format` - Format the repo with oxfmt (`format:check` to verify only)
- `npm run changeset` - Generate a changeset
- `npm run clean` - Clean up all `node_modules` and `dist` folders (runs each package's clean script)
