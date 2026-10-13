import { describe, expect, test } from "bun:test";
import type { Embedder } from "../src/embeddings/ollama.ts";
import { chunkDocument, parseStrategy } from "../src/ingest/chunk.ts";
import { fixedSizeSpans } from "../src/ingest/chunkers/fixed.ts";
import { headingSpans } from "../src/ingest/chunkers/heading.ts";
import { paragraphSpans } from "../src/ingest/chunkers/paragraph.ts";
import { semanticSpans, sentenceSpans } from "../src/ingest/chunkers/semantic.ts";
import type { ChunkStrategy, Document, Span } from "../src/types.ts";

const doc = (text: string, extra?: Partial<Document>): Document => ({
  sourceId: "src",
  sourcePath: "a.md",
  title: "A",
  text,
  format: "md",
  contentHash: "hash",
  ...extra,
});

const textOf = (text: string, spans: Array<Span>): Array<string> => spans.map((span) => text.slice(span.start, span.end));

const topicEmbedder = (topics: Array<string>): Embedder => {
  const vectorFor = (text: string): Array<number> => topics.map((topic) => text.split(topic).length - 1);
  const embedWithStats: Embedder["embedWithStats"] = async (texts) => ({
    embeddings: texts.map(vectorFor),
    stats: { batches: 1, inputTokens: texts.length, loadMs: 0, totalMs: 0 },
  });
  return {
    model: "fake",
    dim: topics.length,
    embedWithStats,
    embed: async (texts) => (await embedWithStats(texts)).embeddings,
    embedOne: async (text) => vectorFor(text),
  };
};

const MARKDOWN = [
  "# Guía",
  "## Chunking",
  "El chunking divide un documento en partes. Cada parte se indexa por separado.",
  "Un chunk demasiado grande mezcla temas. Uno demasiado chico pierde contexto.",
  "## Retrieval",
  "El retrieval busca los chunks más parecidos a la pregunta. Usa similitud coseno.",
  "### Top-k",
  "Top-k controla cuántos chunks se devuelven al modelo.",
].join("\n\n");

describe("fixedSizeSpans", () => {
  test("empty text yields no spans", () => {
    expect(fixedSizeSpans("", { size: 100, overlap: 10 })).toEqual([]);
  });

  test("short text yields a single span covering it", () => {
    expect(fixedSizeSpans("hello world", { size: 100, overlap: 10 })).toEqual([{ start: 0, end: 11 }]);
  });

  test("spans never exceed size and consecutive spans overlap", () => {
    const text = Array.from({ length: 80 }, (_, i) => `Oración número ${i} termina acá.`).join(" ");
    const spans = fixedSizeSpans(text, { size: 200, overlap: 50 });
    expect(spans.length).toBeGreaterThan(1);
    for (const s of spans) expect(s.end - s.start).toBeLessThanOrEqual(200);
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1]!;
      const cur = spans[i]!;
      expect(cur.start).toBeLessThan(prev.end);
      expect(cur.start).toBeGreaterThan(prev.start);
    }
    expect(spans.at(-1)!.end).toBe(text.length);
  });

  test("prefers paragraph boundaries", () => {
    const p1 = "a".repeat(120);
    const p2 = "b".repeat(120);
    const text = `${p1}\n\n${p2}`;
    const spans = fixedSizeSpans(text, { size: 200, overlap: 0 });
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe(p1);
  });

  test("rejects invalid options", () => {
    expect(() => fixedSizeSpans("x", { size: 0, overlap: 0 })).toThrow();
    expect(() => fixedSizeSpans("x", { size: 10, overlap: 10 })).toThrow();
  });
});

describe("paragraphSpans", () => {
  const paragraphs = ["a".repeat(40), "b".repeat(40), "c".repeat(40), "d".repeat(40)];
  const text = paragraphs.join("\n\n");

  test("packs whole paragraphs up to size", () => {
    const chunks = textOf(text, paragraphSpans(text, { size: 90, overlap: 0 }));
    expect(chunks).toEqual([`${paragraphs[0]}\n\n${paragraphs[1]}`, `${paragraphs[2]}\n\n${paragraphs[3]}`]);
  });

  test("overlap carries trailing paragraphs into the next chunk", () => {
    const chunks = textOf(text, paragraphSpans(text, { size: 90, overlap: 45 }));
    expect(chunks).toEqual([
      `${paragraphs[0]}\n\n${paragraphs[1]}`,
      `${paragraphs[1]}\n\n${paragraphs[2]}`,
      `${paragraphs[2]}\n\n${paragraphs[3]}`,
    ]);
  });

  test("a paragraph larger than size falls back to fixed-size cuts", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Oración ${i} del párrafo largo.`).join(" ");
    const mixed = `corto\n\n${long}\n\nfinal`;
    const spans = paragraphSpans(mixed, { size: 120, overlap: 0 });
    expect(spans.length).toBeGreaterThan(3);
    for (const span of spans) expect(span.end - span.start).toBeLessThanOrEqual(120);
    expect(textOf(mixed, spans)[0]).toBe("corto");
    expect(textOf(mixed, spans).at(-1)).toBe("final");
  });

  test("a heading is never left at the end of a chunk", () => {
    const body = "x".repeat(60);
    const withHeadings = [body, "## Métodos", body, "## Resultados", "y".repeat(200)].join("\n\n");
    const chunks = textOf(withHeadings, paragraphSpans(withHeadings, { size: 100, overlap: 0 }));
    expect(chunks[0]).toBe(body);
    expect(chunks[1]).toBe(`## Métodos\n\n${body}`);
    expect(chunks[2]).toStartWith("## Resultados\n\nyyy");
    for (const chunk of chunks) expect(chunk).not.toMatch(/^#+ [^\n]*$/);
  });
});

describe("headingSpans", () => {
  test("one chunk per section, heading-only sections merge into the next", () => {
    const chunks = textOf(MARKDOWN, headingSpans(MARKDOWN, { size: 400, overlap: 0 }));
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toStartWith("# Guía\n\n## Chunking");
    expect(chunks[1]).toStartWith("## Retrieval");
    expect(chunks[2]).toStartWith("### Top-k");
  });

  test("oversized sections are split by paragraph", () => {
    const chunks = textOf(MARKDOWN, headingSpans(MARKDOWN, { size: 110, overlap: 0 }));
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(110);
    expect(chunks.some((chunk) => chunk.includes("## Retrieval") && chunk.includes("Chunking"))).toBe(false);
  });

  test("a trailing heading without body is not a chunk", () => {
    const text = "# A\n\ncuerpo\n\n## Referencias";
    expect(textOf(text, headingSpans(text, { size: 100, overlap: 0 }))).toEqual(["# A\n\ncuerpo"]);
  });

  test("text without headings falls back to paragraphs", () => {
    const text = "uno\n\ndos";
    expect(headingSpans(text, { size: 100, overlap: 0 })).toEqual(paragraphSpans(text, { size: 100, overlap: 0 }));
  });
});

describe("semanticSpans", () => {
  const gatos = Array.from({ length: 6 }, (_, i) => `Los gatos duermen muchas horas cada día, dato ${i}.`);
  const trenes = Array.from({ length: 6 }, (_, i) => `Los trenes circulan sobre vías de acero, dato ${i}.`);
  const text = [...gatos, ...trenes].join(" ");

  test("sentenceSpans splits on sentence ends", () => {
    expect(textOf(text, sentenceSpans(text))).toEqual([...gatos, ...trenes]);
  });

  test("breaks where the topic changes", async () => {
    const result = await semanticSpans(text, { size: 800, overlap: 0, percentile: 90 }, topicEmbedder(["gatos", "trenes"]));
    expect(textOf(text, result.spans)).toEqual([gatos.join(" "), trenes.join(" ")]);
    expect(result.embedTokens).toBe(12);
  });

  test("groups larger than size are split again", async () => {
    const result = await semanticSpans(text, { size: 200, overlap: 0 }, topicEmbedder(["gatos", "trenes"]));
    for (const span of result.spans) expect(span.end - span.start).toBeLessThanOrEqual(200);
    const chunks = textOf(text, result.spans);
    expect(chunks.some((chunk) => chunk.includes("gatos") && chunk.includes("trenes"))).toBe(false);
    expect(chunks.join(" ")).toBe(text);
  });
});

describe("chunkDocument", () => {
  const embedder = topicEmbedder(["chunk", "retrieval"]);
  const strategies: Array<ChunkStrategy> = ["fixed", "paragraph", "heading", "semantic"];

  for (const strategy of strategies) {
    test(`${strategy}: text matches offsets, ids are stable, nothing is lost`, async () => {
      const options = { strategy, size: 160, overlap: 0 };
      const first = await chunkDocument(doc(MARKDOWN), options, { embedder });
      const second = await chunkDocument(doc(MARKDOWN), options, { embedder });
      expect(first.chunks.length).toBeGreaterThan(1);
      expect(first.chunks.map((chunk) => chunk.id)).toEqual(second.chunks.map((chunk) => chunk.id));
      expect(new Set(first.chunks.map((chunk) => chunk.id)).size).toBe(first.chunks.length);
      for (const chunk of first.chunks) {
        expect(MARKDOWN.slice(chunk.metadata.start, chunk.metadata.end)).toBe(chunk.text);
        expect(chunk.text.length).toBeLessThanOrEqual(160);
        expect(chunk.metadata.strategy).toBe(strategy);
        expect(chunk.metadata.format).toBe("md");
      }
      expect(first.chunks.map((chunk) => chunk.metadata.chunkIndex)).toEqual(first.chunks.map((_, index) => index));
      const squash = (value: string): string => value.replace(/\s+/g, "");
      expect(squash(first.chunks.map((chunk) => chunk.text).join(""))).toBe(squash(MARKDOWN));
    });
  }

  test("defaults to fixed and keeps ids tied to the source span", async () => {
    const text = "Primer párrafo del documento.\n\nSegundo párrafo con más texto.\n\nTercero.";
    const { chunks } = await chunkDocument(doc(text), { size: 40, overlap: 5 });
    expect(chunks[0]!.metadata.strategy).toBe("fixed");
    const other = await chunkDocument(doc(text, { sourceId: "other" }), { size: 40, overlap: 5 });
    expect(other.chunks[0]!.id).not.toBe(chunks[0]!.id);
  });

  test("records the section each chunk belongs to", async () => {
    const { chunks } = await chunkDocument(doc(MARKDOWN), { strategy: "heading", size: 400, overlap: 0 });
    expect(chunks.map((chunk) => chunk.metadata.section)).toEqual([
      "Guía > Chunking",
      "Guía > Retrieval",
      "Guía > Retrieval > Top-k",
    ]);
    const titled = await chunkDocument(doc(MARKDOWN, { title: "Guía" }), { strategy: "heading", size: 400, overlap: 0 });
    expect(titled.chunks.map((chunk) => chunk.metadata.section)).toEqual(["Chunking", "Retrieval", "Retrieval > Top-k"]);
  });

  test("records pages when the document has them", async () => {
    const text = "Texto de la primera página.\n\nTexto de la segunda página.";
    const pages = [
      { page: 1, start: 0, end: 27 },
      { page: 2, start: 29, end: text.length },
    ];
    const split = await chunkDocument(doc(text, { pages, format: "pdf" }), { strategy: "paragraph", size: 30, overlap: 0 });
    expect(split.chunks.map((chunk) => chunk.metadata.page)).toEqual([1, 2]);
    const whole = await chunkDocument(doc(text, { pages, format: "pdf" }), { strategy: "paragraph", size: 100, overlap: 0 });
    expect(whole.chunks[0]!.metadata).toMatchObject({ page: 1, pageEnd: 2 });
  });

  test("semantic needs an embedder", () => {
    expect(chunkDocument(doc(MARKDOWN), { strategy: "semantic", size: 100, overlap: 0 })).rejects.toThrow("embedder");
  });

  test("parseStrategy rejects unknown names", () => {
    expect(parseStrategy("heading")).toBe("heading");
    expect(() => parseStrategy("magic")).toThrow();
  });
});
