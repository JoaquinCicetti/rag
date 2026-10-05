import { config } from "../config.ts";

export interface EmbedStats {
  batches: number;
  inputTokens: number;
  loadMs: number;
  totalMs: number;
}

export interface EmbedResult {
  embeddings: Array<Array<number>>;
  stats: EmbedStats;
}

export interface EmbedderConnection {
  url?: string;
  model?: string;
  dim?: number;
  batchSize?: number;
}

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(texts: Array<string>): Promise<Array<Array<number>>>;
  embedOne(text: string): Promise<Array<number>>;
  embedWithStats(texts: Array<string>): Promise<EmbedResult>;
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: Array<Array<number>>;
  prompt_eval_count?: number;
  load_duration?: number;
}

export class OllamaEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;
  private readonly url: string;
  private readonly batchSize: number;

  constructor(connection?: EmbedderConnection) {
    this.url = connection?.url ?? config.ollama.url;
    this.model = connection?.model ?? config.embeddings.model;
    this.dim = connection?.dim ?? config.embeddings.dim;
    this.batchSize = connection?.batchSize ?? config.embeddings.batchSize;
  }

  async embed(texts: Array<string>): Promise<Array<Array<number>>> {
    return (await this.embedWithStats(texts)).embeddings;
  }

  async embedWithStats(texts: Array<string>): Promise<EmbedResult> {
    const startedAt = performance.now();
    const embeddings: Array<Array<number>> = [];
    const stats: EmbedStats = { batches: 0, inputTokens: 0, loadMs: 0, totalMs: 0 };
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const response = await fetch(`${this.url}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, input: batch }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ollama embed failed (${response.status}): ${body}`);
      }
      const data = (await response.json()) as OllamaEmbedResponse;
      if (data.embeddings.length !== batch.length) {
        throw new Error(`ollama returned ${data.embeddings.length} embeddings for ${batch.length} inputs`);
      }
      const first = data.embeddings[0];
      if (first && first.length !== this.dim) {
        throw new Error(
          `embedding dim mismatch: model ${this.model} returned ${first.length}, EMBED_DIM=${this.dim}`,
        );
      }
      embeddings.push(...data.embeddings);
      stats.batches++;
      stats.inputTokens += data.prompt_eval_count ?? 0;
      stats.loadMs += (data.load_duration ?? 0) / 1e6;
    }
    stats.totalMs = performance.now() - startedAt;
    return { embeddings, stats };
  }

  async embedOne(text: string): Promise<Array<number>> {
    const [embedding] = await this.embed([text]);
    if (!embedding) throw new Error("empty embedding");
    return embedding;
  }
}

export const createEmbedder = (): Embedder => new OllamaEmbedder();
