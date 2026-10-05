import { config } from "../config.ts";
import type { Embedder } from "../embeddings/ollama.ts";
import { inSpan, type Trace } from "../observability/trace.ts";
import type { RetrievedChunk, SearchTimings } from "../types.ts";
import type { SearchFilter, VectorStore } from "../vectorstore/qdrant.ts";

export interface SearchOptions {
  topK?: number;
  filter?: SearchFilter;
  trace?: Trace;
}

export interface SearchResult {
  chunks: Array<RetrievedChunk>;
  timings: SearchTimings;
}

export interface SearchDeps {
  embedder: Embedder;
  store: VectorStore;
}

export const vectorSearch = async (
  query: string,
  deps: SearchDeps,
  options?: SearchOptions,
): Promise<SearchResult> => {
  const topK = options?.topK ?? config.retrieval.topK;
  const filter = options?.filter;

  const startedAt = performance.now();
  const vector = await inSpan(options?.trace, "embed", async (span) => {
    const { embeddings, stats } = await deps.embedder.embedWithStats([query]);
    span.set({ model: deps.embedder.model, inputTokens: stats.inputTokens, loadMs: stats.loadMs });
    const [embedding] = embeddings;
    if (!embedding) throw new Error("empty embedding");
    return embedding;
  });
  const embeddedAt = performance.now();
  const chunks = await inSpan(options?.trace, "search", async (span) => {
    const hits = await deps.store.search(vector, topK, filter);
    span.set({
      store: "qdrant",
      topK,
      returned: hits.length,
      ...(filter ? { filter } : {}),
      hits: hits.map((hit) => ({
        id: hit.id,
        score: hit.score,
        source: `${hit.metadata.sourcePath}#chunk${hit.metadata.chunkIndex}`,
      })),
    });
    return hits;
  });
  const searchedAt = performance.now();

  return { chunks, timings: { embedMs: embeddedAt - startedAt, searchMs: searchedAt - embeddedAt } };
};
