import type { Chunk, Document } from "../types.ts";
import { chunkIdFor } from "./ids.ts";

export interface FixedChunkOptions {
  size: number;
  overlap: number;
}

interface Span {
  start: number;
  end: number;
}

export const fixedSizeSpans = (text: string, options: FixedChunkOptions): Array<Span> => {
  const { size, overlap } = options;
  if (size <= 0) throw new Error("chunk size must be > 0");
  if (overlap < 0 || overlap >= size) throw new Error("overlap must be in [0, size)");

  const spans: Array<Span> = [];
  const length = text.length;
  let start = 0;

  while (start < length) {
    let end = Math.min(start + size, length);

    if (end < length) {
      const minCut = start + Math.floor(size / 2);
      const window = text.slice(minCut, end);
      const candidates = [
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        lastSentenceEnd(window),
        window.lastIndexOf(" "),
      ];
      const cut = candidates.find((candidate) => candidate > 0);
      if (cut !== undefined) end = minCut + cut + 1;
    }

    const trimmedStart = skipWhitespace(text, start, end);
    const trimmedEnd = trimWhitespaceEnd(text, trimmedStart, end);
    if (trimmedEnd > trimmedStart) spans.push({ start: trimmedStart, end: trimmedEnd });

    if (end >= length) break;
    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : end;
  }

  return spans;
};

const lastSentenceEnd = (text: string): number => {
  const matches = [...text.matchAll(/[.!?]["')\]]?\s/g)];
  const last = matches.at(-1);
  return last?.index !== undefined ? last.index + last[0].length - 1 : -1;
};

const isWhitespace = (char: string | undefined): boolean => /\s/.test(char ?? "");

const skipWhitespace = (text: string, from: number, to: number): number => {
  let position = from;
  while (position < to && isWhitespace(text[position])) position++;
  return position;
};

const trimWhitespaceEnd = (text: string, from: number, to: number): number => {
  let position = to;
  while (position > from && isWhitespace(text[position - 1])) position--;
  return position;
};

export const chunkDocument = (doc: Document, options: FixedChunkOptions): Array<Chunk> =>
  fixedSizeSpans(doc.text, options).map((span, chunkIndex) => ({
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
