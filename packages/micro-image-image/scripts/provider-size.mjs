// Reproduces the byte counts in docs/adr/0011-provider-selection.md.
//
//   npm run size -w @micro-image/image
//
// Bundles a minimal consumer against the package source, once per provider, and
// compares each against a counterfactual: the same source with
// image-cache-provider.tsx replaced by a module that imports and returns exactly
// one provider. That counterfactual is the floor any pay-for-what-you-use design
// can reach, and it is spelled out in full below so the numbers can be re-derived
// rather than taken on trust.
//
// React is external, so the percentages this prints are shares of the library's
// own payload, not of a real application's.
import { rolldown } from "rolldown";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(PKG, "src");
const PROVIDERS = ["micro-image", "ipx", "imgproxy"];

/**
 * image-cache-provider.tsx as it would read with the provider chosen statically.
 * Everything the real module does is kept — the context, the config defaults, the
 * hook — so the only difference from `main` is the `switch` and the two imports
 * it forces.
 */
const staticallySelected = (provider, keepDefault) => `import React from "react";
import { generateUrl } from "./providers/${provider}";
${keepDefault ? `import { generateUrl as fallback } from "./providers/${keepDefault}";` : ""}
import { IProviderOptions } from "./providers/base";

export const defaultConfig = {
  provider: "${keepDefault ?? provider}",
  generateUrl: ${keepDefault ? "fallback" : "generateUrl"},
  cacheProxyUrl: "http://localhost:4000/cache",
};

export interface IImageCacheProviderConfig<
  GeneratorOptions extends IProviderOptions = IProviderOptions,
> {
  provider: string;
  cacheProxyUrl: string;
  defaultGeneratorOptions?: Partial<GeneratorOptions>;
}

const ImageCacheContext = React.createContext(null);

export function ImageCacheProvider(config) {
  return (
    <ImageCacheContext.Provider
      value={{
        provider: config.provider || defaultConfig.provider,
        cacheProxyUrl: config.cacheProxyUrl || defaultConfig.cacheProxyUrl,
        defaultGeneratorOptions: config.defaultGeneratorOptions,
      }}
    >
      {config.children}
    </ImageCacheContext.Provider>
  );
}

export function useImageCacheConfig() {
  const config = React.useContext(ImageCacheContext);
  // No provider given: fall back to whatever the package ships as the default,
  // which is what keeps that one provider reachable however the code is shaped.
  if (!config) return { ...defaultConfig };
  return { ...config, generateUrl };
}
`;

const dir = await mkdtemp(join(tmpdir(), "micro-image-size-"));

async function consumerFor(provider) {
  const file = join(dir, `consumer-${provider}.js`);
  await writeFile(
    file,
    `import { createElement } from "react";
import Image, { ImageCacheProvider } from ${JSON.stringify(join(SRC, "index.tsx"))};

export const App = () =>
  createElement(
    ImageCacheProvider,
    { provider: ${JSON.stringify(provider)}, cacheProxyUrl: "https://cdn.example.com/cache" },
    createElement(Image, {
      src: "https://example.com/hero.jpg",
      width: 1600,
      height: 900,
      alt: "hero",
    }),
  );
`
  );
  return file;
}

async function bundle(input, patchTo, { keepDefault } = {}) {
  const plugins = patchTo
    ? [
        {
          name: "statically-selected-provider",
          load: (id) =>
            id.endsWith("image-cache-provider.tsx")
              ? { code: staticallySelected(patchTo, keepDefault), moduleType: "tsx" }
              : null,
        },
      ]
    : [];

  const build = await rolldown({
    input,
    external: ["react", "react-dom", "react/jsx-runtime"],
    treeshake: true,
    plugins,
  });
  const { output } = await build.generate({ format: "esm", minify: true });
  await build.close();
  return output
    .filter((chunk) => chunk.type === "chunk")
    .map((chunk) => chunk.code)
    .join("");
}

const sizes = (code) => ({
  min: Buffer.byteLength(code),
  gzip: gzipSync(code).length,
  brotli: brotliCompressSync(code).length,
});

const rows = [];
for (const provider of PROVIDERS) {
  const consumer = await consumerFor(provider);
  const today = sizes(await bundle(consumer));
  const shaken = sizes(await bundle(consumer, provider));
  rows.push({
    provider,
    today,
    shaken,
    cost: {
      min: today.min - shaken.min,
      gzip: today.gzip - shaken.gzip,
      brotli: today.brotli - shaken.brotli,
    },
  });
}

const col = (value, width) => String(value).padStart(width);
console.log("A consumer that selects one provider, and what the other two cost it.\n");
console.log("provider       today (min/gzip/br)   shaken (min/gzip/br)   cost (min/gzip/br)");
for (const row of rows) {
  console.log(
    row.provider.padEnd(15) +
      `${col(row.today.min, 5)}/${col(row.today.gzip, 5)}/${col(row.today.brotli, 5)}   ` +
      `${col(row.shaken.min, 6)}/${col(row.shaken.gzip, 5)}/${col(row.shaken.brotli, 5)}   ` +
      `${col(row.cost.min, 5)}/${col(row.cost.gzip, 5)}/${col(row.cost.brotli, 5)}`
  );
}

// What the zero-config default costs a consumer who selected something else.
// `useImageCacheConfig` falls back to `defaultConfig.provider` when no provider is
// given, so whichever provider is the default stays reachable by construction —
// even under the statically-selected design. Measured by bundling an ipx consumer
// twice: once with micro-image still standing as the default, once with none.
const ipxConsumer = await consumerFor("ipx");
const withDefault = sizes(await bundle(ipxConsumer, "ipx", { keepDefault: "micro-image" }));
const withoutDefault = sizes(await bundle(ipxConsumer, "ipx"));
console.log(
  `\nthe unshakeable zero-config default costs an ipx consumer ` +
    `${withDefault.min - withoutDefault.min} B minified, ` +
    `${withDefault.gzip - withoutDefault.gzip} B gzip.`
);
