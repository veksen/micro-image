interface CacheRecord {
  contentType: string;
  buffer: Buffer;
}

const cache: Record<string, CacheRecord> = {};

/**
 * Everything that can change the bytes the proxy returns. Two requests differing
 * in any of these must not share an entry; two differing in nothing else must.
 */
export interface CacheKeyOptions {
  width?: number;
  quality?: number;
  format?: string;
  blur?: number;
}

/**
 * Cache id for a source url and the options that affect its output.
 *
 * Keys are sorted, so a caller cannot cause a miss by reordering its object
 * literal. `undefined` values are dropped, so an option that was absent and one
 * that parsed to nothing produce the same id, which is correct because they
 * produce the same bytes.
 */
export function buildId(url: string, options: CacheKeyOptions = {}): string {
  const parts = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}-${value}`);

  return parts.length > 0 ? `${url}__${parts.join("__")}` : url;
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
