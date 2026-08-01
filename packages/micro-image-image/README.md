# @micro-image/image

This is an image component for React meant to consume an image proxy, currently supporting two: our own, [@micro-image/proxy-image](https://github.com/veksen/micro-image), and [ipx](https://github.com/unjs/ipx), for the time being. Use a single, high-quality image, this component will only load the appropriate size.

## Install

```bash
npm install @micro-image/image
```

## Usage

```js
import Image from "@micro-image/image";

function YourComponent() {
  return (
    <div>
      <Image src="https://picsum.photos/800/500" width={800} height={500} objectFit="cover" />
    </div>
  );
}
```

Note: The image will always take 100% of the width of the parent, that's intended. If you wish to change that, wrap it in an element with limited width, for example, `<div style={{ width: "400px }}>`.

### Props

`src`: For @micro-image/proxy-image, that's the full URL of the image. For ipx, that's the stored path to your image, within ipx.

`width` and `height`: Used for aspect ratio, must be provided.

`objectFit`: "cover" | "contain" | "none", optional, defaults to "none".

`alt`: optional, defaults to empty string if not provided.

`generatorOptions`: optional, passed through to the provider when it builds each URL.

- `quality`: encoder quality, 1 to 100. Defaults to 75. Values outside the range are clamped.
  Applies to JPEG and WebP output; PNG and GIF stay lossless.
- `format`: the format to encode to — `jpg`, `jpeg`, `png`, `webp` or `gif`. Omit it to keep
  the source format, or pass `original` to ask for that explicitly. Any other value is
  rejected with a 400.
- `blur`: blur radius. Omit it for no blur.

```js
<Image
  src="https://picsum.photos/800/500"
  width={800}
  height={500}
  generatorOptions={{ format: "webp", quality: 60 }}
/>
```

## Provider

A provider component is available. Must be used to set your provider (micro-image or ipx), and the URL to your image proxy.

```js
import Image, { ImageCacheProvider } from "@micro-image/image";

function YourComponent() {
  return (
    <div>
      <Image src="https://picsum.photos/800/500" width={800} height={500} objectFit="cover" />
    </div>
  );
}

function App() {
  return (
    <ImageCacheProvider provider="micro-image" cacheProxyUrl="http://localhost:4000/cache">
      <YourComponent />
    </ImageCacheProvider>
  );
}
```

## Limitations

You must know the image width, or at least the aspect ratio you're trying to use. This is intended to avoid [CLS](https://web.dev/cls/), by avoiding the page from jumping when the image loads.

Also, as referenced previously, this component cannot be used without an image proxy, and currently only 2 are supported.
