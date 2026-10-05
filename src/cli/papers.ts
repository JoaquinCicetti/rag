import { parseArgs } from "node:util";
import { config } from "../config.ts";
import { createEmbedder } from "../embeddings/ollama.ts";
import { createLLM } from "../generation/llm.ts";
import { collectPapers } from "../papers/agent.ts";
import { OpenAccessSources } from "../papers/sources.ts";
import { ingestPath } from "../pipeline/ingest.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const DEFAULT_MAX_PAPERS = 5;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    max: { type: "string", short: "n" },
    ingest: { type: "boolean", default: false },
  },
});

const topic = positionals.join(" ").trim();
if (!topic) {
  console.error('usage: bun run papers "topic" [--max 5] [--ingest]');
  process.exit(1);
}
if (!config.papers.contactEmail) console.warn("CONTACT_EMAIL is not set: Unpaywall lookups are skipped.");

const maxPapers = values.max ? Number(values.max) : DEFAULT_MAX_PAPERS;
console.log(`collecting up to ${maxPapers} open-access paper(s) on "${topic}"…`);
const report = await collectPapers(
  topic,
  { llm: createLLM(), sources: new OpenAccessSources() },
  { maxPapers, log: console.log },
);

console.log(`\n${report.summary || "(no summary)"}\n`);
console.log(`downloaded ${report.downloaded.length} paper(s) in ${report.steps} step(s) to ${config.papers.dir}`);
console.log(`trace ${report.traceId.slice(0, 8)}  (bun run traces ${report.traceId.slice(0, 8)})`);

if (values.ingest && report.downloaded.length > 0) {
  const ingestReport = await ingestPath(config.papers.dir, { embedder: createEmbedder(), store: createVectorStore() }, { log: console.log });
  console.log(`ingested ${ingestReport.documents} document(s), ${ingestReport.chunks} chunk(s)`);
}
