import { createHash } from "node:crypto";
import type { Metadata } from "sharp";

/**
 * Embedded ICC profiles whose conversion to sRGB is a measured no-op.
 *
 * sharp converts any image carrying an embedded profile to sRGB through lcms
 * before resizing. When the embedded profile already *is* sRGB that work
 * changes nothing, and it is not cheap: on the docs photo (5272x3948
 * progressive JPEG, HP sRGB profile) it was 55 of 310 ms of CPU for a 1200w
 * JPEG, in six alternated pairs on linux-arm64.
 *
 * Only profiles verified byte for byte are listed, keyed by the SHA-256 of the
 * whole profile. For each, the raw pixels with and without the conversion
 * were compared at 400w and 1200w and differed in 0 samples. A profile that is
 * merely *named* sRGB is not enough: Display P3, Adobe RGB and the others
 * tested differ in 65-99% of samples, and a variant sRGB with a different tone
 * curve could too. Add a digest only with that comparison behind it.
 */
const noOpProfiles = new Set([
  // "sRGB IEC61966-2.1", Hewlett-Packard 1998, 3,144 bytes. The profile
  // Photoshop, Lightroom and macOS ("sRGB Profile.icc") embed.
  "2b3aa1645779a9e634744faf9b01e9102b0c9b88fd6deced7934df86b949af7e",
  // libvips' own built-in "srgb", 480 bytes: what sharp's withIccProfile("srgb")
  // embeds, so images already processed by sharp or libvips carry it.
  "c56e1685d888f5edb92fe07f2750f387f8fe8e91b32ff8fb0b56bfbbb9458353",
]);

/**
 * True when sharp may skip the embedded-profile conversion without changing a
 * pixel. Limited to 8-bit sRGB images: a 16-bit image is processed in P3, not
 * sRGB, so its conversion is not the identity even with an sRGB profile.
 */
export function hasNoOpProfile(metadata: Pick<Metadata, "icc" | "depth" | "space">): boolean {
  if (!metadata.icc || metadata.depth !== "uchar" || metadata.space !== "srgb") {
    return false;
  }

  return noOpProfiles.has(createHash("sha256").update(metadata.icc).digest("hex"));
}
