import Image from "@micro-image/image";
import { useIsomorphicLayoutEffect } from "@micro-image/utils";

export default function Docs() {
  useIsomorphicLayoutEffect(() => {
    console.log("micro-image docs page");
  }, []);

  return (
    <div>
      <h1>micro-image Documentation</h1>

      <div style={{ maxWidth: "800px" }}>
        <h2>Local image using micro-image proxy</h2>
        <p>
          Using `http://localhost:3002/sniffa.gif`, meaning hosted inside Next.js `/public` folder:
        </p>
        <Image
          src="http://localhost:3002/sniffa.gif"
          width={800}
          height={500}
          alt=""
          objectFit="cover"
        />

        <h2>Remote image using micro-image proxy</h2>
        <p>Using `https://picsum.photos/1500/900`:</p>
        <Image
          src="https://picsum.photos/1500/900"
          width={800}
          height={500}
          alt=""
          objectFit="cover"
        />

        <h2>Image from ipx</h2>
        <p>Using `bliss.jpg`, stored inside ipx assets:</p>
        <Image src="bliss.jpg" width={800} height={500} alt="" objectFit="cover" />
      </div>
    </div>
  );
}
