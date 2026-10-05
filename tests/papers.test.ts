import { describe, expect, test } from "bun:test";
import { parseInlineToolCalls, type ChatMessage, type LLM, type LLMResult } from "../src/generation/llm.ts";
import { collectPapers } from "../src/papers/agent.ts";
import { jatsToMarkdown } from "../src/papers/europepmc.ts";
import { isPdf, parseOpenAlexWork, parseUnpaywall, slugify, type PaperHit, type PaperSources } from "../src/papers/sources.ts";

const HIT: PaperHit = {
  doi: "10.48550/arxiv.2005.11401",
  title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
  year: 2020,
  authors: ["Patrick Lewis"],
  abstract: "Large pre-trained language models...",
  pdfUrls: ["https://arxiv.org/pdf/2005.11401"],
};

class ScriptedLLM implements LLM {
  readonly model = "scripted";
  readonly transcripts: Array<Array<ChatMessage>> = [];

  constructor(private readonly replies: Array<LLMResult>) {}

  async chat(messages: Array<ChatMessage>): Promise<LLMResult> {
    this.transcripts.push([...messages]);
    const reply = this.replies.shift();
    if (!reply) throw new Error("no scripted reply left");
    return reply;
  }
}

const fakeSources = (downloadable: boolean): PaperSources => ({
  search: async () => [HIT],
  lookup: async () => undefined,
  download: async (hit) => (downloadable ? { doi: hit.doi, title: hit.title, path: "data/papers/x.pdf", url: hit.pdfUrls[0]! } : undefined),
});

const toolReply = (name: string, args: Record<string, unknown>): LLMResult => ({
  text: "",
  model: "scripted",
  toolCalls: [{ id: `call_${name}`, name, arguments: args }],
});

describe("parseOpenAlexWork", () => {
  test("normalizes doi, rebuilds abstract and collects pdf urls", () => {
    const hit = parseOpenAlexWork({
      doi: "https://doi.org/10.48550/arXiv.2005.11401",
      display_name: "RAG",
      publication_year: 2020,
      authorships: [{ author: { display_name: "A" } }, { author: { display_name: "B" } }],
      abstract_inverted_index: { world: [1], hello: [0] },
      best_oa_location: { pdf_url: "https://arxiv.org/pdf/2005.11401" },
      locations: [{ pdf_url: "https://repo.example.org/rag.pdf" }, { pdf_url: null }],
    });
    expect(hit?.doi).toBe("10.48550/arxiv.2005.11401");
    expect(hit?.abstract).toBe("hello world");
    expect(hit?.authors).toEqual(["A", "B"]);
    expect(hit?.pdfUrls).toEqual(["https://arxiv.org/pdf/2005.11401", "https://repo.example.org/rag.pdf"]);
  });

  test("skips works without doi", () => {
    expect(parseOpenAlexWork({ display_name: "no doi" })).toBeUndefined();
  });
});

describe("source helpers", () => {
  test("parseUnpaywall dedupes pdf urls", () => {
    const urls = parseUnpaywall({
      best_oa_location: { url_for_pdf: "https://a/x.pdf" },
      oa_locations: [{ url_for_pdf: "https://a/x.pdf" }, { url_for_pdf: null }, { url_for_pdf: "https://b/y.pdf" }],
    });
    expect(urls).toEqual(["https://a/x.pdf", "https://b/y.pdf"]);
  });

  test("slugify and isPdf", () => {
    expect(slugify("Ünïcode: RAG & You!")).toBe("unicode-rag-you");
    expect(isPdf(new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(isPdf(new TextEncoder().encode("<html>"))).toBe(false);
  });
});

describe("collectPapers", () => {
  test("searches, downloads and stops at maxPapers", async () => {
    const llm = new ScriptedLLM([
      toolReply("search_papers", { query: "rag" }),
      toolReply("download_paper", { doi: HIT.doi }),
      { text: "summary", model: "scripted" },
    ]);
    const report = await collectPapers("rag", { llm, sources: fakeSources(true) }, { maxPapers: 1 });
    expect(report.downloaded.map((paper) => paper.doi)).toEqual([HIT.doi]);
    expect(report.steps).toBe(2);
    expect(report.summary).toBe("summary");
    expect(llm.transcripts[1]!.at(-1)).toMatchObject({ role: "tool", toolName: "search_papers" });
  });

  test("reports failed downloads back to the model and ends on a text reply", async () => {
    const llm = new ScriptedLLM([
      toolReply("search_papers", { query: "rag" }),
      toolReply("download_paper", { doi: HIT.doi }),
      { text: "nothing downloadable", model: "scripted" },
    ]);
    const report = await collectPapers("rag", { llm, sources: fakeSources(false) }, { maxPapers: 1, maxSteps: 3 });
    expect(report.downloaded).toEqual([]);
    expect(report.summary).toBe("nothing downloadable");
    expect(llm.transcripts.at(-1)!.at(-1)?.content).toStartWith("failed:");
  });

  test("nudges the model when it claims downloads without calling the tool", async () => {
    const llm = new ScriptedLLM([
      toolReply("search_papers", { query: "rag" }),
      { text: "I downloaded everything", model: "scripted" },
      toolReply("download_paper", { doi: HIT.doi }),
      { text: "summary", model: "scripted" },
    ]);
    const report = await collectPapers("rag", { llm, sources: fakeSources(true) }, { maxPapers: 1 });
    expect(llm.transcripts[2]!.at(-1)?.content).toStartWith("You have actually downloaded 0/1");
    expect(report.downloaded).toHaveLength(1);
  });

  test("does not count the same title twice", async () => {
    const preprint: PaperHit = { ...HIT, doi: "10.1101/preprint" };
    const sources: PaperSources = { ...fakeSources(true), search: async () => [HIT, preprint] };
    const llm = new ScriptedLLM([
      toolReply("search_papers", { query: "rag" }),
      toolReply("download_paper", { doi: HIT.doi }),
      toolReply("download_paper", { doi: preprint.doi }),
      { text: "done", model: "scripted" },
    ]);
    const report = await collectPapers("rag", { llm, sources }, { maxPapers: 2, maxSteps: 4 });
    expect(report.downloaded).toHaveLength(1);
  });

  test("respects maxSteps", async () => {
    const llm = new ScriptedLLM([toolReply("search_papers", { query: "a" }), toolReply("search_papers", { query: "b" })]);
    const report = await collectPapers("rag", { llm, sources: fakeSources(true) }, { maxPapers: 3, maxSteps: 2 });
    expect(report.steps).toBe(2);
  });
});

describe("parseInlineToolCalls", () => {
  const tools = [{ name: "download_paper", description: "", parameters: {} }];

  test("extracts tool calls that llama writes as text", () => {
    const text = 'Now I will download it.\n\n{"name": "download_paper", "parameters": {"doi":"10.1021/acs.orglett.9b04060"}}';
    expect(parseInlineToolCalls(text, tools)).toEqual([
      { id: "inline_0", name: "download_paper", arguments: { doi: "10.1021/acs.orglett.9b04060" } },
    ]);
  });

  test("ignores unknown tools and plain prose", () => {
    expect(parseInlineToolCalls('{"name": "rm_rf", "parameters": {}}', tools)).toEqual([]);
    expect(parseInlineToolCalls("I downloaded everything.", tools)).toEqual([]);
  });
});

describe("jatsToMarkdown", () => {
  test("turns JATS full text into markdown and drops references", () => {
    const xml = `<article><front><article-title>Imidazoles &amp; more</article-title><abstract><title>Abstract</title><p>Short <italic>summary</italic>.</p></abstract></front>
      <body><sec><title>1. Introduction</title><p>Text<xref ref-type="bibr">[1]</xref>.</p><fig><title>Figure</title><p>caption</p></fig></sec></body>
      <back><ref-list><p>ref</p></ref-list></back></article>`;
    expect(jatsToMarkdown(xml)).toBe("# Imidazoles & more\n\n## Abstract\n\nShort summary.\n\n## 1. Introduction\n\nText.\n");
  });

  test("returns empty when there is no body", () => {
    expect(jatsToMarkdown("<article><front><article-title>x</article-title></front></article>")).toBe("");
  });
});
