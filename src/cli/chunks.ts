import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { createEmbedder } from "../embeddings/ollama.ts";
import { CHUNK_STRATEGIES, chunkDocument, parseStrategy } from "../ingest/chunk.ts";
import { loadDocuments } from "../ingest/loaders.ts";
import { parseSections, sectionsWithBodyIn } from "../ingest/structure.ts";
import type { Chunk, ChunkStrategy } from "../types.ts";

interface StrategyStats {
  strategy: ChunkStrategy;
  chunks: Array<Chunk>;
  crossings: number;
  embedTokens: number;
  ms: number;
}

const DEFAULT_STRATEGIES = CHUNK_STRATEGIES.filter((strategy) => strategy !== "semantic").join(",");
const SENTENCE_CLOSED = /[.!?:;]["'”’)\]]*$/;

const { positionals, values } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    strategy: { type: "string", default: DEFAULT_STRATEGIES },
    size: { type: "string" },
    overlap: { type: "string" },
    show: { type: "string", default: "0" },
  },
});
const path = positionals[0];
if (!path) {
  console.error(`usage: bun run chunks <file-or-directory> [--strategy ${CHUNK_STRATEGIES.join(",")}] [--size N] [--overlap N] [--show N]`);
  process.exit(1);
}

const strategies = values.strategy.split(",").map((name) => parseStrategy(name.trim()));
const size = values.size ? Number.parseInt(values.size, 10) : config.chunking.size;
const overlap = values.overlap ? Number.parseInt(values.overlap, 10) : config.chunking.overlap;
const show = Number.parseInt(values.show, 10);
const embedder = strategies.includes("semantic") ? createEmbedder() : undefined;

const documents = await loadDocuments(path);
const totalChars = documents.reduce((total, doc) => total + doc.text.length, 0);
console.log(`${documents.length} document(s), ${totalChars.toLocaleString("en-US")} chars · size ${size}, overlap ${overlap}\n`);

const results: Array<StrategyStats> = [];
for (const strategy of strategies) {
  const startedAt = performance.now();
  const stats: StrategyStats = { strategy, chunks: [], crossings: 0, embedTokens: 0, ms: 0 };
  for (const doc of documents) {
    const options = { ...config.chunking, strategy, size, overlap };
    const chunked = await chunkDocument(doc, options, { embedder });
    const sections = parseSections(doc.text);
    stats.chunks.push(...chunked.chunks);
    stats.crossings += chunked.chunks.filter((chunk) => sectionsWithBodyIn(sections, chunk.metadata).length > 1).length;
    stats.embedTokens += chunked.embedTokens;
  }
  stats.ms = performance.now() - startedAt;
  results.push(stats);
}

const percent = (part: number, whole: number): string => (whole === 0 ? "-" : `${((part / whole) * 100).toFixed(1)}%`);

const row = (stats: StrategyStats): Record<string, string | number> => {
  const lengths = stats.chunks.map((chunk) => chunk.text.length).sort((a, b) => a - b);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const unclosed = stats.chunks.filter((chunk) => !SENTENCE_CLOSED.test(chunk.text)).length;
  return {
    strategy: stats.strategy,
    chunks: lengths.length,
    min: lengths[0] ?? 0,
    p50: lengths[Math.floor(lengths.length / 2)] ?? 0,
    avg: lengths.length > 0 ? Math.round(total / lengths.length) : 0,
    max: lengths.at(-1) ?? 0,
    "mid-sentence end": percent(unclosed, lengths.length),
    "crosses section": percent(stats.crossings, lengths.length),
    "embed tokens": stats.embedTokens,
    ms: Math.round(stats.ms),
  };
};

console.table(results.map(row));

if (show > 0) {
  for (const stats of results) {
    console.log(`\n=== ${stats.strategy} ===`);
    for (const chunk of stats.chunks.slice(0, show)) {
      const { sourcePath, chunkIndex, start, end, section, page } = chunk.metadata;
      const location = `${section ? ` | ${section}` : ""}${page !== undefined ? ` | p. ${page}` : ""}`;
      console.log(`\n--- ${sourcePath}#chunk${chunkIndex} [${start}, ${end})${location}\n${chunk.text}`);
    }
  }
}
