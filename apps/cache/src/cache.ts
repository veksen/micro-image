interface CacheRecord {
  contentType: string;
  buffer: Buffer;
}

const cache: Record<string, CacheRecord> = {};

export function fromCache(id: string): CacheRecord | undefined {
  return cache[id];
}

export function toCache(id: string, record: CacheRecord): void {
  cache[id] = {
    contentType: record.contentType,
    buffer: record.buffer,
  };
}
