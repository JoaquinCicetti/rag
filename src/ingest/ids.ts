import { createHash } from "node:crypto";

export const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

export const sourceIdFor = (sourcePath: string): string =>
  sha256(sourcePath.replace(/\\/g, "/"));

export const uuidFromHex = (hex: string): string => {
  const digits = hex.slice(0, 32).split("");
  digits[12] = "4";
  digits[16] = ((parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const uuid = digits.join("");
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20, 32)}`;
};

export const chunkIdFor = (sourceId: string, chunkIndex: number): string =>
  uuidFromHex(sha256(`${sourceId}:${chunkIndex}`));
