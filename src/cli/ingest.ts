import { parseArgs } from "node:util";
import { createEmbedder } from "../embeddings/ollama.ts";
import { parseStrategy } from "../ingest/chunk.ts";
import { ingestPath } from "../pipeline/ingest.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: { strategy: { type: "string" } },
});
const path = positionals[0];
if (!path) {
  console.error("usage: bun run ingest <file-or-directory> [--strategy fixed|paragraph|heading|semantic]");
  process.exit(1);
}

const store = createVectorStore();
const strategy = values.strategy ? parseStrategy(values.strategy) : undefined;
const report = await ingestPath(path, { embedder: createEmbedder(), store }, { log: console.log, strategy });

console.log(
  `\ningested ${report.documents} document(s), ${report.chunks} chunk(s) in ${(report.ms / 1000).toFixed(1)}s`,
);
const tokensPerSec = report.embedMs > 0 ? report.embedTokens / (report.embedMs / 1000) : 0;
console.log(
  `embedded ${report.embedTokens.toLocaleString("en-US")} token(s) in ${(report.embedMs / 1000).toFixed(1)}s (${Math.round(tokensPerSec).toLocaleString("en-US")} tok/s)`,
);
const pointCount = await store.count();
console.log(`collection now has ${pointCount} point(s)`);
console.log(`trace ${report.traceId.slice(0, 8)}  (bun run traces ${report.traceId.slice(0, 8)})`);
