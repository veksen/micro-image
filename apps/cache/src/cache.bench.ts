import { bench, describe } from "vitest";
import { buildId, toCache, fromCache, clearCache } from "./cache";

/**
 * The cache key is built on every request, before anything else happens, so it
 * sits in front of both the hit and the miss path.
 */
const URL = "https://images.example.com/photos/2024/summer/cat-on-a-roof.jpg?v=3";

const budget = { time: 300, warmupTime: 50 };

describe("buildId", () => {
  bench("width only", () => void buildId(URL, { width: 800, blur: false }), budget);
  bench("width and blur", () => void buildId(URL, { width: 800, blur: true }), budget);
  bench("absent width (NaN)", () => void buildId(URL, { width: NaN, blur: false }), budget);
});

describe("lookup", () => {
  clearCache();
  const record = { contentType: "image/jpeg", buffer: Buffer.alloc(64) };
  for (let i = 0; i < 10_000; i++) {
    toCache(buildId(`${URL}/${i}`, { width: 800, blur: false }), record);
  }
  const hitKey = buildId(`${URL}/5000`, { width: 800, blur: false });
  const missKey = buildId(`${URL}/missing`, { width: 800, blur: false });

  bench("hit, 10k entries held", () => void fromCache(hitKey), budget);
  bench("miss, 10k entries held", () => void fromCache(missKey), budget);
});
