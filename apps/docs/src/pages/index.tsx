import Image, { ImageCacheProvider } from "@micro-image/image";

export default function Docs() {
  return (
    <div>
      <h1>micro-image Documentation</h1>

      <div style={{ maxWidth: "800px" }}>
        <ImageCacheProvider
          provider="micro-image"
          cacheProxyUrl="https://micro-image-cache.onrender.com/cache"
        >
          <h2>Local image using micro-image proxy</h2>
          <p>
            Using `https://docs-tovg.onrender.com/sniffa.gif`, meaning hosted inside Next.js
            `/public` folder:
          </p>
          <Image
            src="https://docs-tovg.onrender.com/sniffa.gif"
            width={800}
            height={500}
            alt=""
            objectFit="cover"
          />

          <h2>Remote image using micro-image proxy</h2>
          <p>Using `https://picsum.photos/id/66/1500/900`:</p>
          <Image
            src="https://picsum.photos/id/66/1500/900"
            width={800}
            height={500}
            alt=""
            objectFit="cover"
          />
        </ImageCacheProvider>

        <h2>(TODO): Image from ipx</h2>
        <p>Using `bliss.jpg`, stored inside ipx assets:</p>
        <Image src="bliss.jpg" width={800} height={500} alt="" objectFit="cover" />
      </div>
    </div>
  );
}
