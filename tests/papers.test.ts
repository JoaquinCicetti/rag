import { describe, expect, test } from "bun:test";
import { parseInlineToolCalls, type ChatMessage, type LLM, type LLMResult } from "../src/generation/llm.ts";
import { collectPapers } from "../src/papers/agent.ts";
import { jatsToMarkdown } from "../src/papers/europepmc.ts";
import { fullTextLabel, isPdf, parseOpenAlexWork, parseUnpaywall, slugify, type PaperHit, type PaperSources } from "../src/papers/sources.ts";

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

describe("jatsToMarkdown keeps equations and tables", () => {
  const article = (body: string): string =>
    `<article><front><article-title>Isotherms</article-title></front><body>${body}</body></article>`;

  test("renders MathML formulas with their label", () => {
    const math = `<mml:math><mml:mi>M</mml:mi><mml:mo>=</mml:mo><mml:msup><mml:mrow><mml:mfrac><mml:mi>a</mml:mi><mml:mrow><mml:mi>T</mml:mi><mml:mo>+</mml:mo><mml:mi>C</mml:mi></mml:mrow></mml:mfrac></mml:mrow><mml:mi>B</mml:mi></mml:msup></mml:math>`;
    const xml = article(`<p>Model:<disp-formula><label>(1)</label>${math}</disp-formula>fits.</p>`);
    expect(jatsToMarkdown(xml)).toContain("Model:\n\nM=(a/(T+C))^B (1)\n\nfits.");
  });

  test("keeps display equations that sit between paragraphs", () => {
    const xml = article(`<p>Models [<xref>1</xref>,<xref>2</xref>]:</p><disp-formula><mml:math><mml:mi>M</mml:mi></mml:math></disp-formula><p>where M is moisture.</p>`);
    expect(jatsToMarkdown(xml)).toContain("Models:\n\nM\n\nwhere M is moisture.");
  });

  test("prefers tex-math and unwraps the LaTeX document", () => {
    const tex = String.raw`\documentclass{minimal}\begin{document}$$x &lt; y$$\end{document}`;
    const xml = article(`<p><inline-formula><alternatives><tex-math>${tex}</tex-math><mml:math><mml:mi>z</mml:mi></mml:math></alternatives></inline-formula></p>`);
    expect(jatsToMarkdown(xml)).toContain("x < y");
  });

  test("marks formulas that only exist as images", () => {
    const xml = article(`<p>See <disp-formula><graphic xlink:href="eq1.gif"/></disp-formula></p>`);
    expect(jatsToMarkdown(xml)).toContain("See\n\n[formula image not extracted]");
  });

  test("keeps table rows, caption and footnote, including tables nested in a paragraph", () => {
    const table = `<table-wrap><label>Table 1</label><caption><p>Coefficients</p></caption><table><thead><tr><th>Grain</th><th>A</th></tr></thead><tbody><tr><td>Wheat</td><td>2.3 × 10<sup>-5</sup></td></tr></tbody></table><table-wrap-foot><p>T in °C</p></table-wrap-foot></table-wrap>`;
    const markdown = jatsToMarkdown(article(`<p>Before ${table} after.</p>`));
    expect(markdown).toContain("Before\n\nTable 1 Coefficients\nGrain | A\nWheat | 2.3 × 10^-5\nT in °C\n\nafter.");
  });

  test("marks tables that only exist as images", () => {
    const xml = article(`<table-wrap><label>Table 2</label><graphic xlink:href="t2.gif"/></table-wrap><p>Text.</p>`);
    expect(jatsToMarkdown(xml)).toContain("Table 2\n[table image not extracted]");
  });

  test("keeps exponents readable and subscripts plain", () => {
    expect(jatsToMarkdown(article("<p>CO<sub>2</sub> at 10<sup>-3</sup> g</p>"))).toContain("CO2 at 10^-3 g");
  });
});

describe("fullTextLabel", () => {
  const hit = { doi: "10.1/x", title: "t", authors: [], abstract: "", pdfUrls: [] };

  test("ranks PMC and arXiv above publisher PDFs above nothing", () => {
    expect(fullTextLabel({ ...hit, pmcid: "PMC1" })).toBe("yes");
    expect(fullTextLabel({ ...hit, pdfUrls: ["https://arxiv.org/pdf/1"] })).toBe("yes");
    expect(fullTextLabel({ ...hit, pdfUrls: ["https://journal.example/a.pdf"] })).toBe("pdf");
    expect(fullTextLabel(hit)).toBe("uncertain");
  });
});

describe("collectPapers target", () => {
  test("stops at maxPapers when one reply asks for more downloads", async () => {
    const call = (doi: string) => ({ id: `call_${doi}`, name: "download_paper", arguments: { doi } });
    const llm = new ScriptedLLM([
      { text: "", model: "scripted", toolCalls: [call(HIT.doi), call("10.1/other")] },
      { text: "summary", model: "scripted" },
    ]);
    const sources = { ...fakeSources(true), lookup: async (doi: string) => ({ ...HIT, doi, title: doi }) };
    const report = await collectPapers("rag", { llm, sources }, { maxPapers: 1 });
    expect(report.downloaded.map((paper) => paper.doi)).toEqual([HIT.doi]);
  });
});
