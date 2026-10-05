import { config } from "../config.ts";
import type { Citation, RetrievedChunk } from "../types.ts";

export interface BuiltContext {
  text: string;
  citations: Array<Citation>;
  dropped: number;
  chars: number;
  budget: number;
}

export interface ContextOptions {
  maxChars?: number;
}

const SNIPPET_MAX_CHARS = 160;

export const buildContext = (chunks: Array<RetrievedChunk>, options?: ContextOptions): BuiltContext => {
  const maxChars = options?.maxChars ?? config.context.maxChars;
  const blocks: Array<string> = [];
  const citations: Array<Citation> = [];
  let usedChars = 0;
  let dropped = 0;

  for (const chunk of chunks) {
    const citationNumber = citations.length + 1;
    const header = `[${citationNumber}] source: ${chunk.metadata.sourcePath}#chunk${chunk.metadata.chunkIndex} | title: ${chunk.metadata.title}`;
    const block = `${header}\n${chunk.text}\n`;
    if (usedChars + block.length > maxChars && citations.length > 0) {
      dropped++;
      continue;
    }
    blocks.push(block);
    usedChars += block.length;
    citations.push({
      n: citationNumber,
      sourcePath: chunk.metadata.sourcePath,
      title: chunk.metadata.title,
      chunkIndex: chunk.metadata.chunkIndex,
      score: chunk.score,
      snippet: snippet(chunk.text),
    });
  }

  const text = blocks.join("\n");
  return { text, citations, dropped, chars: text.length, budget: maxChars };
};

const snippet = (text: string): string => {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length > SNIPPET_MAX_CHARS ? `${singleLine.slice(0, SNIPPET_MAX_CHARS - 1)}…` : singleLine;
};
