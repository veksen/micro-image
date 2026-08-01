interface CacheRecord {
  contentType: string;
  buffer: Buffer;
}

/**
 * Insertion order is the recency order: the first key is the least recently
 * used. A read re-inserts its key to move it to the end. A plain object cannot
 * do this, because deleting and re-adding a key does not reliably reorder it.
 */
const cache = new Map<string, CacheRecord>();

/** Running total, so the budget check does not walk the whole map per write. */
let heldBytes = 0;

/**
 * The bound is expressed in bytes rather than entries, because entry sizes
 * differ by orders of magnitude: an 8 kB thumbnail and a 1.4 MB passthrough
 * both count as one entry, and only one of them threatens the process.
 *
 * 256 MB leaves room for a useful working set while staying well under the
 * memory of the smallest container anyone would sensibly run this on. Override
 * with CACHE_MAX_BYTES.
 */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024;

function readBudget(): number {
  const configured = Number(process.env.CACHE_MAX_BYTES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
}

let maxBytes = readBudget();

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
  const record = cache.get(id);
  if (!record) {
    return undefined;
  }

  // a read counts as a use, so a hot key survives a flood of cold ones
  cache.delete(id);
  cache.set(id, record);

  return record;
}

export function toCache(id: string, record: CacheRecord): void {
  const size = record.buffer.byteLength;

  // A record bigger than the whole budget can never fit. Evicting toward it
  // would empty the cache and still fail, so it is simply not cached.
  if (size > maxBytes) {
    return;
  }

  // replacing an existing id releases whatever it held
  const previous = cache.get(id);
  if (previous) {
    heldBytes -= previous.buffer.byteLength;
    cache.delete(id);
  }

  // evict least-recently-used until the new record fits
  while (heldBytes + size > maxBytes) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    const evicted = cache.get(oldest.value)!;
    heldBytes -= evicted.buffer.byteLength;
    cache.delete(oldest.value);
  }

  cache.set(id, {
    contentType: record.contentType,
    buffer: record.buffer,
  });
  heldBytes += size;
}

/** Test/benchmark affordance: the module-level cache is a singleton, so suites
 * need a way to isolate from one another. Not used by the server itself. */
export function clearCache(): void {
  cache.clear();
  heldBytes = 0;
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
  return heldBytes;
}

/** The budget currently in force. */
export function cacheMaxBytes(): number {
  return maxBytes;
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
  maxBytes = bytes ?? readBudget();
}
