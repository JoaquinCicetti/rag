import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContext } from "../src/generation/context.ts";
import { mapOllamaUsage } from "../src/generation/llm.ts";
import { formatTrace } from "../src/observability/format.ts";
import { Trace, findTrace, inSpan, readTraces, writeTrace } from "../src/observability/trace.ts";
import type { RetrievedChunk } from "../src/types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Trace", () => {
  test("records spans in start order with depth and attributes", async () => {
    const t = new Trace("ingest", "data/samples");
    await t.span("document", async (doc) => {
      await doc.span("embed", async (s) => {
        await sleep(5);
        s.set({ inputTokens: 10 });
      });
      doc.set({ chunks: 2 });
    });
    const r = t.finish();
    expect(r.spans.map((s) => [s.name, s.depth])).toEqual([
      ["document", 0],
      ["embed", 1],
    ]);
    const [doc, embed] = r.spans;
    expect(embed?.attrs).toEqual({ inputTokens: 10 });
    expect(doc?.attrs).toEqual({ chunks: 2 });
    expect(embed!.durationMs).toBeGreaterThanOrEqual(4);
    expect(doc!.durationMs).toBeGreaterThanOrEqual(embed!.durationMs);
    expect(r.durationMs).toBeGreaterThanOrEqual(doc!.durationMs);
  });

  test("a throwing span records the error and rethrows", async () => {
    const t = new Trace("ask", "q");
    await expect(
      t.span("generate", () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    t.fail(new Error("boom"));
    const r = t.finish();
    expect(r.spans[0]?.error).toBe("boom");
    expect(r.error).toBe("boom");
  });

  test("inSpan without a parent still runs the function", async () => {
    expect(await inSpan(undefined, "x", () => 42)).toBe(42);
  });

  test("write/read round-trip, newest first, prefix lookup", async () => {
    const dir = await mkdtemp(join(tmpdir(), "traces-"));
    try {
      const a = new Trace("ask", "first").finish();
      const b = new Trace("ask", "second").finish();
      await writeTrace(a, dir);
      await writeTrace(b, dir);
      const all = await readTraces({ dir });
      expect(all.map((t) => t.input)).toEqual(["second", "first"]);
      expect((await findTrace(a.id.slice(0, 8), dir))?.input).toBe("first");
      expect(await findTrace("nope", dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("formatTrace shows cached tokens and the prompt on request", async () => {
    const t = new Trace("ask", "q");
    await t.span("generate", (s) =>
      s.set({
        model: "llama3.1",
        inputTokens: 1517,
        cachedInputTokens: 1516,
        outputTokens: 5,
        promptChars: 3000,
        messages: [{ role: "user", content: "hello prompt" }],
      }),
    );
    const r = t.finish();
    expect(formatTrace(r)).toContain("1,517 tok  (1,516 cached)");
    expect(formatTrace(r)).not.toContain("hello prompt");
    expect(formatTrace(r, { prompt: true })).toContain("hello prompt");
  });
});

describe("mapOllamaUsage", () => {
  test("maps counts and converts ns to ms", () => {
    const u = mapOllamaUsage({
      prompt_eval_count: 1517,
      prompt_eval_cached_count: 1516,
      eval_count: 5,
      load_duration: 1113083,
      prompt_eval_duration: 19728000,
      eval_duration: 69233000,
    });
    expect(u).toEqual({
      inputTokens: 1517,
      cachedInputTokens: 1516,
      outputTokens: 5,
      loadMs: 1.113083,
      promptEvalMs: 19.728,
      evalMs: 69.233,
    });
  });
});

describe("buildContext stats", () => {
  const chunk = (i: number, text: string): RetrievedChunk => ({
    id: String(i),
    text,
    score: 1 - i / 10,
    metadata: { sourceId: "s", sourcePath: "a.md", title: "A", chunkIndex: i, start: 0, end: text.length },
  });

  test("reports chars, budget and dropped", () => {
    const ctx = buildContext([chunk(0, "x".repeat(100)), chunk(1, "y".repeat(100))], { maxChars: 150 });
    expect(ctx.budget).toBe(150);
    expect(ctx.citations.length).toBe(1);
    expect(ctx.dropped).toBe(1);
    expect(ctx.chars).toBe(ctx.text.length);
  });
});
