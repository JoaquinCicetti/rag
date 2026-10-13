import type { Embedder } from "../../embeddings/ollama.ts";
import type { Span } from "../../types.ts";
import { shift } from "../spans.ts";
import { assertChunkOptions, fixedSizeSpans, type FixedChunkOptions } from "./fixed.ts";
import { paragraphsIn } from "./paragraph.ts";

export interface SemanticChunkOptions extends FixedChunkOptions {
  percentile?: number;
}

export interface SemanticResult {
  spans: Array<Span>;
  embedTokens: number;
}

interface Group {
  first: number;
  last: number;
}

const DEFAULT_PERCENTILE = 90;
const MIN_SENTENCE_CHARS = 40;
const WINDOW_MAX_CHARS = 2000;
const SENTENCE_END = /[.!?]["')\]]?\s+/g;

export const sentenceSpans = (text: string): Array<Span> => {
  const sentences: Array<Span> = [];
  for (const paragraph of paragraphsIn(text)) {
    let start = paragraph.start;
    for (const match of text.slice(paragraph.start, paragraph.end).matchAll(SENTENCE_END)) {
      const end = paragraph.start + match.index + match[0].trimEnd().length;
      if (end - start < MIN_SENTENCE_CHARS) continue;
      sentences.push({ start, end });
      start = paragraph.start + match.index + match[0].length;
    }
    if (start < paragraph.end) sentences.push({ start, end: paragraph.end });
  }
  return sentences;
};

const cosineDistance = (a: Array<number>, b: Array<number>): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const norm = Math.sqrt(normA) * Math.sqrt(normB);
  return norm === 0 ? 1 : 1 - dot / norm;
};

const percentileOf = (values: Array<number>, percentile: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index] ?? Infinity;
};

export const semanticSpans = async (
  text: string,
  options: SemanticChunkOptions,
  embedder: Embedder,
): Promise<SemanticResult> => {
  assertChunkOptions(options);
  const sentences = sentenceSpans(text);
  if (sentences.length === 0) return { spans: [], embedTokens: 0 };

  const size = options.size;
  const minSize = Math.floor(size / 4);
  const lengthOf = (group: Group): number => sentences[group.last]!.end - sentences[group.first]!.start;

  const windows = sentences.map((_, index) => {
    const start = sentences[Math.max(0, index - 1)]!.start;
    const end = sentences[Math.min(sentences.length - 1, index + 1)]!.end;
    return text.slice(start, Math.min(end, start + WINDOW_MAX_CHARS));
  });
  const { embeddings, stats } =
    sentences.length > 1
      ? await embedder.embedWithStats(windows)
      : { embeddings: [], stats: { inputTokens: 0 } };
  const distances = embeddings.slice(1).map((embedding, index) => cosineDistance(embeddings[index]!, embedding));
  const threshold = percentileOf(distances, options.percentile ?? DEFAULT_PERCENTILE);

  const groups: Array<Group> = [];
  let first = 0;
  for (const [index, distance] of distances.entries()) {
    if (distance <= threshold) continue;
    groups.push({ first, last: index });
    first = index + 1;
  }
  groups.push({ first, last: sentences.length - 1 });

  const merged: Array<Group> = [];
  for (const group of groups) {
    const previous = merged.at(-1);
    if (previous && lengthOf(previous) < minSize) previous.last = group.last;
    else merged.push({ ...group });
  }
  if (merged.length > 1 && lengthOf(merged.at(-1)!) < minSize) {
    const tail = merged.pop()!;
    merged.at(-1)!.last = tail.last;
  }

  const split = (group: Group): Array<Span> => {
    const span = { start: sentences[group.first]!.start, end: sentences[group.last]!.end };
    if (lengthOf(group) <= size) return [span];
    if (group.first === group.last) {
      return fixedSizeSpans(text.slice(span.start, span.end), { size, overlap: 0 }).map((piece) => shift(piece, span.start));
    }
    const cutAt = widestGap(group);
    return [...split({ first: group.first, last: cutAt }), ...split({ first: cutAt + 1, last: group.last })];
  };

  const widestGap = (group: Group): number => {
    let best = group.first;
    let bestScore = -Infinity;
    for (let index = group.first; index < group.last; index++) {
      const balanced =
        lengthOf({ first: group.first, last: index }) >= minSize && lengthOf({ first: index + 1, last: group.last }) >= minSize;
      const score = (distances[index] ?? 0) + (balanced ? 2 : 0);
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    }
    return best;
  };

  return { spans: merged.flatMap(split), embedTokens: stats.inputTokens };
};
