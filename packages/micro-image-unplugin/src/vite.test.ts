import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { build, createServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import microImage from "./vite";

let root: string;

/** A 300×200 photo-sized source, and a transparent one small enough that Vite would inline it. */
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "micro-image-plugin-"));
  const gradient = Buffer.alloc(300 * 200 * 3, 0).map((_, i) => (i * 7) % 256);
  await sharp(gradient, { raw: { width: 300, height: 200, channels: 3 } })
    .jpeg({ quality: 80 })
    .toFile(join(root, "hero.jpg"));
  await sharp({ create: { width: 8, height: 4, channels: 4, background: "#c330" } })
    .png()
    .toFile(join(root, "tiny.png"));
  await writeFile(
    join(root, "main.js"),
    [
      `import hero from "./hero.jpg?micro";`,
      `import tiny from "./tiny.png?micro";`,
      `export { hero, tiny };`,
    ].join("\n")
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const buildLibrary = (origin?: string) =>
  build({
    root,
    logLevel: "silent",
    plugins: [microImage({ origin })],
    build: {
      write: true,
      outDir: "dist",
      emptyOutDir: true,
      // An app build, not library mode: library mode inlines every asset.
      rollupOptions: {
        input: join(root, "main.js"),
        preserveEntrySignatures: "strict",
        output: { entryFileNames: "main.js" },
      },
    },
  });

describe("vite build", () => {
  it("exports the intrinsic size, an inline placeholder and an absolute emitted src", async () => {
    await buildLibrary("https://example.com");
    const { hero } = await import(join(root, "dist", "main.js"));

    expect(hero.width).toBe(300);
    expect(hero.height).toBe(200);
    expect(hero.placeholder).toMatch(/^data:image\/webp;base64,/);
    expect(hero.src).toMatch(/^https:\/\/example\.com\/assets\/hero-[\w-]+\.jpg$/);

    const emitted = await readdir(join(root, "dist", "assets"));
    expect(emitted).toContain(hero.src.split("/").pop());
  });

  it("emits a file even for a source under the inline limit, because the proxy cannot fetch a data URI", async () => {
    await buildLibrary("https://example.com");
    const { tiny } = await import(join(root, "dist", "main.js") + "?tiny");

    expect(tiny.src).toMatch(/^https:\/\/example\.com\/assets\/tiny-[\w-]+\.png$/);
    expect([tiny.width, tiny.height]).toEqual([8, 4]);
  });

  it("keeps transparency in the placeholder instead of flattening it onto black", async () => {
    await buildLibrary("https://example.com");
    const { tiny } = await import(join(root, "dist", "main.js") + "?alpha");
    const bytes = Buffer.from(tiny.placeholder.split(",")[1], "base64");

    const { channels, hasAlpha } = await sharp(bytes).metadata();
    expect(hasAlpha).toBe(true);
    expect(channels).toBe(4);
  });

  it("refuses to build without an origin rather than emit a src the proxy cannot fetch", async () => {
    await expect(buildLibrary()).rejects.toThrow(/set the `origin` option/);
  });
});

describe("vite dev", () => {
  it("serves src from the dev server's own URL, and that URL returns the source bytes", async () => {
    const server = await createServer({
      root,
      logLevel: "silent",
      plugins: [microImage()],
      server: { port: 0, host: "127.0.0.1" },
    });
    await server.listen();
    try {
      const { default: hero } = await server.ssrLoadModule("/hero.jpg?micro");
      expect(hero.src).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/hero\.jpg/);

      const response = await fetch(hero.src);
      expect(response.ok).toBe(true);
      const served = Buffer.from(await response.arrayBuffer());
      expect(served.equals(await readFile(join(root, "hero.jpg")))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("asks for an origin when the dev server has no URL of its own", async () => {
    const server = await createServer({
      root,
      logLevel: "silent",
      plugins: [microImage()],
      server: { middlewareMode: true },
    });
    try {
      await expect(server.ssrLoadModule("/hero.jpg?micro")).rejects.toThrow("no URL of its own");
    } finally {
      await server.close();
    }
  });
});
