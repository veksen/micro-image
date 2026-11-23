# Vite example

A Vite + React app that uses `@micro-image/unplugin` and `@micro-image/plugin-react`.
`src/app.tsx` shows both ways in: a bare `src` the adapter rewrites, and an explicit
`?micro` import.

## Run it

The proxy fetches each source image from this app, so it has to trust the app's origin.

```sh
npm run build -w @micro-image/image -w @micro-image/unplugin -w @micro-image/plugin-react

# terminal 1: the proxy
TRUSTED_ORIGINS=http://localhost:4173,http://localhost:5173 npm run dev -w micro-image-cache

# terminal 2: a production build, served on 4173
npm run build -w @micro-image/example-vite
npx -w @micro-image/example-vite vite preview --port 4173
```

`vite` on its own runs the dev server on 5173. Set `SITE_ORIGIN` when building for anywhere
other than `http://localhost:4173`, and `VITE_IMAGE_PROXY_URL` when the proxy is not at
`http://localhost:4000/cache`. Build the workspace directly when you set either: the root
`npm run build` goes through turbo, which drops environment variables `turbo.json` does not
declare.
