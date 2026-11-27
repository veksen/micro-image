export interface CacheRecord {
  contentType: string;
  buffer: Buffer;
}

/**
 * A byte-bounded LRU.
 *
 * Insertion order is the recency order: the first key is the least recently
 * used. A read re-inserts its key to move it to the end. A plain object cannot
 * do this, because deleting and re-adding a key does not reliably reorder it.
 *
 * The bound is expressed in bytes rather than entries, because entry sizes
 * differ by orders of magnitude: an 8 kB thumbnail and a 1.4 MB passthrough
 * both count as one entry, and only one of them threatens the process.
 */
class ByteLru {
  private readonly entries = new Map<string, CacheRecord>();

  /** Running total, so the budget check does not walk the whole map per write. */
  heldBytes = 0;

  maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get(id: string): CacheRecord | undefined {
    const record = this.entries.get(id);
    if (!record) {
      return undefined;
    }

    // a read counts as a use, so a hot key survives a flood of cold ones
    this.entries.delete(id);
    this.entries.set(id, record);

    return record;
  }

  set(id: string, record: CacheRecord): void {
    const size = record.buffer.byteLength;

    // A record bigger than the whole budget can never fit. Evicting toward it
    // would empty the cache and still fail, so it is simply not cached. A budget
    // of 0 therefore turns the cache off.
    if (size > this.maxBytes) {
      return;
    }

    // replacing an existing id releases whatever it held
    const previous = this.entries.get(id);
    if (previous) {
      this.heldBytes -= previous.buffer.byteLength;
      this.entries.delete(id);
    }

    // evict least-recently-used until the new record fits
    while (this.heldBytes + size > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      const evicted = this.entries.get(oldest.value)!;
      this.heldBytes -= evicted.buffer.byteLength;
      this.entries.delete(oldest.value);
    }

    this.entries.set(id, {
      contentType: record.contentType,
      buffer: record.buffer,
    });
    this.heldBytes += size;
  }

  clear(): void {
    this.entries.clear();
    this.heldBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * 256 MB leaves room for a useful working set while staying well under the
 * memory of the smallest container anyone would sensibly run this on. Override
 * with CACHE_MAX_BYTES.
 */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function readBudget(): number {
  const configured = Number(process.env.CACHE_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

/** Transformed responses, keyed by `buildId`. */
const cache = new ByteLru(readBudget());

/**
 * Upstream originals, keyed by source url.
 *
 * Every width and format of one source is its own entry in the response cache,
 * so without this each of them downloads the full original again: the docs photo
 * is 3.5 MB, and its srcset ladder alone is 19 widths. Keeping the original lets
 * the second variant skip the download. It does not skip the decode.
 *
 * Its own budget, so a few large originals can never evict the small transformed
 * responses that most traffic hits. 64 MB holds about 18 originals the size of
 * the docs photo. Override with SOURCE_CACHE_MAX_BYTES; 0 turns it off.
 */
export const DEFAULT_SOURCE_MAX_BYTES = 64 * 1024 * 1024;

function readSourceBudget(): number {
  const raw = process.env.SOURCE_CACHE_MAX_BYTES;
  // unlike CACHE_MAX_BYTES, 0 is meaningful here: it disables the source cache
  const configured = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_SOURCE_MAX_BYTES;
}

const sources = new ByteLru(readSourceBudget());

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
  return cache.get(id);
}

export function toCache(id: string, record: CacheRecord): void {
  cache.set(id, record);
}

export function fromSourceCache(url: string): CacheRecord | undefined {
  return sources.get(url);
}

export function toSourceCache(url: string, record: CacheRecord): void {
  sources.set(url, record);
}

/** Test/benchmark affordance: the module-level caches are singletons, so suites
 * need a way to isolate from one another. Clears the source cache too, so a
 * "cold" request really downloads. Not used by the server itself. */
export function clearCache(): void {
  cache.clear();
  sources.clear();
}

/** Test/benchmark affordance: number of entries currently held in memory. */
export function cacheSize(): number {
  return cache.size;
}

/**
 * Total bytes retained by the cache.
 *
 * This is the honest measure of what the cache costs. Process RSS and heap
 * deltas are swamped by GC timing and allocator behaviour; the sum of the
 * buffers actually held is exact and reproduces run to run.
 */
export function cacheBytes(): number {
  return cache.heldBytes;
}

/** The budget currently in force. */
export function cacheMaxBytes(): number {
  return cache.maxBytes;
}

/**
 * Test/benchmark affordance: change the budget at runtime.
 *
 * Production reads CACHE_MAX_BYTES once at module load. Tests need a budget
 * small enough to cross without allocating hundreds of megabytes, and vitest
 * caches modules, so setting the env var after import would have no effect.
 * Passing no argument restores the configured value.
 */
export function setCacheMaxBytes(bytes?: number): void {
  cache.maxBytes = bytes ?? readBudget();
}

/** Test/benchmark affordance: bytes retained by the source cache. */
export function sourceCacheBytes(): number {
  return sources.heldBytes;
}

/** Test/benchmark affordance: change the source budget. No argument restores the configured value. */
export function setSourceCacheMaxBytes(bytes?: number): void {
  sources.maxBytes = bytes ?? readSourceBudget();
}
