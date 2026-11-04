import type { Chunk, ChunkMetadata } from "../types.ts";

export type ChunkSpan = Pick<ChunkMetadata, "chunkIndex" | "start" | "end" | "section" | "page" | "pageEnd"> & { id: string };

export interface ReconstructedDocument {
  sourceId: string;
  sourcePath: string;
  title: string;
  format: string;
  text: string;
  chunks: Array<ChunkSpan>;
}

const toSpan = ({ id, metadata }: Chunk): ChunkSpan => ({
  id,
  chunkIndex: metadata.chunkIndex,
  start: metadata.start,
  end: metadata.end,
  ...(metadata.section ? { section: metadata.section } : {}),
  ...(metadata.page !== undefined ? { page: metadata.page } : {}),
  ...(metadata.pageEnd !== undefined ? { pageEnd: metadata.pageEnd } : {}),
});

// Chunk offsets index into the original text, and only whitespace falls between chunks,
// so padding the gaps keeps every offset exact and passages can be highlighted by span.
export const reconstructDocument = (chunks: Array<Chunk>): ReconstructedDocument | undefined => {
  const [first] = chunks;
  if (!first) return undefined;
  const ordered = [...chunks].sort((left, right) => left.metadata.start - right.metadata.start);

  let text = "";
  for (const { text: chunkText, metadata } of ordered) {
    if (metadata.end <= text.length) continue;
    if (metadata.start > text.length) text += "\n".repeat(metadata.start - text.length);
    text += chunkText.slice(text.length - metadata.start);
  }

  const { sourceId, sourcePath, title, format } = first.metadata;
  return { sourceId, sourcePath, title, format, text, chunks: ordered.map(toSpan) };
};
