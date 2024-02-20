import React from "react";

interface IDocsImageWrapperProps {
  children: React.ReactNode;
  originalSrc: string;
}

interface IMetaValues {
  src: string;
  contentLength: number;
}

function getReadableFileSizeString(bytes: number) {
  const byteUnits = [" kB", " MB", " GB", " TB", "PB", "EB", "ZB", "YB"];
  let i = -1;

  do {
    bytes /= 1024;
    i++;
  } while (bytes > 1024);

  return Math.max(bytes, 0.1).toFixed(1) + byteUnits[i];
}

export default function Compare(props: IDocsImageWrapperProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  const [original, setOriginal] = React.useState<IMetaValues>();
  const [processed, setProcessed] = React.useState<IMetaValues>();

  React.useEffect(() => {
    if (!ref.current) {
      return;
    }

    const image = ref.current.querySelector("img");

    if (!image) {
      return;
    }

    image.onload = () => {
      const params = new URLSearchParams({
        originalSrc: props.originalSrc,
        currentSrc: image.currentSrc,
      });
      fetch("/api/meta?" + params)
        .then((res) => res.json())
        .then((data) => {
          setOriginal(data.original);
          setProcessed(data.processed);
        });
    };
  }, [props.originalSrc]);

  const diff = React.useMemo(() => {
    if (!processed || !original) {
      return undefined;
    }

    return processed.contentLength / original.contentLength;
  }, [processed, original]);

  return (
    <div ref={ref} className="flex gap-2">
      <CompareImage
        title="processed"
        src={processed?.src}
        contentLength={processed?.contentLength}
        diff={diff}
      >
        {props.children}
      </CompareImage>
      <CompareImage title="original" src={original?.src} contentLength={original?.contentLength}>
        <img src={props.originalSrc} className="w-[100%]" />
      </CompareImage>
    </div>
  );
}

interface ICompareImage {
  title: string;
  children: React.ReactNode;
  src?: string;
  contentLength?: number;
  diff?: number;
}

function CompareImage(props: ICompareImage) {
  return (
    <div className="flex flex-col gap-2 w-[50%]">
      <h2 className="text-bold">{props.title}</h2>
      <div>{props.children}</div>
      <div className="flex flex-col gap-1">
        {props.contentLength ? (
          <>
            <div className="flex gap-1 font-bold">
              <span>{getReadableFileSizeString(props.contentLength)}</span>
              {props.diff && props.diff < 1 && (
                <span>({((1 - props.diff) * 100).toFixed(1)}% smaller)</span>
              )}
              {props.diff && props.diff === 1 && <span>(Not compressed)</span>}
            </div>
            <div className="text-wrap">{props.src}</div>
          </>
        ) : (
          "loading..."
        )}
      </div>
    </div>
  );
}
