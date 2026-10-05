import { config } from "../config.ts";
import type { Embedder } from "../embeddings/ollama.ts";
import { inSpan, type Trace } from "../observability/trace.ts";
import type { RetrievedChunk } from "../types.ts";
import type { SearchFilter, VectorStore } from "../vectorstore/qdrant.ts";

export interface SearchOptions {
  topK?: number;
  filter?: SearchFilter;
  trace?: Trace;
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
  const vector = await inSpan(opts.trace, "embed", async (span) => {
    const { embeddings, stats } = await deps.embedder.embedWithStats([query]);
    span.set({ model: deps.embedder.model, inputTokens: stats.inputTokens, loadMs: stats.loadMs });
    const [v] = embeddings;
    if (!v) throw new Error("empty embedding");
    return v;
  });
  const t1 = performance.now();
  const chunks = await inSpan(opts.trace, "search", async (span) => {
    const res = await deps.store.search(vector, topK, opts.filter);
    span.set({
      store: "qdrant",
      topK,
      returned: res.length,
      ...(opts.filter ? { filter: opts.filter } : {}),
      hits: res.map((c) => ({
        id: c.id,
        score: c.score,
        source: `${c.metadata.sourcePath}#chunk${c.metadata.chunkIndex}`,
      })),
    });
    return res;
  });
  const t2 = performance.now();

  return { chunks, timings: { embedMs: t1 - t0, searchMs: t2 - t1 } };
};
