import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLimit, transformConcurrency } from "./limit";

/** A job that stays in flight until its `release` is called. */
function deferred() {
  let release!: () => void;
  const done = new Promise<void>((resolve) => (release = resolve));
  return { done, release };
}

describe("createLimit", () => {
  it("never runs more than max jobs at once", async () => {
    const run = createLimit(2);
    let active = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred(), deferred()];

    const jobs = gates.map((gate) =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await gate.done;
        active--;
      })
    );

    await Promise.resolve();
    expect(active).toBe(2);

    for (const gate of gates) {
      gate.release();
      await new Promise((resolve) => setImmediate(resolve));
    }

    await Promise.all(jobs);
    expect(peak).toBe(2);
  });

  it("starts waiting jobs in arrival order", async () => {
    const run = createLimit(1);
    const started: number[] = [];
    const first = deferred();

    const jobs = [
      run(async () => {
        started.push(0);
        await first.done;
      }),
      run(async () => started.push(1)),
      run(async () => started.push(2)),
    ];

    first.release();
    await Promise.all(jobs);

    expect(started).toEqual([0, 1, 2]);
  });

  it("frees the slot when a job rejects", async () => {
    const run = createLimit(1);

    await expect(run(() => Promise.reject(new Error("decode failed")))).rejects.toThrow(
      "decode failed"
    );

    await expect(run(async () => "next")).resolves.toBe("next");
  });

  it("does not let a newcomer overtake a waiter when a slot is handed over", async () => {
    const run = createLimit(1);
    const order: string[] = [];
    const first = deferred();

    const holder = run(async () => {
      await first.done;
      order.push("holder");
    });
    const waiter = run(async () => order.push("waiter"));

    first.release();
    // arrives after the holder finished but before the waiter has resumed
    await holder;
    const newcomer = run(async () => order.push("newcomer"));

    await Promise.all([waiter, newcomer]);
    expect(order).toEqual(["holder", "waiter", "newcomer"]);
  });
});

describe("transformConcurrency", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses TRANSFORM_CONCURRENCY when it is a positive integer", () => {
    vi.stubEnv("TRANSFORM_CONCURRENCY", "3");
    expect(transformConcurrency()).toBe(3);
  });

  it.each(["", "0", "-1", "1.5", "two"])("falls back to the usable cores for %j", (value) => {
    vi.stubEnv("TRANSFORM_CONCURRENCY", value);
    expect(transformConcurrency()).toBe(os.availableParallelism());
  });
});
