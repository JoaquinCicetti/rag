import { describe, expect, test } from "bun:test";
import { chunkDocument, fixedSizeSpans } from "../src/ingest/chunk.ts";
import type { Document } from "../src/types.ts";

const doc = (text: string): Document => ({
  sourceId: "src",
  sourcePath: "a.md",
  title: "A",
  text,
  format: "md",
});

describe("fixedSizeSpans", () => {
  test("empty text yields no spans", () => {
    expect(fixedSizeSpans("", { size: 100, overlap: 10 })).toEqual([]);
  });

  test("short text yields a single span covering it", () => {
    expect(fixedSizeSpans("hello world", { size: 100, overlap: 10 })).toEqual([{ start: 0, end: 11 }]);
  });

  test("spans never exceed size and consecutive spans overlap", () => {
    const text = Array.from({ length: 80 }, (_, i) => `Oración número ${i} termina acá.`).join(" ");
    const spans = fixedSizeSpans(text, { size: 200, overlap: 50 });
    expect(spans.length).toBeGreaterThan(1);
    for (const s of spans) expect(s.end - s.start).toBeLessThanOrEqual(200);
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1]!;
      const cur = spans[i]!;
      expect(cur.start).toBeLessThan(prev.end);
      expect(cur.start).toBeGreaterThan(prev.start);
    }
    expect(spans.at(-1)!.end).toBe(text.length);
  });

  test("prefers paragraph boundaries", () => {
    const p1 = "a".repeat(120);
    const p2 = "b".repeat(120);
    const text = `${p1}\n\n${p2}`;
    const spans = fixedSizeSpans(text, { size: 200, overlap: 0 });
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(p1);
  });

  test("rejects invalid options", () => {
    expect(() => fixedSizeSpans("x", { size: 0, overlap: 0 })).toThrow();
    expect(() => fixedSizeSpans("x", { size: 10, overlap: 10 })).toThrow();
  });
});

describe("chunkDocument", () => {
  test("chunk text matches offsets and ids are stable", () => {
    const text = "Primer párrafo del documento.\n\nSegundo párrafo con más texto.\n\nTercero.";
    const a = chunkDocument(doc(text), { size: 40, overlap: 5 });
    const b = chunkDocument(doc(text), { size: 40, overlap: 5 });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    for (const c of a) {
      expect(text.slice(c.metadata.start, c.metadata.end)).toBe(c.text);
      expect(c.metadata.sourcePath).toBe("a.md");
    }
    expect(a.map((c) => c.metadata.chunkIndex)).toEqual(a.map((_, i) => i));
  });
});
