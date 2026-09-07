import { createHash } from "node:crypto";

/** sha256 hex digest. */
export const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

/**
 * Stable source id: hash of the normalized source path.
 * Re-ingesting the same file yields the same id, so upserts overwrite in place.
 */
export const sourceIdFor = (sourcePath: string): string =>
  sha256(sourcePath.replace(/\\/g, "/"));

/**
 * Format the first 16 bytes of a hex digest as an RFC 4122 style UUID.
 * Qdrant point ids must be UUIDs or unsigned ints, so we derive one from the hash.
 * Version/variant nibbles are set so the string validates as a v4-shaped UUID.
 */
export const uuidFromHex = (hex: string): string => {
  const h = hex.slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
};

/** Deterministic chunk id: uuid(sha256(sourceId:chunkIndex)). */
export const chunkIdFor = (sourceId: string, chunkIndex: number): string =>
  uuidFromHex(sha256(`${sourceId}:${chunkIndex}`));
