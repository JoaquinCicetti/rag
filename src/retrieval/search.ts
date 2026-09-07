import { config } from "../config.ts";
import type { Embedder } from "../embeddings/ollama.ts";
import type { RetrievedChunk } from "../types.ts";
import type { SearchFilter, VectorStore } from "../vectorstore/qdrant.ts";

export interface SearchOptions {
  topK?: number;
  filter?: SearchFilter;
}

export interface SearchResult {
  chunks: RetrievedChunk[];
  timings: { embedMs: number; searchMs: number };
}

/**
 * Step 1 retrieval: pure vector search.
 * Step 3 adds BM25, hybrid fusion and re-ranking behind this same signature.
 */
export const vectorSearch = async (
  query: string,
  deps: { embedder: Embedder; store: VectorStore },
  opts: SearchOptions = {},
): Promise<SearchResult> => {
  const topK = opts.topK ?? config.retrieval.topK;

  const t0 = performance.now();
  const vector = await deps.embedder.embedOne(query);
  const t1 = performance.now();
  const chunks = await deps.store.search(vector, topK, opts.filter);
  const t2 = performance.now();

  return { chunks, timings: { embedMs: t1 - t0, searchMs: t2 - t1 } };
};
