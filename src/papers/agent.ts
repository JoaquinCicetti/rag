import { config } from "../config.ts";
import type { ChatMessage, LLM, ToolArguments, ToolCall, ToolDefinition } from "../generation/llm.ts";
import { Trace, writeTrace, type Span } from "../observability/trace.ts";
import { isRetrievable, type DownloadedPaper, type PaperHit, type PaperSources } from "./sources.ts";

export interface PaperAgentDeps {
  llm: LLM;
  sources: PaperSources;
}

export interface PaperAgentOptions {
  maxPapers: number;
  maxSteps?: number;
  log?: (line: string) => void;
}

export interface PaperAgentReport {
  traceId: string;
  topic: string;
  downloaded: Array<DownloadedPaper>;
  summary: string;
  steps: number;
}

const SEARCH_LIMIT = 10;
const STEPS_PER_PAPER = 3;

const TOOLS: Array<ToolDefinition> = [
  {
    name: "search_papers",
    description: "Search open-access scientific papers. Returns DOI, title, year, authors and abstract for each hit.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Focused search query in English" } },
      required: ["query"],
    },
  },
  {
    name: "download_paper",
    description: "Download the open-access PDF of a paper by its DOI. Only use DOIs returned by search_papers.",
    parameters: {
      type: "object",
      properties: { doi: { type: "string", description: "The DOI, e.g. 10.1234/abcd" } },
      required: ["doi"],
    },
  },
];

const systemPrompt = (maxPapers: number): string =>
  `You are a research assistant that collects open-access scientific papers on a topic.
1. Call search_papers with focused queries. Try different phrasings if results are weak.
2. Pick the most relevant and influential papers from the results.
3. Call download_paper for each chosen DOI until ${maxPapers} papers are downloaded. Only pick hits with "fulltext: yes"; "uncertain" ones usually fail. You may call download_paper several times in one reply.
4. If a download fails, pick another paper.
5. When done, reply with a short list of what you downloaded and why each is relevant. Do not call tools in that reply.`;

const silent = (): void => {};

const nudge = (downloadedCount: number, maxPapers: number): string =>
  `You have actually downloaded ${downloadedCount}/${maxPapers} papers. Nothing is downloaded unless you call download_paper. Call download_paper with DOIs from the search results, or search_papers again.`;

const formatHit = (hit: PaperHit): string =>
  `- doi: ${hit.doi}\n  title: ${hit.title} (${hit.year ?? "n.d."})\n  authors: ${hit.authors.join(", ")}\n  fulltext: ${isRetrievable(hit) ? "yes" : "uncertain"}\n  abstract: ${hit.abstract || "n/a"}`;

const stringArgument = (args: ToolArguments, key: string): string => {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
};

export const collectPapers = async (
  topic: string,
  deps: PaperAgentDeps,
  options: PaperAgentOptions,
): Promise<PaperAgentReport> => {
  const trace = new Trace("papers", topic);
  try {
    return await run(topic, deps, options, trace);
  } catch (error) {
    trace.fail(error);
    throw error;
  } finally {
    await writeTrace(trace.finish()).catch((error) => console.error(`trace write failed: ${(error as Error).message}`));
  }
};

const run = async (
  topic: string,
  deps: PaperAgentDeps,
  options: PaperAgentOptions,
  trace: Trace,
): Promise<PaperAgentReport> => {
  const maxSteps = options.maxSteps ?? Math.max(config.papers.maxSteps, options.maxPapers * STEPS_PER_PAPER);
  const log = options.log ?? silent;
  const seenHits = new Map<string, PaperHit>();
  const seenQueries = new Set<string>();
  const downloaded: Array<DownloadedPaper> = [];
  const messages: Array<ChatMessage> = [
    { role: "system", content: systemPrompt(options.maxPapers) },
    { role: "user", content: `Topic: ${topic}` },
  ];
  trace.set({ model: deps.llm.model, maxPapers: options.maxPapers, maxSteps });

  const searchPapers = async (args: ToolArguments, span: Span): Promise<string> => {
    const query = stringArgument(args, "query");
    if (!query) return "error: query is required";
    const normalizedQuery = query.toLowerCase();
    if (seenQueries.has(normalizedQuery)) return `you already searched "${query}". Download papers from earlier results or try a different query.`;
    seenQueries.add(normalizedQuery);
    log(`  search: ${query}`);
    const hits = await deps.sources.search(query, SEARCH_LIMIT);
    const newHits = hits.filter((hit) => !seenHits.has(hit.doi));
    for (const hit of newHits) seenHits.set(hit.doi, hit);
    span.set({ query, hits: hits.length, newHits: newHits.length });
    return newHits.length > 0 ? newHits.map(formatHit).join("\n") : "no new results; try a different query";
  };

  const downloadPaper = async (args: ToolArguments, span: Span): Promise<string> => {
    const doi = stringArgument(args, "doi").toLowerCase();
    if (!doi) return "error: doi is required";
    if (downloaded.some((paper) => paper.doi === doi)) return `already downloaded ${doi}`;
    const hit = seenHits.get(doi) ?? (await deps.sources.lookup(doi));
    if (!hit) return `error: unknown DOI ${doi}`;
    const sameTitle = downloaded.some((paper) => paper.title.toLowerCase() === hit.title.toLowerCase());
    if (sameTitle) return `already downloaded "${hit.title}" under another DOI; pick a different paper`;
    const paper = await deps.sources.download(hit);
    span.set({ doi, ok: Boolean(paper) });
    if (!paper) return `failed: no open-access PDF available for ${doi}`;
    downloaded.push(paper);
    log(`  downloaded: ${paper.title} -> ${paper.path}`);
    return `downloaded ${paper.path} (${downloaded.length}/${options.maxPapers})`;
  };

  const runTool = (call: ToolCall, span: Span): Promise<string> => {
    switch (call.name) {
      case "search_papers":
        return searchPapers(call.arguments, span);
      case "download_paper":
        return downloadPaper(call.arguments, span);
      default:
        return Promise.resolve(`error: unknown tool ${call.name}`);
    }
  };

  let summary = "";
  let step = 0;
  let nudges = 0;
  while (step < maxSteps && downloaded.length < options.maxPapers) {
    step++;
    const reply = await trace.span("llm", async (span) => {
      const result = await deps.llm.chat(messages, { tools: TOOLS });
      span.set({ step, ...result.usage, toolCalls: result.toolCalls?.map((call) => call.name) ?? [] });
      return result;
    });
    messages.push({ role: "assistant", content: reply.text, toolCalls: reply.toolCalls });
    if (!reply.toolCalls?.length) {
      summary = reply.text;
      if (downloaded.length >= options.maxPapers) break;
      nudges++;
      messages.push({ role: "user", content: nudge(downloaded.length, options.maxPapers) });
      continue;
    }
    for (const call of reply.toolCalls) {
      const output = await trace.span("tool", (span) => runTool(call, span), { tool: call.name, arguments: call.arguments });
      messages.push({ role: "tool", content: output, toolCallId: call.id, toolName: call.name });
    }
  }

  const needsSummary = downloaded.length > 0 && messages.at(-1)?.role === "tool";
  if (needsSummary) {
    messages.push({ role: "user", content: "Target reached. Summarize what you downloaded and why each paper is relevant." });
    const final = await trace.span("llm", async (span) => {
      const result = await deps.llm.chat(messages);
      span.set({ step: "summary", ...result.usage });
      return result;
    });
    summary = final.text;
  }

  trace.set({ steps: step, nudges, downloaded: downloaded.length });
  return { traceId: trace.id, topic, downloaded, summary, steps: step };
};
