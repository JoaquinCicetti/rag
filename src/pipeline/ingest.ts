import { config } from "../config.ts";
import type { Embedder } from "../embeddings/ollama.ts";
import { chunkDocument } from "../ingest/chunk.ts";
import { loadDocuments } from "../ingest/loaders.ts";
import type { VectorStore } from "../vectorstore/qdrant.ts";

export interface IngestReport {
  documents: number;
  chunks: number;
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
  const log = opts.log ?? (() => {});
  const t0 = performance.now();

  await deps.store.ensureCollection(deps.embedder.dim);
  const docs = await loadDocuments(path);
  log(`loaded ${docs.length} document(s) from ${path}`);

  const perDocument: IngestReport["perDocument"] = [];
  let total = 0;

  for (const doc of docs) {
    const chunks = chunkDocument(doc, config.chunking);
    log(`  ${doc.sourcePath}: ${chunks.length} chunk(s), embedding…`);
    // Drop stale chunks for this source so a shrunken document does not leave orphans.
    await deps.store.deleteBySource(doc.sourceId);
    const vectors = await deps.embedder.embed(chunks.map((c) => c.text));
    await deps.store.upsert(chunks, vectors);
    perDocument.push({ sourcePath: doc.sourcePath, title: doc.title, chunks: chunks.length });
    total += chunks.length;
  }

  return { documents: docs.length, chunks: total, perDocument, ms: performance.now() - t0 };
};
