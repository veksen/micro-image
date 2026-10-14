import React, { useEffect, useRef, type ReactElement } from "react";
import type { GetServerSideProps } from "next";
import NextImage from "next/image";
import MicroImage, { ImageCacheProvider } from "@micro-image/image";
import {
  type Fixture,
  type Layout,
  type StrategyName,
  fixturePath,
  isLayoutName,
  isStrategyName,
  layouts,
  lazyCount,
  proxyUrl,
  srcSet,
} from "../bench/model";

/**
 * One page of the browser benchmark (`apps/docs/bench/run.ts`): an eager image
 * in a layout, then a lazy grid below the fold, marked up the way one strategy
 * would mark it up. It 404s unless the runner set BENCH_ORIGIN and
 * BENCH_PROXY_URL, so the docs site never serves it.
 */

interface BenchProps {
  strategy: StrategyName;
  layout: Layout;
  /** Where the fixtures are served from, which the proxy fetches. */
  origin: string;
  /** The proxy's /cache endpoint. */
  proxy: string;
}

export const getServerSideProps: GetServerSideProps<BenchProps> = async ({ query }) => {
  const { strategy, layout } = query;
  const origin = process.env.BENCH_ORIGIN;
  const proxy = process.env.BENCH_PROXY_URL;

  if (!origin || !proxy || !isStrategyName(strategy) || !isLayoutName(layout)) {
    return { notFound: true };
  }
  return { props: { strategy, layout: layouts[layout], origin, proxy } };
};

const imgStyle: React.CSSProperties = { display: "block", width: "100%", height: "auto" };

/** The `sizes` each hand-written strategy emits. */
function markupSizes(strategy: StrategyName, layout: Layout, lazy: boolean): string {
  if (strategy === "plain-srcset") return "100vw";
  if (lazy) return "auto";
  return strategy === "exact" ? layout.exactSizes : "100vw";
}

function ProxyImg({
  src,
  fixture,
  proxy,
  sizes,
  lazy,
  observe,
}: {
  src: string;
  fixture: Fixture;
  proxy: string;
  sizes: string;
  lazy: boolean;
  observe: boolean;
}) {
  const ref = useRef<HTMLImageElement>(null);

  // mirrors the component's observer: once laid out, `sizes` becomes the box's real width
  useEffect(() => {
    const img = ref.current;
    if (!observe || !img) return;

    const observer = new ResizeObserver(([entry]) => {
      const observed = `${Math.ceil(entry.contentRect.width)}px`;
      if (img.sizes !== observed) img.sizes = observed;
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, [observe]);

  return (
    <img
      ref={ref}
      alt=""
      loading={lazy ? "lazy" : "eager"}
      fetchPriority={lazy ? undefined : "high"}
      width={fixture.width}
      height={fixture.height}
      sizes={sizes}
      srcSet={srcSet(proxy, src, fixture)}
      src={proxyUrl(proxy, src, Math.min(1080, fixture.width))}
      style={imgStyle}
    />
  );
}

function StrategyImage({ strategy, layout, origin, proxy, index }: BenchProps & { index: number }) {
  const lazy = index > 0;
  const { fixture } = layout;
  const path = fixturePath(fixture, index);

  if (strategy === "shipped") {
    return (
      <MicroImage
        src={`${origin}${path}`}
        width={fixture.width}
        height={fixture.height}
        objectFit="cover"
      />
    );
  }
  if (strategy === "next-image") {
    return (
      <NextImage
        alt=""
        src={path}
        width={fixture.width}
        height={fixture.height}
        sizes="100vw"
        preload={!lazy}
        style={imgStyle}
      />
    );
  }
  return (
    <ProxyImg
      src={`${origin}${path}`}
      fixture={fixture}
      proxy={proxy}
      lazy={lazy}
      sizes={markupSizes(strategy, layout, lazy)}
      observe={strategy === "bake-100vw+obs" && !lazy}
    />
  );
}

const gridStyle = `
  .bench-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    width: min(1280px, calc(100vw - 32px));
    margin: 0 auto;
  }
  @media (max-width: 767px) {
    .bench-grid { grid-template-columns: 1fr; }
  }
`;

export default function Bench(props: BenchProps) {
  // only the shipped component reads the provider; every other row ignores it
  return (
    <ImageCacheProvider provider="micro-image" cacheProxyUrl={props.proxy}>
      <main>
        <style>{gridStyle}</style>
        <div data-bench-index={0} style={props.layout.eagerBox}>
          <StrategyImage {...props} index={0} />
        </div>
        {/* far past Chromium's lazy-load distance, so lazy images wait for the scroll */}
        <div style={{ height: "calc(100vh + 3000px)" }} />
        <div className="bench-grid">
          {Array.from({ length: lazyCount }, (_, offset) => (
            <div key={offset} data-bench-index={offset + 1}>
              <StrategyImage {...props} index={offset + 1} />
            </div>
          ))}
        </div>
      </main>
    </ImageCacheProvider>
  );
}

// the benchmark measures layout, so the page renders without the docs chrome
Bench.getLayout = (page: ReactElement) => page;
