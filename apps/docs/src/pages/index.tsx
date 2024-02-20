import Image, { ImageCacheProvider } from "@micro-image/image";
import React from "react";
import Compare from "../components/compare.component";

export default function Docs() {
  return (
    <div>
      <div className="max-w-[800px] py-4 mx-auto flex flex-col gap-8">
        <h1 className="text-2xl font-bold">micro-image Documentation</h1>

        <ImageCacheProvider
          provider="micro-image"
          cacheProxyUrl={process.env.NEXT_PUBLIC_IMAGE_PROXY_URL}
        >
          <section>
            <h2 className="text-lg font-bold">Local image using micro-image proxy (large jpg)</h2>
            <p>
              Using `{process.env.NEXT_PUBLIC_DOCS_URL}/neom-bA32w6lebJg-unsplash.gif`, meaning
              hosted inside Next.js `/public` folder:
            </p>
            <Compare
              originalSrc={`${process.env.NEXT_PUBLIC_DOCS_URL}/neom-bA32w6lebJg-unsplash.jpg`}
            >
              <Image
                src={`${process.env.NEXT_PUBLIC_DOCS_URL}/neom-bA32w6lebJg-unsplash.jpg`}
                width={183}
                height={137}
                alt=""
                objectFit="cover"
              />
            </Compare>
          </section>

          <section>
            <h2 className="text-lg font-bold">
              Local image using micro-image proxy (gif, uncompressed for now)
            </h2>
            <p>
              Using `{process.env.NEXT_PUBLIC_DOCS_URL}/sniffa.gif`, meaning hosted inside Next.js
              `/public` folder:
            </p>
            <Compare originalSrc={`${process.env.NEXT_PUBLIC_DOCS_URL}/sniffa.gif`}>
              <Image
                src={`${process.env.NEXT_PUBLIC_DOCS_URL}/sniffa.gif`}
                width={400}
                height={400}
                alt=""
                objectFit="cover"
              />
            </Compare>
          </section>

          <section>
            <h2 className="text-lg font-bold">Remote image using micro-image proxy</h2>
            <p>Using `https://picsum.photos/id/66/1500/900`:</p>
            <Compare originalSrc="https://picsum.photos/id/66/1500/900">
              <Image
                src="https://picsum.photos/id/66/2000/1200"
                width={2000}
                height={1200}
                alt=""
                objectFit="cover"
              />
            </Compare>
          </section>
        </ImageCacheProvider>

        <h2>(TODO): Image from ipx</h2>
        <p>Using `bliss.jpg`, stored inside ipx assets:</p>
        <Image src="bliss.jpg" width={800} height={500} alt="" objectFit="cover" />
      </div>
    </div>
  );
}
