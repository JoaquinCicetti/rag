import type { Embedder } from "../embeddings/ollama.ts";
import { buildContext } from "../generation/context.ts";
import type { ChatMessage, LLM } from "../generation/llm.ts";
import { NO_INFO, SYSTEM_PROMPT, userPrompt } from "../generation/prompt.ts";
import { Trace, writeTrace } from "../observability/trace.ts";
import { vectorSearch } from "../retrieval/search.ts";
import type { Answer } from "../types.ts";
import type { SearchFilter, VectorStore } from "../vectorstore/qdrant.ts";

export interface AskOptions {
  topK?: number;
  filter?: SearchFilter;
  maxContextChars?: number;
}

/** search -> build context -> LLM -> answer with citations. Every run writes a trace. */
export const ask = async (
  question: string,
  deps: { embedder: Embedder; store: VectorStore; llm: LLM },
  opts: AskOptions = {},
): Promise<Answer> => {
  const q = question.trim();
  if (!q) throw new Error("question is empty");

  const trace = new Trace("ask", q);
  try {
    return await run(q, deps, opts, trace);
  } catch (e) {
    trace.fail(e);
    throw e;
  } finally {
    await writeTrace(trace.finish()).catch((e) => console.error(`trace write failed: ${(e as Error).message}`));
  }
};

const run = async (
  q: string,
  deps: { embedder: Embedder; store: VectorStore; llm: LLM },
  opts: AskOptions,
  trace: Trace,
): Promise<Answer> => {
  const t0 = performance.now();
  const { chunks, timings } = await vectorSearch(q, deps, { topK: opts.topK, filter: opts.filter, trace });

  if (chunks.length === 0) {
    trace.set({ outcome: "no-chunks" });
    return {
      traceId: trace.id,
      question: q,
      answer: NO_INFO,
      citations: [],
      retrieved: [],
      model: deps.llm.model,
      timings: { ...timings, generateMs: 0, totalMs: performance.now() - t0 },
    };
  }

  const ctx = await trace.span("context", (span) => {
    const c = buildContext(chunks, { maxChars: opts.maxContextChars });
    span.set({ included: c.citations.length, dropped: c.dropped, chars: c.chars, budget: c.budget });
    return c;
  });

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt(q, ctx.text) },
  ];

  const t1 = performance.now();
  const result = await trace.span("generate", async (span) => {
    span.set({ model: deps.llm.model, promptChars: messages.reduce((n, m) => n + m.content.length, 0), messages });
    const r = await deps.llm.chat(messages);
    const u = r.usage ?? {};
    span.set({
      model: r.model,
      ...u,
      ...(u.outputTokens && u.evalMs ? { outputTokensPerSec: u.outputTokens / (u.evalMs / 1000) } : {}),
      answerChars: r.text.length,
    });
    return r;
  });
  const generateMs = performance.now() - t1;

  // Only keep citations the model actually referenced; keeps the trail honest.
  const referenced = new Set([...result.text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const citations = referenced.size > 0 ? ctx.citations.filter((c) => referenced.has(c.n)) : [];
  trace.set({ citations: citations.map((c) => c.n), answer: result.text });

  return {
    traceId: trace.id,
    question: q,
    answer: result.text,
    citations,
    retrieved: chunks,
    model: result.model,
    usage: result.usage,
    context: { chars: ctx.chars, budget: ctx.budget, included: ctx.citations.length, dropped: ctx.dropped },
    timings: { ...timings, generateMs, totalMs: performance.now() - t0 },
  };
};
