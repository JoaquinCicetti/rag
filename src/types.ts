import type { LLMUsage } from "./generation/llm.ts";

export interface Span {
  start: number;
  end: number;
}

export interface PageSpan extends Span {
  page: number;
}

export type ChunkStrategy = "fixed" | "paragraph" | "heading" | "semantic";

export interface Document {
  sourceId: string;
  sourcePath: string;
  title: string;
  text: string;
  format: string;
  contentHash: string;
  pages?: Array<PageSpan>;
}

export interface ChunkMetadata {
  sourceId: string;
  sourcePath: string;
  title: string;
  chunkIndex: number;
  start: number;
  end: number;
  strategy: ChunkStrategy;
  format: string;
  contentHash: string;
  section?: string;
  page?: number;
  pageEnd?: number;
}

export interface Chunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

export interface RetrievedChunk extends Chunk {
  score: number;
}

export interface Citation {
  n: number;
  sourcePath: string;
  title: string;
  chunkIndex: number;
  score: number;
  snippet: string;
  section?: string;
  page?: number;
}

export interface Answer {
  traceId: string;
  question: string;
  answer: string;
  citations: Array<Citation>;
  retrieved: Array<RetrievedChunk>;
  model: string;
  usage?: LLMUsage;
  context?: ContextStats;
  timings: AnswerTimings;
}

export interface ContextStats {
  chars: number;
  budget: number;
  included: number;
  dropped: number;
}

export interface SearchTimings {
  embedMs: number;
  searchMs: number;
}

export interface AnswerTimings extends SearchTimings {
  generateMs: number;
  totalMs: number;
}
