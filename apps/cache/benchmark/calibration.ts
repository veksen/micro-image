import { performance } from "perf_hooks";
import sharp from "sharp";

/**
 * A fixed yardstick for how fast the machine running the benchmark is.
 *
 * Wall-clock timings are not comparable across CI runs: GitHub rotates runner
 * hardware and neighbours vary, so a "cold ms" chart over time mostly plots the
 * runner lottery. Dividing each timing by a calibration run taken in the same
 * process cancels most of that, turning "18.9 ms" into "1.4x the reference",
 * which is comparable across machines and across months.
 *
 * Two rules keep the history readable:
 *
 *   1. THIS WORKLOAD MUST NEVER CHANGE. Editing it silently rebases every ratio
 *      ever recorded. If it truly has to change, bump CALIBRATION_VERSION so
 *      old and new points are not plotted on the same axis.
 *   2. It must not call any of our own code. It measures the machine, not the
 *      proxy, so it goes straight to sharp and to a plain JS loop.
 */
export const CALIBRATION_VERSION = 1;

const REFERENCE_WIDTH = 800;
const REFERENCE_HEIGHT = 600;
const RUNS = 7;

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** A fixed picture. Deliberately simple: this never needs to look realistic. */
function referencePixels() {
  const channels = 3;
  const data = Buffer.alloc(REFERENCE_WIDTH * REFERENCE_HEIGHT * channels);
  for (let y = 0; y < REFERENCE_HEIGHT; y++) {
    for (let x = 0; x < REFERENCE_WIDTH; x++) {
      const i = (y * REFERENCE_WIDTH + x) * channels;
      data[i] = (x * 7 + y * 13) % 256;
      data[i + 1] = (x * 3 + y * 29) % 256;
      data[i + 2] = (x * 17 + y * 5) % 256;
    }
  }
  return data;
}

export interface Calibration {
  version: number;
  /** Median ms for a fixed decode + resize + encode through sharp. */
  sharpMs: number;
  /** Median ms for a fixed pure-JS byte loop. */
  jsMs: number;
}

export async function calibrate(): Promise<Calibration> {
  const raw = referencePixels();
  const source = await sharp(raw, {
    raw: { width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT, channels: 3 },
  })
    .jpeg({ quality: 90 })
    .toBuffer();

  // sharp: the subsystem that dominates cold latency
  const sharpSamples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    await sharp(source)
      .resize({ width: 400, withoutEnlargement: true })
      .jpeg({ mozjpeg: true, quality: 75 })
      .toBuffer();
    sharpSamples.push(performance.now() - start);
  }

  // plain JS: everything that is not sharp
  const buffer = Buffer.alloc(2 * 1024 * 1024, 3);
  const jsSamples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    let sum = 0;
    for (let j = 0; j < buffer.length; j++) sum += buffer[j]!;
    if (sum === 0) throw new Error("unreachable");
    jsSamples.push(performance.now() - start);
  }

  return {
    version: CALIBRATION_VERSION,
    sharpMs: median(sharpSamples),
    jsMs: median(jsSamples),
  };
}
