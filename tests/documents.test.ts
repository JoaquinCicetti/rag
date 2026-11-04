import { describe, expect, test } from "bun:test";
import { reconstructDocument } from "../src/retrieval/documents.ts";
import type { Chunk } from "../src/types.ts";

const SOURCE = "Alpha beta.\n\nGamma delta epsilon.\n\nZeta.";

const chunkOf = (start: number, end: number, chunkIndex = 0): Chunk => ({
  id: `${start}-${end}`,
  text: SOURCE.slice(start, end),
  metadata: {
    sourceId: "s",
    sourcePath: "a.md",
    title: "A",
    chunkIndex,
    start,
    end,
    strategy: "fixed",
    format: "md",
    contentHash: "h",
  },
});

describe("reconstructDocument", () => {
  test("returns undefined when the source has no chunks", () => {
    expect(reconstructDocument([])).toBeUndefined();
  });

  test("does not repeat overlapping text", () => {
    const document = reconstructDocument([chunkOf(0, 20), chunkOf(13, SOURCE.length, 1)]);
    expect(document?.text).toBe(SOURCE);
  });

  test("pads whitespace gaps so offsets still point at each chunk", () => {
    const chunks = [chunkOf(0, 11), chunkOf(13, 33, 1), chunkOf(35, SOURCE.length, 2)];
    const document = reconstructDocument(chunks);
    expect(document?.text.length).toBe(SOURCE.length);
    for (const chunk of chunks) {
      expect(document?.text.slice(chunk.metadata.start, chunk.metadata.end)).toBe(chunk.text);
    }
  });

  test("sorts chunks that arrive out of order and skips contained ones", () => {
    const document = reconstructDocument([chunkOf(13, SOURCE.length, 1), chunkOf(14, 20, 2), chunkOf(0, 13)]);
    expect(document?.text).toBe(SOURCE);
    expect(document?.chunks.map((chunk) => chunk.start)).toEqual([0, 13, 14]);
  });
});
