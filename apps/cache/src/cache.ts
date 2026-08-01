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

/** Test/benchmark affordance: the module-level cache is a singleton, so suites
 * need a way to isolate from one another. Not used by the server itself. */
export function clearCache(): void {
  for (const key of Object.keys(cache)) {
    delete cache[key];
  }
}

/** Test/benchmark affordance: number of entries currently held in memory. */
export function cacheSize(): number {
  return Object.keys(cache).length;
}

/**
 * Test/benchmark affordance: total bytes retained by the cache.
 *
 * This is the honest measure of what an unbounded cache costs. Process RSS and
 * heap deltas are swamped by GC timing and allocator behaviour; the sum of the
 * buffers actually held is exact and reproduces run to run.
 */
export function cacheBytes(): number {
  return Object.values(cache).reduce((total, record) => total + record.buffer.byteLength, 0);
}
