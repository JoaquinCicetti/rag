import { config } from "../config.ts";

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
  embedOne(text: string): Promise<number[]>;
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
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
    const out: number[][] = [];
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
    }
    return out;
  }

  async embedOne(text: string): Promise<number[]> {
    const [v] = await this.embed([text]);
    if (!v) throw new Error("empty embedding");
    return v;
  }
}

export const createEmbedder = (): Embedder => new OllamaEmbedder();
