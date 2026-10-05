import { config } from "../config.ts";

export interface EmbedStats {
  batches: number;
  /** Tokens processed by the embedding model, as reported by Ollama. */
  inputTokens: number;
  /** Time spent loading the model into memory (cold start), summed over batches. */
  loadMs: number;
  /** Wall time of all requests. */
  totalMs: number;
}

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
  embedWithStats(texts: string[]): Promise<{ embeddings: number[][]; stats: EmbedStats }>;
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
  prompt_eval_count?: number;
  /** Nanoseconds. */
  load_duration?: number;
}

/**
 * Embeddings via Ollama's /api/embed (batched). No SDK, plain fetch,
 * so every request is visible and easy to trace later (step 8).
 */
export class OllamaEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;
  private readonly url: string;
  private readonly batchSize: number;

  constructor(opts?: { url?: string; model?: string; dim?: number; batchSize?: number }) {
    this.url = opts?.url ?? config.ollama.url;
    this.model = opts?.model ?? config.embeddings.model;
    this.dim = opts?.dim ?? config.embeddings.dim;
    this.batchSize = opts?.batchSize ?? config.embeddings.batchSize;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return (await this.embedWithStats(texts)).embeddings;
  }

  async embedWithStats(texts: string[]): Promise<{ embeddings: number[][]; stats: EmbedStats }> {
    const t0 = performance.now();
    const out: number[][] = [];
    const stats: EmbedStats = { batches: 0, inputTokens: 0, loadMs: 0, totalMs: 0 };
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const res = await fetch(`${this.url}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (!res.ok) {
        throw new Error(`ollama embed failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as OllamaEmbedResponse;
      if (data.embeddings.length !== batch.length) {
        throw new Error(`ollama returned ${data.embeddings.length} embeddings for ${batch.length} inputs`);
      }
      const first = data.embeddings[0];
      if (first && first.length !== this.dim) {
        throw new Error(
          `embedding dim mismatch: model ${this.model} returned ${first.length}, EMBED_DIM=${this.dim}`,
        );
      }
      out.push(...data.embeddings);
      stats.batches++;
      stats.inputTokens += data.prompt_eval_count ?? 0;
      stats.loadMs += (data.load_duration ?? 0) / 1e6;
    }
    stats.totalMs = performance.now() - t0;
    return { embeddings: out, stats };
  }

  async embedOne(text: string): Promise<number[]> {
    const [v] = await this.embed([text]);
    if (!v) throw new Error("empty embedding");
    return v;
  }
}

export const createEmbedder = (): Embedder => new OllamaEmbedder();
