/** Usage: bun run ingest <file-or-directory> */
import { parseArgs } from "node:util";
import { createEmbedder } from "../embeddings/ollama.ts";
import { ingestPath } from "../pipeline/ingest.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const { positionals } = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true });
const path = positionals[0];
if (!path) {
  console.error("usage: bun run ingest <file-or-directory>");
  process.exit(1);
}

const store = createVectorStore();
const report = await ingestPath(path, { embedder: createEmbedder(), store }, { log: console.log });

console.log(
  `\ningested ${report.documents} document(s), ${report.chunks} chunk(s) in ${(report.ms / 1000).toFixed(1)}s`,
);
console.log(`collection now has ${await store.count()} point(s)`);
