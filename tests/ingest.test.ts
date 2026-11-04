import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { config } from "../src/config.ts";
import type { Embedder } from "../src/embeddings/ollama.ts";
import { ingestPath } from "../src/pipeline/ingest.ts";
import type { VectorStore } from "../src/vectorstore/qdrant.ts";

const FIXTURE = "tests/fixtures/sample.html";
const DIM = 3;
const traces = config.traces as { enabled: boolean };
const tracesEnabled = traces.enabled;

const embedderWith = (embedWithStats: Embedder["embedWithStats"]): Embedder => ({
  model: "fake",
  dim: DIM,
  embed: async () => [],
  embedOne: async () => [],
  embedWithStats,
});

const recordingStore = (calls: Array<string>): VectorStore =>
  ({
    ensureCollection: async () => {},
    deleteBySource: async () => {
      calls.push("delete");
    },
    upsert: async () => {
      calls.push("upsert");
    },
  }) as unknown as VectorStore;

describe("ingestPath", () => {
  beforeAll(() => {
    traces.enabled = false;
  });
  afterAll(() => {
    traces.enabled = tracesEnabled;
  });

  test("keeps the indexed chunks when embedding fails", async () => {
    const calls: Array<string> = [];
    const embedder = embedderWith(async () => {
      throw new Error("ollama down");
    });
    await expect(ingestPath(FIXTURE, { embedder, store: recordingStore(calls) })).rejects.toThrow("ollama down");
    expect(calls).toEqual([]);
  });

  test("replaces old chunks only after the new vectors exist", async () => {
    const calls: Array<string> = [];
    const embedder = embedderWith(async (texts) => {
      calls.push("embed");
      return {
        embeddings: texts.map(() => [1, 0, 0]),
        stats: { batches: 1, inputTokens: 1, loadMs: 0, totalMs: 1 },
      };
    });
    await ingestPath(FIXTURE, { embedder, store: recordingStore(calls) });
    expect(calls).toEqual(["embed", "delete", "upsert"]);
  });
});
