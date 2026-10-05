import { config } from "../config.ts";
import { chunkDocument } from "../ingest/chunk.ts";
import { loadDocuments } from "../ingest/loaders.ts";
import { Trace, writeTrace } from "../observability/trace.ts";
import type { SearchDeps } from "../retrieval/search.ts";
import type { Chunk } from "../types.ts";

export interface DocumentSummary {
  sourcePath: string;
  title: string;
  chunks: number;
}

export interface IngestReport {
  traceId: string;
  documents: number;
  chunks: number;
  embedTokens: number;
  embedMs: number;
  perDocument: Array<DocumentSummary>;
  ms: number;
}

export interface IngestOptions {
  log?: (line: string) => void;
}

const silent = (): void => {};

const averageChars = (chunks: Array<Chunk>): number => {
  if (chunks.length === 0) return 0;
  const totalChars = chunks.reduce((total, chunk) => total + chunk.text.length, 0);
  return Math.round(totalChars / chunks.length);
};

export const ingestPath = async (path: string, deps: SearchDeps, options?: IngestOptions): Promise<IngestReport> => {
  const trace = new Trace("ingest", path);
  try {
    return await run(path, deps, options?.log ?? silent, trace);
  } catch (error) {
    trace.fail(error);
    throw error;
  } finally {
    await writeTrace(trace.finish()).catch((error) => console.error(`trace write failed: ${(error as Error).message}`));
  }
};

const run = async (path: string, deps: SearchDeps, log: (line: string) => void, trace: Trace): Promise<IngestReport> => {
  const startedAt = performance.now();
  trace.set({ embedModel: deps.embedder.model, chunking: config.chunking });

  await deps.store.ensureCollection(deps.embedder.dim);
  const documents = await trace.span("load", async (span) => {
    const loaded = await loadDocuments(path);
    span.set({ documents: loaded.length, chars: loaded.reduce((total, doc) => total + doc.text.length, 0) });
    return loaded;
  });
  log(`loaded ${documents.length} document(s) from ${path}`);

  const perDocument: Array<DocumentSummary> = [];
  let totalChunks = 0;
  let embedTokens = 0;
  let embedMs = 0;

  for (const doc of documents) {
    await trace.span("document", async (span) => {
      const chunks = await span.span("chunk", (chunkSpan) => {
        const docChunks = chunkDocument(doc, config.chunking);
        chunkSpan.set({ chunks: docChunks.length, avgChars: averageChars(docChunks) });
        return docChunks;
      });
      log(`  ${doc.sourcePath}: ${chunks.length} chunk(s), embedding…`);
      await span.span("delete-stale", () => deps.store.deleteBySource(doc.sourceId));
      const vectors = await span.span("embed", async (embedSpan) => {
        const { embeddings, stats } = await deps.embedder.embedWithStats(chunks.map((chunk) => chunk.text));
        embedSpan.set({
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
      totalChunks += chunks.length;
    });
  }

  trace.set({ documents: documents.length, chunks: totalChunks, embedTokens });
  return {
    traceId: trace.id,
    documents: documents.length,
    chunks: totalChunks,
    embedTokens,
    embedMs,
    perDocument,
    ms: performance.now() - startedAt,
  };
};
