import { buildContext } from "../generation/context.ts";
import type { ChatMessage, LLM } from "../generation/llm.ts";
import { NO_INFO, SYSTEM_PROMPT, userPrompt } from "../generation/prompt.ts";
import { Trace, writeTrace } from "../observability/trace.ts";
import { vectorSearch, type SearchDeps } from "../retrieval/search.ts";
import type { Answer } from "../types.ts";
import type { SearchFilter } from "../vectorstore/qdrant.ts";

export interface AskOptions {
  topK?: number;
  filter?: SearchFilter;
  maxContextChars?: number;
}

export interface AskDeps extends SearchDeps {
  llm: LLM;
}

export const ask = async (question: string, deps: AskDeps, options?: AskOptions): Promise<Answer> => {
  const trimmedQuestion = question.trim();
  if (!trimmedQuestion) throw new Error("question is empty");

  const trace = new Trace("ask", trimmedQuestion);
  try {
    return await run(trimmedQuestion, deps, options, trace);
  } catch (error) {
    trace.fail(error);
    throw error;
  } finally {
    await writeTrace(trace.finish()).catch((error) => console.error(`trace write failed: ${(error as Error).message}`));
  }
};

const run = async (
  question: string,
  deps: AskDeps,
  options: AskOptions | undefined,
  trace: Trace,
): Promise<Answer> => {
  const startedAt = performance.now();
  const { chunks, timings } = await vectorSearch(question, deps, { topK: options?.topK, filter: options?.filter, trace });

  if (chunks.length === 0) {
    trace.set({ outcome: "no-chunks" });
    return {
      traceId: trace.id,
      question,
      answer: NO_INFO,
      citations: [],
      retrieved: [],
      model: deps.llm.model,
      timings: { ...timings, generateMs: 0, totalMs: performance.now() - startedAt },
    };
  }

  const context = await trace.span("context", (span) => {
    const built = buildContext(chunks, { maxChars: options?.maxContextChars });
    span.set({ included: built.citations.length, dropped: built.dropped, chars: built.chars, budget: built.budget });
    return built;
  });

  const messages: Array<ChatMessage> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt(question, context.text) },
  ];

  const generateStartedAt = performance.now();
  const result = await trace.span("generate", async (span) => {
    const promptChars = messages.reduce((total, message) => total + message.content.length, 0);
    span.set({ model: deps.llm.model, promptChars, messages });
    const reply = await deps.llm.chat(messages);
    const usage = reply.usage ?? {};
    const tokensPerSec = usage.outputTokens && usage.evalMs ? usage.outputTokens / (usage.evalMs / 1000) : undefined;
    span.set({
      model: reply.model,
      ...usage,
      ...(tokensPerSec ? { outputTokensPerSec: tokensPerSec } : {}),
      answerChars: reply.text.length,
    });
    return reply;
  });
  const generateMs = performance.now() - generateStartedAt;

  const referenced = new Set([...result.text.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  const citations = referenced.size > 0 ? context.citations.filter((citation) => referenced.has(citation.n)) : [];
  trace.set({ citations: citations.map((citation) => citation.n), answer: result.text });

  return {
    traceId: trace.id,
    question,
    answer: result.text,
    citations,
    retrieved: chunks,
    model: result.model,
    usage: result.usage,
    context: { chars: context.chars, budget: context.budget, included: context.citations.length, dropped: context.dropped },
    timings: { ...timings, generateMs, totalMs: performance.now() - startedAt },
  };
};
