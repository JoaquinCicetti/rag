import { parseArgs } from "node:util";
import { createEmbedder } from "../embeddings/ollama.ts";
import { createLLM } from "../generation/llm.ts";
import { formatTrace } from "../observability/format.ts";
import { findTrace } from "../observability/trace.ts";
import { ask } from "../pipeline/ask.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    "top-k": { type: "string", short: "k" },
    json: { type: "boolean", default: false },
    "show-context": { type: "boolean", default: false },
    trace: { type: "boolean", default: false },
  },
});

const question = positionals.join(" ").trim();
if (!question) {
  console.error('usage: bun run ask "question" [--top-k 5] [--json] [--show-context] [--trace]');
  process.exit(1);
}

const answer = await ask(
  question,
  { embedder: createEmbedder(), store: createVectorStore(), llm: createLLM() },
  { topK: values["top-k"] ? Number(values["top-k"]) : undefined },
);

if (values.json) {
  console.log(JSON.stringify(answer, null, 2));
  process.exit(0);
}

console.log(`\n${answer.answer}\n`);
if (answer.citations.length > 0) {
  console.log("Sources:");
  for (const citation of answer.citations) {
    const location = `${citation.section ? ` › ${citation.section}` : ""}${citation.page !== undefined ? ` (p. ${citation.page})` : ""}`;
    console.log(`  [${citation.n}] ${citation.sourcePath}#chunk${citation.chunkIndex} (score ${citation.score.toFixed(3)}) — ${citation.title}${location}`);
  }
}
if (values["show-context"]) {
  console.log("\nRetrieved chunks:");
  for (const [index, chunk] of answer.retrieved.entries()) {
    console.log(`\n--- [${index + 1}] ${chunk.metadata.sourcePath}#chunk${chunk.metadata.chunkIndex} score=${chunk.score.toFixed(3)}\n${chunk.text}`);
  }
}
const timings = answer.timings;
const usage = answer.usage;
const orUnknown = (value?: number): string => (value === undefined ? "?" : String(value));
const speed = usage?.outputTokens && usage.evalMs ? ` ${(usage.outputTokens / (usage.evalMs / 1000)).toFixed(1)} tok/s` : "";
const tokens = usage
  ? ` | tokens in=${orUnknown(usage.inputTokens)} (cached ${orUnknown(usage.cachedInputTokens)}) out=${orUnknown(usage.outputTokens)}${speed}`
  : "";
const contextSize = answer.context ? ` | context ${answer.context.chars}/${answer.context.budget} chars` : "";
console.log(
  `\nmodel=${answer.model} embed=${timings.embedMs.toFixed(0)}ms search=${timings.searchMs.toFixed(0)}ms generate=${timings.generateMs.toFixed(0)}ms total=${timings.totalMs.toFixed(0)}ms${contextSize}${tokens}`,
);

if (values.trace) {
  const record = await findTrace(answer.traceId);
  console.log(record ? `\n${formatTrace(record)}` : "\n(trace not found; is TRACES_ENABLED=false?)");
} else {
  console.log(`trace ${answer.traceId.slice(0, 8)}  (bun run traces ${answer.traceId.slice(0, 8)})`);
}
