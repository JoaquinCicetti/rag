import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";

export type Attrs = Record<string, unknown>;

export interface SpanRecord {
  name: string;
  /** Nesting level, 0 = direct child of the trace. */
  depth: number;
  /** Milliseconds since the trace started. */
  startMs: number;
  durationMs: number;
  attrs: Attrs;
  error?: string;
}

export interface TraceRecord {
  id: string;
  kind: "ask" | "ingest";
  /** The question for ask, the path for ingest. */
  input: string;
  startedAt: string;
  durationMs: number;
  attrs: Attrs;
  /** Spans in start order; `depth` encodes the tree. */
  spans: SpanRecord[];
  error?: string;
}

export class Span {
  readonly record: SpanRecord;

  constructor(
    private readonly trace: Trace,
    name: string,
    depth: number,
    attrs: Attrs,
  ) {
    this.record = { name, depth, startMs: trace.elapsed(), durationMs: 0, attrs: { ...attrs } };
  }

  set(attrs: Attrs): this {
    Object.assign(this.record.attrs, attrs);
    return this;
  }

  /** Child span, nested one level under this one. */
  span<T>(name: string, fn: (span: Span) => Promise<T> | T, attrs: Attrs = {}): Promise<T> {
    return this.trace.run(name, this.record.depth + 1, fn, attrs);
  }
}

/**
 * A single run of `ask` or `ingest`: a flat list of timed spans with attributes.
 * Passed explicitly through the pipeline (no globals) and written as one JSONL line.
 */
export class Trace {
  readonly id = crypto.randomUUID();
  readonly startedAt = new Date();
  readonly attrs: Attrs = {};
  private readonly t0 = performance.now();
  private readonly spans: SpanRecord[] = [];
  private error?: string;

  constructor(
    readonly kind: TraceRecord["kind"],
    readonly input: string,
  ) {}

  elapsed(): number {
    return performance.now() - this.t0;
  }

  set(attrs: Attrs): this {
    Object.assign(this.attrs, attrs);
    return this;
  }

  fail(err: unknown): this {
    this.error = err instanceof Error ? err.message : String(err);
    return this;
  }

  span<T>(name: string, fn: (span: Span) => Promise<T> | T, attrs: Attrs = {}): Promise<T> {
    return this.run(name, 0, fn, attrs);
  }

  /** @internal used by Span for nesting. */
  async run<T>(name: string, depth: number, fn: (span: Span) => Promise<T> | T, attrs: Attrs): Promise<T> {
    const span = new Span(this, name, depth, attrs);
    this.spans.push(span.record);
    try {
      return await fn(span);
    } catch (e) {
      span.record.error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      span.record.durationMs = this.elapsed() - span.record.startMs;
    }
  }

  finish(): TraceRecord {
    return {
      id: this.id,
      kind: this.kind,
      input: this.input,
      startedAt: this.startedAt.toISOString(),
      durationMs: this.elapsed(),
      attrs: this.attrs,
      spans: this.spans,
      ...(this.error ? { error: this.error } : {}),
    };
  }
}

const fileFor = (dir: string, date: Date): string => join(dir, `${date.toISOString().slice(0, 10)}.jsonl`);

/** Append one trace as a JSONL line to <dir>/YYYY-MM-DD.jsonl. No-op when tracing is disabled. */
export const writeTrace = async (record: TraceRecord, dir = config.traces.dir): Promise<void> => {
  if (!config.traces.enabled) return;
  await mkdir(dir, { recursive: true });
  await appendFile(fileFor(dir, new Date(record.startedAt)), `${JSON.stringify(record)}\n`);
};

/** Most recent traces first. Reads day files newest-first until `limit` is reached. */
export const readTraces = async (opts: { limit?: number; dir?: string } = {}): Promise<TraceRecord[]> => {
  const dir = opts.dir ?? config.traces.dir;
  const limit = opts.limit ?? 20;
  const files = await readdir(dir).catch(() => [] as string[]);
  const out: TraceRecord[] = [];
  for (const f of files.filter((f) => f.endsWith(".jsonl")).sort().reverse()) {
    const lines = (await readFile(join(dir, f), "utf8")).split("\n").filter(Boolean).reverse();
    for (const line of lines) {
      out.push(JSON.parse(line) as TraceRecord);
      if (out.length >= limit) return out;
    }
  }
  return out;
};

/** Find a trace by full id or unique prefix. */
export const findTrace = async (idPrefix: string, dir?: string): Promise<TraceRecord | undefined> => {
  const all = await readTraces({ limit: Number.POSITIVE_INFINITY, dir });
  return all.find((t) => t.id.startsWith(idPrefix));
};

/** Run `fn` inside a span of `parent`, or untraced (throwaway span) when there is no parent. */
export const inSpan = <T>(
  parent: Trace | Span | undefined,
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attrs: Attrs = {},
): Promise<T> => (parent ?? new Trace("ask", "")).span(name, fn, attrs);
