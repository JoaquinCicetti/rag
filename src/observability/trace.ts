import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";

export type Attrs = Record<string, unknown>;

export type SpanFn<T> = (span: Span) => Promise<T> | T;

export interface ReadTracesOptions {
  limit?: number;
  dir?: string;
}

const DEFAULT_TRACE_LIMIT = 20;
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface SpanRecord {
  name: string;
  depth: number;
  startMs: number;
  durationMs: number;
  attrs: Attrs;
  error?: string;
}

export interface TraceRecord {
  id: string;
  kind: "ask" | "ingest" | "papers";
  input: string;
  startedAt: string;
  durationMs: number;
  attrs: Attrs;
  spans: Array<SpanRecord>;
  error?: string;
}

export class Span {
  readonly record: SpanRecord;

  constructor(
    private readonly trace: Trace,
    name: string,
    depth: number,
    attrs?: Attrs,
  ) {
    this.record = { name, depth, startMs: trace.elapsed(), durationMs: 0, attrs: { ...attrs } };
  }

  set(attrs: Attrs): this {
    Object.assign(this.record.attrs, attrs);
    return this;
  }

  span<T>(name: string, fn: SpanFn<T>, attrs?: Attrs): Promise<T> {
    return this.trace.run(name, this.record.depth + 1, fn, attrs);
  }
}

export class Trace {
  readonly id = crypto.randomUUID();
  readonly startedAt = new Date();
  readonly attrs: Attrs = {};
  private readonly startedAtMs = performance.now();
  private readonly spans: Array<SpanRecord> = [];
  private error?: string;

  constructor(
    readonly kind: TraceRecord["kind"],
    readonly input: string,
  ) {}

  elapsed(): number {
    return performance.now() - this.startedAtMs;
  }

  set(attrs: Attrs): this {
    Object.assign(this.attrs, attrs);
    return this;
  }

  fail(error: unknown): this {
    this.error = errorMessage(error);
    return this;
  }

  span<T>(name: string, fn: SpanFn<T>, attrs?: Attrs): Promise<T> {
    return this.run(name, 0, fn, attrs);
  }

  async run<T>(name: string, depth: number, fn: SpanFn<T>, attrs?: Attrs): Promise<T> {
    const span = new Span(this, name, depth, attrs);
    this.spans.push(span.record);
    try {
      return await fn(span);
    } catch (error) {
      span.record.error = errorMessage(error);
      throw error;
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

export const writeTrace = async (record: TraceRecord, dir = config.traces.dir): Promise<void> => {
  if (!config.traces.enabled) return;
  await mkdir(dir, { recursive: true });
  await appendFile(fileFor(dir, new Date(record.startedAt)), `${JSON.stringify(record)}\n`);
};

export const readTraces = async (options?: ReadTracesOptions): Promise<Array<TraceRecord>> => {
  const dir = options?.dir ?? config.traces.dir;
  const limit = options?.limit ?? DEFAULT_TRACE_LIMIT;
  const files = await readdir(dir).catch((): Array<string> => []);
  const dayFiles = files.filter((file) => file.endsWith(".jsonl")).sort().reverse();
  const traces: Array<TraceRecord> = [];
  for (const dayFile of dayFiles) {
    const content = await readFile(join(dir, dayFile), "utf8");
    const lines = content.split("\n").filter(Boolean).reverse();
    for (const line of lines) {
      traces.push(JSON.parse(line) as TraceRecord);
      if (traces.length >= limit) return traces;
    }
  }
  return traces;
};

export const findTrace = async (idPrefix: string, dir?: string): Promise<TraceRecord | undefined> => {
  const traces = await readTraces({ limit: Number.POSITIVE_INFINITY, dir });
  return traces.find((trace) => trace.id.startsWith(idPrefix));
};

export const inSpan = <T>(
  parent: Trace | Span | undefined,
  name: string,
  fn: SpanFn<T>,
  attrs?: Attrs,
): Promise<T> => (parent ?? new Trace("ask", "")).span(name, fn, attrs);
