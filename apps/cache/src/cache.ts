interface CacheRecord {
  contentType: string;
  buffer: Buffer;
}

const cache: Record<string, CacheRecord> = {};

interface CompressOptions {
  width?: number;
  blur?: boolean;
}

export function buildId(url: string, options: CompressOptions): string {
  const optionsArray = Object.entries(options)
    .filter(([key, value]) => {
      if (key === "blur") {
        return value === true;
      }
      return true;
    })
    .map(([key, value]) => {
      return `${key}-${value}`;
    });

  return `${url}__${optionsArray.join("__")}`;
}

export function fromCache(id: string): CacheRecord | undefined {
  return cache[id];
}

export function toCache(id: string, record: CacheRecord): void {
  cache[id] = {
    contentType: record.contentType,
    buffer: record.buffer,
  };
}
