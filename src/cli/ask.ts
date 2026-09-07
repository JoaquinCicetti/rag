/** Usage: bun run ask "question" [--top-k 5] [--json] [--show-context] */
import { parseArgs } from "node:util";
import { createEmbedder } from "../embeddings/ollama.ts";
import { createLLM } from "../generation/llm.ts";
import { ask } from "../pipeline/ask.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    "top-k": { type: "string", short: "k" },
    json: { type: "boolean", default: false },
    "show-context": { type: "boolean", default: false },
  },
});

const question = positionals.join(" ").trim();
if (!question) {
  console.error('usage: bun run ask "question" [--top-k 5] [--json] [--show-context]');
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
console.log(
  `\nmodel=${answer.model} embed=${t.embedMs.toFixed(0)}ms search=${t.searchMs.toFixed(0)}ms generate=${t.generateMs.toFixed(0)}ms total=${t.totalMs.toFixed(0)}ms`,
);
