import os from "node:os";

/**
 * Runs at most `max` jobs at once; the rest wait in arrival order.
 *
 * sharp queues its work on libuv's thread pool, which holds 4 threads by
 * default whatever the machine has. On a host with fewer cores than that, the
 * extra jobs do not run faster, they time-slice: every in-flight transform
 * slows down together and each holds its decoded image in memory meanwhile.
 * On one pinned core, four concurrent 1200w AVIF misses all finished at
 * 16.2 s with a peak RSS of 595 MB. Run one at a time, they finished at 4.2,
 * 8.0, 11.9 and 16.0 s (mean 10.0 s) and peak RSS was 287 MB. Throughput is
 * the same either way.
 *
 * A finished job hands its slot straight to the next waiter, so a caller
 * arriving in between cannot slip past the queue and exceed the limit.
 */
export function createLimit(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active < max) {
      active++;
    } else {
      // the releasing job keeps `active` as is and passes its slot to us
      await new Promise<void>((resolve) => waiting.push(resolve));
    }

    try {
      return await work();
    } finally {
      const next = waiting.shift();

      if (next) {
        next();
      } else {
        active--;
      }
    }
  };
}

/**
 * How many image transforms may run at once: TRANSFORM_CONCURRENCY when set to
 * a positive integer, otherwise the cores this process may use.
 *
 * The override exists because `availableParallelism()` reads the CPU affinity
 * mask, not a container's CPU quota, so a container limited to one CPU on a
 * large host can report every core of the host.
 */
export function transformConcurrency(): number {
  const configured = Number(process.env.TRANSFORM_CONCURRENCY);

  return Number.isInteger(configured) && configured > 0 ? configured : os.availableParallelism();
}
