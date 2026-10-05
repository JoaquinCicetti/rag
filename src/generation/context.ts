import { config } from "../config.ts";
import type { Citation, RetrievedChunk } from "../types.ts";

export interface BuiltContext {
  /** The text block handed to the LLM. */
  text: string;
  /** Chunks that made it into the context, in order, 1-based `n` matches the [n] markers. */
  citations: Citation[];
  /** Chunks dropped because of the character budget. */
  dropped: number;
  /** Length of `text`. */
  chars: number;
  /** Character budget that was applied. */
  budget: number;
}

/**
 * Step 1 context builder: keep retrieval order (highest score first),
 * number each chunk [n], attach its source, and stop at a character budget.
 * Step 5 turns this into a dedicated, smarter Context Builder.
 */
export const buildContext = (
  chunks: RetrievedChunk[],
  opts: { maxChars?: number } = {},
): BuiltContext => {
  const maxChars = opts.maxChars ?? config.context.maxChars;
  const parts: string[] = [];
  const citations: Citation[] = [];
  let used = 0;
  let dropped = 0;

  for (const chunk of chunks) {
    const n = citations.length + 1;
    const header = `[${n}] source: ${chunk.metadata.sourcePath}#chunk${chunk.metadata.chunkIndex} | title: ${chunk.metadata.title}`;
    const block = `${header}\n${chunk.text}\n`;
    if (used + block.length > maxChars && citations.length > 0) {
      dropped++;
      continue;
    }
    parts.push(block);
    used += block.length;
    citations.push({
      n,
      sourcePath: chunk.metadata.sourcePath,
      title: chunk.metadata.title,
      chunkIndex: chunk.metadata.chunkIndex,
      score: chunk.score,
      snippet: snippet(chunk.text),
    });
  }

  const text = parts.join("\n");
  return { text, citations, dropped, chars: text.length, budget: maxChars };
};

const snippet = (s: string, max = 160): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};
