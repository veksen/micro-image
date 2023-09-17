> [!WARNING]
> This set of package is still in development, not meant to be used at the time being.

# micro-image

This project is a multi-package with 2 main components:
- An image proxy, meant to cache and compress images
- An image component (currently for React), that uses an image proxy to render the correctly

### Apps and Packages

- `cache`: image proxy powered by [Fastify](https://fastify.dev/)
- `docs`: A placeholder documentation site powered by [Next.js](https://nextjs.org/)
- `@micro-image/image`: React image component
- `@micro-image/utils`: shared React utilities
- `@micro-image/tsconfig`: shared `tsconfig.json`s used throughout the monorepo
- `eslint-config-micro-image`: ESLint preset

Each package and app is 100% [TypeScript](https://www.typescriptlang.org/).

### Useful commands

- `yarn build` - Build all packages, the image proxy and docs site
- `yarn dev` - Develop all packages, the image proxy and the docs site
- `yarn lint` - Lint all packages
- `yarn changeset` - Generate a changeset
- `yarn clean` - Clean up all `node_modules` and `dist` folders (runs each package's clean script)
