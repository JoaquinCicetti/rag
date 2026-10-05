import { describe, expect, test } from "bun:test";
import type { ChatMessage, LLM, LLMResult } from "../src/generation/llm.ts";
import { collectPapers } from "../src/papers/agent.ts";
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
      ids: { pmcid: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123" },
    });
    expect(hit?.doi).toBe("10.48550/arxiv.2005.11401");
    expect(hit?.abstract).toBe("hello world");
    expect(hit?.authors).toEqual(["A", "B"]);
    expect(hit?.pdfUrls).toEqual(["https://arxiv.org/pdf/2005.11401", "https://europepmc.org/articles/PMC123?pdf=render"]);
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
