import type { Chunk, Document } from "../types.ts";
import { chunkIdFor } from "./ids.ts";

export interface FixedChunkOptions {
  /** Target chunk size in characters. */
  size: number;
  /** Characters of overlap between consecutive chunks. */
  overlap: number;
}

interface Span {
  start: number;
  end: number;
}

/**
 * Fixed-size chunking with overlap.
 *
 * Within each window we prefer to cut at a paragraph break, then a line break,
 * then a sentence end, then whitespace, so chunks rarely split mid-word.
 * Offsets refer to the original text so every chunk can be traced back.
 */
export const fixedSizeSpans = (text: string, opts: FixedChunkOptions): Span[] => {
  const { size, overlap } = opts;
  if (size <= 0) throw new Error("chunk size must be > 0");
  if (overlap < 0 || overlap >= size) throw new Error("overlap must be in [0, size)");

  const spans: Span[] = [];
  const len = text.length;
  let start = 0;

  while (start < len) {
    let end = Math.min(start + size, len);

    if (end < len) {
      // Look for a natural boundary in the second half of the window.
      const minCut = start + Math.floor(size / 2);
      const window = text.slice(minCut, end);
      const candidates = [
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        lastSentenceEnd(window),
        window.lastIndexOf(" "),
      ];
      const cut = candidates.find((c) => c > 0);
      if (cut !== undefined) end = minCut + cut + 1;
    }

    // Trim whitespace-only edges without losing offset accuracy.
    const s = skipWs(text, start, end);
    const e = trimWsEnd(text, s, end);
    if (e > s) spans.push({ start: s, end: e });

    if (end >= len) break;
    const next = end - overlap;
    start = next > start ? next : end; // always make progress
  }

  return spans;
};

const lastSentenceEnd = (s: string): number => {
  const m = [...s.matchAll(/[.!?]["')\]]?\s/g)];
  const last = m.at(-1);
  return last?.index !== undefined ? last.index + last[0].length - 1 : -1;
};

const skipWs = (text: string, from: number, to: number): number => {
  let i = from;
  while (i < to && /\s/.test(text[i] ?? "")) i++;
  return i;
};

const trimWsEnd = (text: string, from: number, to: number): number => {
  let i = to;
  while (i > from && /\s/.test(text[i - 1] ?? "")) i--;
  return i;
};

/** Turn a document into chunks with stable ids and traceable metadata. */
export const chunkDocument = (doc: Document, opts: FixedChunkOptions): Chunk[] =>
  fixedSizeSpans(doc.text, opts).map((span, chunkIndex) => ({
    id: chunkIdFor(doc.sourceId, chunkIndex),
    text: doc.text.slice(span.start, span.end),
    metadata: {
      sourceId: doc.sourceId,
      sourcePath: doc.sourcePath,
      title: doc.title,
      chunkIndex,
      start: span.start,
      end: span.end,
    },
  }));
