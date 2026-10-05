import type { Attrs, SpanRecord, TraceRecord } from "./trace.ts";

const n = (v: unknown): string => (typeof v === "number" ? Math.round(v).toLocaleString("en-US") : "?");
const ms = (v: unknown): string => (typeof v === "number" ? `${n(v)}ms` : "?");
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Rough chars→tokens estimate, only used where the provider gives no real count. */
const approxTokens = (chars: number): number => Math.round(chars / 4);

/** One-line summary of a span's attributes, specialised for the spans we emit. */
const describe = (s: SpanRecord): string[] => {
  const a = s.attrs;
  switch (s.name) {
    case "embed": {
      const tps = num(a.tokensPerSec);
      return [
        `${a.model ?? ""}  ${n(a.inputTokens)} tok` +
          (num(a.batches) !== undefined ? `  ${n(a.batches)} batch(es)` : "") +
          (tps ? `  ${n(tps)} tok/s` : "") +
          (num(a.loadMs) && (a.loadMs as number) > 100 ? `  load ${ms(a.loadMs)} (cold)` : ""),
      ];
    }
    case "search": {
      const hits = (a.hits as Array<{ score: number }> | undefined) ?? [];
      const scores = hits.map((h) => h.score);
      const range = scores.length ? `scores ${Math.max(...scores).toFixed(3)}–${Math.min(...scores).toFixed(3)}` : "no hits";
      return [`${a.store ?? ""}  top-k ${n(a.topK)}, ${n(a.returned)} returned, ${range}`];
    }
    case "context":
      return [
        `${n(a.included)}/${n(num(a.included)! + num(a.dropped)!)} chunks  ${n(a.chars)} chars ≈ ${n(approxTokens(num(a.chars) ?? 0))} tok  (budget ${n(a.budget)})`,
      ];
    case "generate": {
      const lines = [`${a.model ?? ""}`];
      if (num(a.loadMs) !== undefined) lines.push(`load     ${ms(a.loadMs)}${(a.loadMs as number) > 100 ? " (cold)" : ""}`);
      const cached = num(a.cachedInputTokens);
      lines.push(
        `prompt   ${n(a.inputTokens)} tok` +
          (cached !== undefined ? `  (${n(cached)} cached)` : "") +
          (num(a.cacheWriteTokens) ? `  (${n(a.cacheWriteTokens)} written to cache)` : "") +
          (num(a.promptEvalMs) !== undefined ? `  ${ms(a.promptEvalMs)}` : "") +
          `  [${n(a.promptChars)} chars]`,
      );
      const tps = num(a.outputTokensPerSec);
      lines.push(
        `output   ${n(a.outputTokens)} tok` +
          (num(a.evalMs) !== undefined ? `  ${ms(a.evalMs)}` : "") +
          (tps ? `  ${tps.toFixed(1)} tok/s` : ""),
      );
      return lines;
    }
    case "chunk":
      return [`${n(a.chunks)} chunks, avg ${n(a.avgChars)} chars`];
    case "upsert":
      return [`${n(a.points)} points`];
    case "load":
      return [`${n(a.documents)} document(s), ${n(a.chars)} chars`];
    case "document":
      return [`${a.sourcePath ?? ""}  ${n(a.chars)} chars → ${n(a.chunks)} chunks`];
    default:
      return [];
  }
};

/** Render a trace as an indented tree with one block per span. */
export const formatTrace = (t: TraceRecord, opts: { prompt?: boolean } = {}): string => {
  const out: string[] = [];
  const label = t.input.length > 70 ? `${t.input.slice(0, 69)}…` : t.input;
  out.push(`trace ${t.id.slice(0, 8)}  ${t.kind}  "${label}"  ${t.startedAt}`);
  for (const s of t.spans) {
    const indent = "  ".repeat(s.depth);
    const [first = "", ...rest] = describe(s);
    out.push(`${indent}├─ ${s.name.padEnd(14 - indent.length)} ${ms(s.durationMs).padStart(9)}   ${first}`);
    for (const line of rest) out.push(`${indent}│    ${" ".repeat(20 - indent.length)}${line}`);
    if (s.error) out.push(`${indent}│    error: ${s.error}`);
  }
  out.push(`total ${ms(t.durationMs)}${t.error ? `  ERROR: ${t.error}` : ""}`);

  if (opts.prompt) {
    const gen = t.spans.find((s) => s.name === "generate");
    const messages = (gen?.attrs.messages as Array<{ role: string; content: string }> | undefined) ?? [];
    for (const m of messages) out.push("", `===== ${m.role} (${n(m.content.length)} chars) =====`, m.content);
    if (typeof t.attrs.answer === "string") out.push("", "===== answer =====", t.attrs.answer);
  }
  return out.join("\n");
};

/** Token totals of the generate span, used by list views and the ask footer. */
export const usageOf = (t: TraceRecord): Attrs => t.spans.find((s) => s.name === "generate")?.attrs ?? {};

/** One line per trace, newest first. */
export const formatTraceList = (traces: TraceRecord[]): string => {
  if (traces.length === 0) return "no traces yet (run `bun run ask ...` or `bun run ingest ...`)";
  return traces
    .map((t) => {
      const u = usageOf(t);
      const tokens =
        t.kind === "ask"
          ? `in ${n(u.inputTokens)} (cached ${n(u.cachedInputTokens)}) out ${n(u.outputTokens)}`
          : `${n(t.attrs.chunks)} chunks, ${n(t.attrs.embedTokens)} tok embedded`;
      const when = t.startedAt.replace("T", " ").slice(0, 19);
      const label = t.input.length > 48 ? `${t.input.slice(0, 47)}…` : t.input;
      return `${when}  ${t.id.slice(0, 8)}  ${t.kind.padEnd(6)} ${ms(t.durationMs).padStart(9)}  ${tokens.padEnd(36)}  ${label}${t.error ? "  [error]" : ""}`;
    })
    .join("\n");
};
