/** Usage: bun run ask "question" [--top-k 5] [--json] [--show-context] [--trace] */
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
  for (const c of answer.citations) {
    console.log(`  [${c.n}] ${c.sourcePath}#chunk${c.chunkIndex} (score ${c.score.toFixed(3)}) — ${c.title}`);
  }
}
if (values["show-context"]) {
  console.log("\nRetrieved chunks:");
  for (const [i, r] of answer.retrieved.entries()) {
    console.log(`\n--- [${i + 1}] ${r.metadata.sourcePath}#chunk${r.metadata.chunkIndex} score=${r.score.toFixed(3)}\n${r.text}`);
  }
}
const t = answer.timings;
const u = answer.usage;
const fmt = (v?: number) => (v === undefined ? "?" : String(v));
const tokens = u
  ? ` | tokens in=${fmt(u.inputTokens)} (cached ${fmt(u.cachedInputTokens)}) out=${fmt(u.outputTokens)}` +
    (u.outputTokens && u.evalMs ? ` ${(u.outputTokens / (u.evalMs / 1000)).toFixed(1)} tok/s` : "")
  : "";
const ctx = answer.context ? ` | context ${answer.context.chars}/${answer.context.budget} chars` : "";
console.log(
  `\nmodel=${answer.model} embed=${t.embedMs.toFixed(0)}ms search=${t.searchMs.toFixed(0)}ms generate=${t.generateMs.toFixed(0)}ms total=${t.totalMs.toFixed(0)}ms${ctx}${tokens}`,
);

if (values.trace) {
  const record = await findTrace(answer.traceId);
  console.log(record ? `\n${formatTrace(record)}` : "\n(trace not found; is TRACES_ENABLED=false?)");
} else {
  console.log(`trace ${answer.traceId.slice(0, 8)}  (bun run traces ${answer.traceId.slice(0, 8)})`);
}
