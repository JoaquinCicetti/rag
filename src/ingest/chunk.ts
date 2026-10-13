import type { Embedder } from "../embeddings/ollama.ts";
import type { Chunk, ChunkStrategy, Document, Span } from "../types.ts";
import { fixedSizeSpans, type FixedChunkOptions } from "./chunkers/fixed.ts";
import { headingSpans } from "./chunkers/heading.ts";
import { paragraphSpans } from "./chunkers/paragraph.ts";
import { semanticSpans } from "./chunkers/semantic.ts";
import { chunkIdFor, sha256 } from "./ids.ts";
import { pageAt, parseSections, sectionFor } from "./structure.ts";

export const CHUNK_STRATEGIES: ReadonlyArray<ChunkStrategy> = ["fixed", "paragraph", "heading", "semantic"];

export const parseStrategy = (value: string): ChunkStrategy => {
  const strategy = CHUNK_STRATEGIES.find((candidate) => candidate === value);
  if (!strategy) throw new Error(`unknown chunk strategy "${value}" (expected ${CHUNK_STRATEGIES.join(", ")})`);
  return strategy;
};

export interface ChunkOptions extends FixedChunkOptions {
  strategy?: ChunkStrategy;
  semanticPercentile?: number;
}

export interface ChunkDeps {
  embedder?: Embedder;
}

export interface ChunkedDocument {
  chunks: Array<Chunk>;
  embedTokens: number;
}

interface StrategyResult {
  spans: Array<Span>;
  embedTokens: number;
}

const spansFor = async (doc: Document, options: ChunkOptions, deps?: ChunkDeps): Promise<StrategyResult> => {
  const strategy = options.strategy ?? "fixed";
  if (strategy === "semantic") {
    if (!deps?.embedder) throw new Error("semantic chunking needs an embedder");
    return semanticSpans(doc.text, { ...options, percentile: options.semanticPercentile }, deps.embedder);
  }
  if (strategy === "paragraph") return { spans: paragraphSpans(doc.text, options), embedTokens: 0 };
  if (strategy === "heading") return { spans: headingSpans(doc.text, options), embedTokens: 0 };
  return { spans: fixedSizeSpans(doc.text, options), embedTokens: 0 };
};

const SECTION_SEPARATOR = " > ";

const withoutTitle = (section: string | undefined, title: string): string | undefined => {
  if (section === undefined || section === title) return undefined;
  return section.startsWith(`${title}${SECTION_SEPARATOR}`) ? section.slice(title.length + SECTION_SEPARATOR.length) : section;
};

export const chunkDocument = async (doc: Document, options: ChunkOptions, deps?: ChunkDeps): Promise<ChunkedDocument> => {
  const strategy = options.strategy ?? "fixed";
  const { spans, embedTokens } = await spansFor(doc, options, deps);
  const sections = parseSections(doc.text);

  const chunks = spans.map((span, chunkIndex): Chunk => {
    const text = doc.text.slice(span.start, span.end);
    const section = withoutTitle(sectionFor(sections, span), doc.title);
    const page = doc.pages ? pageAt(doc.pages, span.start) : undefined;
    const pageEnd = doc.pages ? pageAt(doc.pages, span.end - 1) : undefined;
    return {
      id: chunkIdFor(doc.sourceId, span.start, span.end),
      text,
      metadata: {
        sourceId: doc.sourceId,
        sourcePath: doc.sourcePath,
        title: doc.title,
        chunkIndex,
        start: span.start,
        end: span.end,
        strategy,
        format: doc.format,
        contentHash: sha256(text),
        ...(section ? { section } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(pageEnd !== undefined && pageEnd !== page ? { pageEnd } : {}),
      },
    };
  });
  return { chunks, embedTokens };
};
