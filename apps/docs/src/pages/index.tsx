import Image, { ImageCacheProvider } from "@micro-image/image";
import React from "react";
import Compare from "../components/compare.component";
import { getImageProportions } from "../image-utils";

interface IYourImageActive {
  url: string;
  active: true;
  error: false;
  proportions: { width: number; height: number };
}

interface IYourImageInactive {
  url: string;
  active: false;
  error: false;
  loading: false;
  proportions: null;
}

interface IYourImageLoading {
  url: string;
  active: false;
  error: false;
  loading: true;
  proportions: null;
}

interface IYourImageError {
  url: string;
  active: false;
  error: true;
  loading: false;
  proportions: null;
}

type YourImageState = IYourImageActive | IYourImageInactive | IYourImageLoading | IYourImageError;

export default function DocsIndex() {
  const [yourImage, setYourImage] = React.useState<YourImageState>({
    url: "",
    active: false,
    error: false,
    loading: false,
    proportions: null,
  });

  React.useEffect(() => {
    if (!yourImage.url) {
      return;
    }

    setYourImage((prev) => ({
      ...prev,
      error: false,
      loading: true,
      active: false,
      proportions: null,
    }));

    getImageProportions(yourImage.url)
      .then((proportions) => {
        setYourImage((prev) => ({
          ...prev,
          error: false,
          loading: false,
          active: true,
          proportions,
        }));
      })
      .catch(() => {
        setYourImage((prev) => ({
          ...prev,
          error: true,
          loading: false,
          active: false,
          proportions: null,
        }));
      });
  }, [yourImage.url]);

  return (
    <>
      <h1 className="text-2xl font-bold">Showcase</h1>

      <ImageCacheProvider
        provider="micro-image"
        cacheProxyUrl={process.env.NEXT_PUBLIC_IMAGE_PROXY_URL}
      >
        <section className="max-w-[100%]">
          <h2 className="text-lg font-bold">Local image using micro-image proxy (large jpg)</h2>
          <p>
            Using `{process.env.NEXT_PUBLIC_DOCS_URL}/neom-bA32w6lebJg-unsplash.gif`, meaning hosted
            inside Next.js `/public` folder:
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

        <section className="max-w-[100%]">
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

        <section className="max-w-[100%]">
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

        <section className="max-w-[100%]">
          <h2 className="text-lg font-bold">Try any image</h2>
          <input
            type="text"
            placeholder="Image URL"
            value={yourImage.url}
            className="w-[100%] bg-mauve-5 dark:bg-mauvedark-5 text-mauve-12 dark:text-mauvedark-12 p-2 rounded-sm"
            onChange={(e) => setYourImage((prev) => ({ ...prev, url: e.target.value }))}
          />

          {yourImage.active && (
            <Compare originalSrc={yourImage.url}>
              <Image
                src={yourImage.url}
                width={yourImage.proportions.width}
                height={yourImage.proportions.height}
                alt=""
                objectFit="cover"
              />
            </Compare>
          )}

          {yourImage.error && (
            <div className="mt-4 bg-reddark-5 text-reddark-11 p-4 rounded-lg">
              Failed to fetch image.
            </div>
          )}
        </section>
      </ImageCacheProvider>

      <section className="max-w-[100%]">
        <h2 className="text-lg font-bold">(TODO): Image from ipx</h2>
        <p>Using `bliss.jpg`, stored inside ipx assets:</p>
        <Image src="bliss.jpg" width={800} height={500} alt="" objectFit="cover" />
      </section>
    </>
  );
}
