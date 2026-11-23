import Image, { ImageCacheProvider } from "@micro-image/image";
import portrait from "./images/portrait.jpg?micro";

const proxyUrl = import.meta.env.VITE_IMAGE_PROXY_URL ?? "http://localhost:4000/cache";

export function App() {
  return (
    <ImageCacheProvider cacheProxyUrl={proxyUrl}>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
        <h1>micro-image with Vite</h1>

        <h2>A bare src</h2>
        <p>
          No width or height typed. The React adapter rewrites this element to pass the build-time
          metadata as <code>_micro</code>.
        </p>
        {/* @ts-expect-error Without _micro the component requires width and height. The build supplies _micro. */}
        <Image
          src="./images/hero.jpg"
          alt="Sandstone towers in a desert at sunset"
          objectFit="cover"
        />

        <h2>An explicit ?micro import</h2>
        <p>The escape hatch for anything the adapter cannot prove is an Image.</p>
        <div style={{ maxWidth: 320 }}>
          <Image _micro={portrait} alt="A tall crop of the same desert" objectFit="cover" />
        </div>
      </main>
    </ImageCacheProvider>
  );
}
