import type { ChatMessage } from "../generation/llm.ts";
import type { Attrs, SpanRecord, TraceRecord } from "./trace.ts";

export interface FormatOptions {
  prompt?: boolean;
}

interface ScoredHit {
  score: number;
}

const COLD_LOAD_MS = 100;

const count = (value: unknown): string => (typeof value === "number" ? Math.round(value).toLocaleString("en-US") : "?");
const millis = (value: unknown): string => (typeof value === "number" ? `${count(value)}ms` : "?");
const numberOf = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
const approxTokens = (chars: number): number => Math.round(chars / 4);
const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const isColdLoad = (loadMs: unknown): boolean => (numberOf(loadMs) ?? 0) > COLD_LOAD_MS;

const describeEmbed = (attrs: Attrs): Array<string> => {
  const tokensPerSec = numberOf(attrs.tokensPerSec);
  const batches = numberOf(attrs.batches) !== undefined ? `  ${count(attrs.batches)} batch(es)` : "";
  const speed = tokensPerSec ? `  ${count(tokensPerSec)} tok/s` : "";
  const coldLoad = isColdLoad(attrs.loadMs) ? `  load ${millis(attrs.loadMs)} (cold)` : "";
  return [`${attrs.model ?? ""}  ${count(attrs.inputTokens)} tok${batches}${speed}${coldLoad}`];
};

const describeSearch = (attrs: Attrs): Array<string> => {
  const hits = (attrs.hits as Array<ScoredHit> | undefined) ?? [];
  const scores = hits.map((hit) => hit.score);
  const range = scores.length ? `scores ${Math.max(...scores).toFixed(3)}–${Math.min(...scores).toFixed(3)}` : "no hits";
  return [`${attrs.store ?? ""}  top-k ${count(attrs.topK)}, ${count(attrs.returned)} returned, ${range}`];
};

const describeContext = (attrs: Attrs): Array<string> => {
  const considered = numberOf(attrs.included)! + numberOf(attrs.dropped)!;
  const tokens = approxTokens(numberOf(attrs.chars) ?? 0);
  return [`${count(attrs.included)}/${count(considered)} chunks  ${count(attrs.chars)} chars ≈ ${count(tokens)} tok  (budget ${count(attrs.budget)})`];
};

const describeGenerate = (attrs: Attrs): Array<string> => {
  const lines = [`${attrs.model ?? ""}`];
  if (numberOf(attrs.loadMs) !== undefined) lines.push(`load     ${millis(attrs.loadMs)}${isColdLoad(attrs.loadMs) ? " (cold)" : ""}`);
  const cached = numberOf(attrs.cachedInputTokens);
  const cachedLabel = cached !== undefined ? `  (${count(cached)} cached)` : "";
  const writtenLabel = numberOf(attrs.cacheWriteTokens) ? `  (${count(attrs.cacheWriteTokens)} written to cache)` : "";
  const promptTime = numberOf(attrs.promptEvalMs) !== undefined ? `  ${millis(attrs.promptEvalMs)}` : "";
  lines.push(`prompt   ${count(attrs.inputTokens)} tok${cachedLabel}${writtenLabel}${promptTime}  [${count(attrs.promptChars)} chars]`);
  const tokensPerSec = numberOf(attrs.outputTokensPerSec);
  const outputTime = numberOf(attrs.evalMs) !== undefined ? `  ${millis(attrs.evalMs)}` : "";
  const speed = tokensPerSec ? `  ${tokensPerSec.toFixed(1)} tok/s` : "";
  lines.push(`output   ${count(attrs.outputTokens)} tok${outputTime}${speed}`);
  return lines;
};

const describeLlm = (attrs: Attrs): Array<string> => {
  const toolCalls = (attrs.toolCalls as Array<string> | undefined) ?? [];
  const action = toolCalls.length > 0 ? `→ ${toolCalls.join(", ")}` : "→ text";
  const step = typeof attrs.step === "number" ? count(attrs.step) : String(attrs.step ?? "?");
  return [`step ${step}  in ${count(attrs.inputTokens)} out ${count(attrs.outputTokens)} tok  ${action}`];
};

const describeTool = (attrs: Attrs): Array<string> => {
  const outcome = attrs.ok === false ? "  failed" : "";
  return [`${attrs.tool ?? ""} ${JSON.stringify(attrs.arguments ?? {})}${outcome}`];
};

const describe = (span: SpanRecord): Array<string> => {
  const attrs = span.attrs;
  switch (span.name) {
    case "embed":
      return describeEmbed(attrs);
    case "search":
      return describeSearch(attrs);
    case "context":
      return describeContext(attrs);
    case "generate":
      return describeGenerate(attrs);
    case "llm":
      return describeLlm(attrs);
    case "tool":
      return describeTool(attrs);
    case "chunk":
      return [
        `${attrs.strategy ? `${attrs.strategy}  ` : ""}${count(attrs.chunks)} chunks, avg ${count(attrs.avgChars)} chars` +
          (attrs.embedTokens ? `  (${count(attrs.embedTokens)} tok embedded to find boundaries)` : ""),
      ];
    case "upsert":
      return [`${count(attrs.points)} points`];
    case "load":
      return [`${count(attrs.documents)} document(s), ${count(attrs.chars)} chars`];
    case "document":
      return [`${attrs.sourcePath ?? ""}  ${count(attrs.chars)} chars → ${count(attrs.chunks)} chunks`];
    default:
      return [];
  }
};

const formatPrompt = (trace: TraceRecord): Array<string> => {
  const generateSpan = trace.spans.find((span) => span.name === "generate");
  const messages = (generateSpan?.attrs.messages as Array<ChatMessage> | undefined) ?? [];
  const lines = messages.flatMap((message) => ["", `===== ${message.role} (${count(message.content.length)} chars) =====`, message.content]);
  if (typeof trace.attrs.answer === "string") lines.push("", "===== answer =====", trace.attrs.answer);
  return lines;
};

export const formatTrace = (trace: TraceRecord, options?: FormatOptions): string => {
  const lines = [`trace ${trace.id.slice(0, 8)}  ${trace.kind}  "${truncate(trace.input, 70)}"  ${trace.startedAt}`];
  for (const span of trace.spans) {
    const indent = "  ".repeat(span.depth);
    const [firstLine = "", ...moreLines] = describe(span);
    lines.push(`${indent}├─ ${span.name.padEnd(14 - indent.length)} ${millis(span.durationMs).padStart(9)}   ${firstLine}`);
    for (const line of moreLines) lines.push(`${indent}│    ${" ".repeat(20 - indent.length)}${line}`);
    if (span.error) lines.push(`${indent}│    error: ${span.error}`);
  }
  lines.push(`total ${millis(trace.durationMs)}${trace.error ? `  ERROR: ${trace.error}` : ""}`);
  if (options?.prompt) lines.push(...formatPrompt(trace));
  return lines.join("\n");
};

export const usageOf = (trace: TraceRecord): Attrs => trace.spans.find((span) => span.name === "generate")?.attrs ?? {};

const formatListRow = (trace: TraceRecord): string => {
  const usage = usageOf(trace);
  const summaries: Record<TraceRecord["kind"], string> = {
    ask: `in ${count(usage.inputTokens)} (cached ${count(usage.cachedInputTokens)}) out ${count(usage.outputTokens)}`,
    ingest: `${count(trace.attrs.chunks)} chunks, ${count(trace.attrs.embedTokens)} tok embedded`,
    papers: `${count(trace.attrs.downloaded)} paper(s), ${count(trace.attrs.steps)} step(s)`,
  };
  const tokens = summaries[trace.kind];
  const when = trace.startedAt.replace("T", " ").slice(0, 19);
  const failed = trace.error ? "  [error]" : "";
  return `${when}  ${trace.id.slice(0, 8)}  ${trace.kind.padEnd(6)} ${millis(trace.durationMs).padStart(9)}  ${tokens.padEnd(36)}  ${truncate(trace.input, 48)}${failed}`;
};

export const formatTraceList = (traces: Array<TraceRecord>): string => {
  if (traces.length === 0) return "no traces yet (run `bun run ask ...` or `bun run ingest ...`)";
  return traces.map(formatListRow).join("\n");
};
