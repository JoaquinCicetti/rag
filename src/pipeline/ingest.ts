import { config } from "../config.ts";
import type { Embedder } from "../embeddings/ollama.ts";
import { chunkDocument } from "../ingest/chunk.ts";
import { loadDocuments } from "../ingest/loaders.ts";
import { Trace, writeTrace } from "../observability/trace.ts";
import type { VectorStore } from "../vectorstore/qdrant.ts";

export interface IngestReport {
  /** Id of the trace written for this run (`bun run traces <id>`). */
  traceId: string;
  documents: number;
  chunks: number;
  /** Tokens processed by the embedding model across all documents. */
  embedTokens: number;
  /** Time spent inside the embedding model, for a tokens/s figure. */
  embedMs: number;
  perDocument: Array<{ sourcePath: string; title: string; chunks: number }>;
  ms: number;
}

/**
 * load -> chunk -> embed -> upsert.
 * Idempotent: chunk ids are derived from (sourcePath, chunkIndex), so re-running
 * on the same files overwrites points instead of duplicating them.
 * If a document shrank (fewer chunks than before), stale chunks are removed first.
 */
export const ingestPath = async (
  path: string,
  deps: { embedder: Embedder; store: VectorStore },
  opts: { log?: (line: string) => void } = {},
): Promise<IngestReport> => {
  const trace = new Trace("ingest", path);
  try {
    return await run(path, deps, opts.log ?? (() => {}), trace);
  } catch (e) {
    trace.fail(e);
    throw e;
  } finally {
    await writeTrace(trace.finish()).catch((e) => console.error(`trace write failed: ${(e as Error).message}`));
  }
};

const run = async (
  path: string,
  deps: { embedder: Embedder; store: VectorStore },
  log: (line: string) => void,
  trace: Trace,
): Promise<IngestReport> => {
  const t0 = performance.now();
  trace.set({ embedModel: deps.embedder.model, chunking: config.chunking });

  await deps.store.ensureCollection(deps.embedder.dim);
  const docs = await trace.span("load", async (span) => {
    const d = await loadDocuments(path);
    span.set({ documents: d.length, chars: d.reduce((n, doc) => n + doc.text.length, 0) });
    return d;
  });
  log(`loaded ${docs.length} document(s) from ${path}`);

  const perDocument: IngestReport["perDocument"] = [];
  let total = 0;
  let embedTokens = 0;
  let embedMs = 0;

  for (const doc of docs) {
    await trace.span("document", async (span) => {
      const chunks = await span.span("chunk", (s) => {
        const c = chunkDocument(doc, config.chunking);
        s.set({ chunks: c.length, avgChars: c.length ? Math.round(c.reduce((n, x) => n + x.text.length, 0) / c.length) : 0 });
        return c;
      });
      log(`  ${doc.sourcePath}: ${chunks.length} chunk(s), embedding…`);
      // Drop stale chunks for this source so a shrunken document does not leave orphans.
      await span.span("delete-stale", () => deps.store.deleteBySource(doc.sourceId));
      const vectors = await span.span("embed", async (s) => {
        const { embeddings, stats } = await deps.embedder.embedWithStats(chunks.map((c) => c.text));
        s.set({
          model: deps.embedder.model,
          ...stats,
          tokensPerSec: stats.totalMs > 0 ? stats.inputTokens / (stats.totalMs / 1000) : 0,
        });
        embedTokens += stats.inputTokens;
        embedMs += stats.totalMs;
        return embeddings;
      });
      await span.span("upsert", () => deps.store.upsert(chunks, vectors), { points: chunks.length });
      span.set({ sourcePath: doc.sourcePath, title: doc.title, chars: doc.text.length, chunks: chunks.length });
      perDocument.push({ sourcePath: doc.sourcePath, title: doc.title, chunks: chunks.length });
      total += chunks.length;
    });
  }

  trace.set({ documents: docs.length, chunks: total, embedTokens });
  return {
    traceId: trace.id,
    documents: docs.length,
    chunks: total,
    embedTokens,
    embedMs,
    perDocument,
    ms: performance.now() - t0,
  };
};
