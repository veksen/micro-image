/**
 * Shares one in-flight computation between concurrent callers asking for the
 * same key.
 *
 * Without this, N concurrent requests for a cold cache key each download the
 * source and each run their own sharp transform. Wall time barely moves,
 * because the work spreads across cores, so the cost is easy to miss: eight
 * concurrent cold requests were measured at 10x to 12.5x the CPU of one.
 *
 * Failure is deliberately not sticky. When the work rejects, every waiter
 * receives the error and the entry is removed, so the next request retries
 * rather than inheriting a permanently rejected promise. Caching the rejection
 * is the usual way this pattern goes wrong: one upstream blip would then be
 * served as a failure until something evicted it.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function coalesce<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      return await work();
    } finally {
      // removed on both settle paths, before any waiter is resumed
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Test affordance: how many computations are running right now. */
export function inFlightCount(): number {
  return inFlight.size;
}

/** Test affordance: drop every entry. Does not cancel the work itself. */
export function clearInFlight(): void {
  inFlight.clear();
}
