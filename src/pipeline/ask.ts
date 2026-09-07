import type { Embedder } from "../embeddings/ollama.ts";
import { buildContext } from "../generation/context.ts";
import type { LLM } from "../generation/llm.ts";
import { NO_INFO, SYSTEM_PROMPT, userPrompt } from "../generation/prompt.ts";
import { vectorSearch } from "../retrieval/search.ts";
import type { Answer } from "../types.ts";
import type { SearchFilter, VectorStore } from "../vectorstore/qdrant.ts";

export interface AskOptions {
  topK?: number;
  filter?: SearchFilter;
  maxContextChars?: number;
}

/** search -> build context -> LLM -> answer with citations. */
export const ask = async (
  question: string,
  deps: { embedder: Embedder; store: VectorStore; llm: LLM },
  opts: AskOptions = {},
): Promise<Answer> => {
  const t0 = performance.now();
  const q = question.trim();
  if (!q) throw new Error("question is empty");

  const { chunks, timings } = await vectorSearch(q, deps, { topK: opts.topK, filter: opts.filter });

  if (chunks.length === 0) {
    return {
      question: q,
      answer: NO_INFO,
      citations: [],
      retrieved: [],
      model: deps.llm.model,
      timings: { ...timings, generateMs: 0, totalMs: performance.now() - t0 },
    };
  }

  const ctx = buildContext(chunks, { maxChars: opts.maxContextChars });

  const t1 = performance.now();
  const result = await deps.llm.chat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt(q, ctx.text) },
  ]);
  const generateMs = performance.now() - t1;

  // Only keep citations the model actually referenced; keeps the trail honest.
  const referenced = new Set([...result.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const citations = referenced.size > 0 ? ctx.citations.filter((c) => referenced.has(c.n)) : [];

  return {
    question: q,
    answer: result.text,
    citations,
    retrieved: chunks,
    model: result.model,
    timings: { ...timings, generateMs, totalMs: performance.now() - t0 },
  };
};
