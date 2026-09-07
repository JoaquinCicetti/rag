/** A source document as loaded from disk (or later: S3, upload, etc.). */
export interface Document {
  /** Stable id derived from the source path. */
  sourceId: string;
  /** Path relative to the ingest root (or absolute if a single file). */
  sourcePath: string;
  title: string;
  text: string;
  /** File extension without the dot, e.g. "md". */
  format: string;
}

export interface ChunkMetadata {
  sourceId: string;
  sourcePath: string;
  title: string;
  chunkIndex: number;
  /** Character offsets into the original document text. */
  start: number;
  end: number;
  /** Optional structural info, filled in from step 2 onwards. */
  section?: string;
  page?: number;
}

export interface Chunk {
  /** UUID derived deterministically from sourceId + chunkIndex. */
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

export interface RetrievedChunk extends Chunk {
  /** Similarity score as reported by the vector store (cosine). */
  score: number;
}

export interface Citation {
  /** 1-based index as it appears in the answer, e.g. [2]. */
  n: number;
  sourcePath: string;
  title: string;
  chunkIndex: number;
  score: number;
  snippet: string;
}

export interface Answer {
  question: string;
  answer: string;
  citations: Citation[];
  retrieved: RetrievedChunk[];
  model: string;
  timings: {
    embedMs: number;
    searchMs: number;
    generateMs: number;
    totalMs: number;
  };
}
