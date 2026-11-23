import { basename } from "node:path";
import type { UnpluginFactory } from "unplugin";
import type { ViteDevServer } from "vite";
import { readSourceMeta } from "./meta";

export type { SourceMeta } from "./meta";

export interface MicroImageOptions {
  /**
   * The public origin the site is served from, e.g. `https://example.com`.
   *
   * The proxy fetches the source by URL, so `src` has to be absolute. Required
   * for a build. In dev it defaults to `server.origin`, then to the URL the dev
   * server listens on. The proxy can only reach either if `TRUSTED_ORIGINS`
   * lists it.
   */
  origin?: string;
}

const query = "?micro";

/**
 * Only `./vite` wraps this. The loader leans on Vite's `?no-inline` and its
 * asset URLs, so the other bundlers unplugin targets would build wrong output.
 * ADR 0008: a bundler is claimed once it is verified.
 */
export const unpluginFactory: UnpluginFactory<MicroImageOptions | undefined> = (options = {}) => {
  let devServer: ViteDevServer | undefined;
  let serving = false;

  const resolveOrigin = () => {
    if (options.origin) return options.origin;
    if (!serving) {
      throw new Error(
        "micro-image: set the `origin` option. The proxy fetches each image by absolute URL, " +
          "and a build cannot know the URL the site will be served from."
      );
    }
    const devUrl = devServer?.config.server.origin ?? devServer?.resolvedUrls?.local[0];
    if (devUrl) return devUrl;
    // Middleware mode, or a module loaded before the server listens.
    throw new Error(
      "micro-image: set the `origin` option or `server.origin`. This dev server has no URL " +
        "of its own for the proxy to fetch images from."
    );
  };

  return {
    name: "@micro-image/unplugin",
    // Ahead of Vite's asset plugin, which would otherwise claim `hero.jpg?micro`
    // as a plain asset and return its URL.
    enforce: "pre",
    load: {
      filter: { id: /\?micro$/ },
      async handler(id) {
        const file = id.slice(0, -query.length);
        this.addWatchFile(file);
        const meta = await readSourceMeta(file);
        const origin = resolveOrigin();

        // The bundler emits and hashes the file itself; `no-inline` stops Vite
        // turning a small one into a data URI the proxy could not fetch.
        const asset = JSON.stringify(`./${basename(file)}?no-inline`);
        return [
          `import url from ${asset};`,
          `export default {`,
          `  src: new URL(url, ${JSON.stringify(origin)}).href,`,
          `  width: ${meta.width},`,
          `  height: ${meta.height},`,
          `  placeholder: ${JSON.stringify(meta.placeholder)},`,
          `};`,
        ].join("\n");
      },
    },
    vite: {
      configResolved(config) {
        serving = config.command === "serve";
      },
      configureServer(server) {
        devServer = server;
      },
    },
  };
};
