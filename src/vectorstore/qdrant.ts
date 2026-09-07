import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config.ts";
import type { Chunk, ChunkMetadata, RetrievedChunk } from "../types.ts";

export interface VectorStore {
  ensureCollection(dim: number): Promise<void>;
  upsert(chunks: Chunk[], vectors: number[][]): Promise<void>;
  search(vector: number[], topK: number, filter?: SearchFilter): Promise<RetrievedChunk[]>;
  count(): Promise<number>;
  deleteBySource(sourceId: string): Promise<void>;
}

/** Minimal metadata filter; step 3 expands this. */
export interface SearchFilter {
  sourceId?: string;
  sourcePath?: string;
}

type Payload = ChunkMetadata & { text: string };

export class QdrantStore implements VectorStore {
  readonly client: QdrantClient;
  readonly collection: string;

  constructor(opts?: { url?: string; collection?: string }) {
    this.client = new QdrantClient({ url: opts?.url ?? config.qdrant.url });
    this.collection = opts?.collection ?? config.qdrant.collection;
  }

  async ensureCollection(dim: number): Promise<void> {
    const { exists } = await this.client.collectionExists(this.collection);
    if (exists) {
      const info = await this.client.getCollection(this.collection);
      const params = info.config.params.vectors;
      const existingDim = typeof params === "object" && params && "size" in params ? params.size : undefined;
      if (existingDim !== undefined && existingDim !== dim) {
        throw new Error(
          `collection "${this.collection}" has dim ${existingDim}, expected ${dim}. ` +
            `Run "bun run infra:reset" or change QDRANT_COLLECTION.`,
        );
      }
      return;
    }
    await this.client.createCollection(this.collection, {
      vectors: { size: dim, distance: "Cosine" },
    });
    // Payload indexes make metadata filters cheap (used from step 3).
    await this.client.createPayloadIndex(this.collection, {
      field_name: "sourceId",
      field_schema: "keyword",
    });
    await this.client.createPayloadIndex(this.collection, {
      field_name: "sourcePath",
      field_schema: "keyword",
    });
  }

  async upsert(chunks: Chunk[], vectors: number[][]): Promise<void> {
    if (chunks.length !== vectors.length) throw new Error("chunks/vectors length mismatch");
    if (chunks.length === 0) return;
    const points = chunks.map((c, i) => ({
      id: c.id,
      vector: vectors[i] as number[],
      payload: { ...c.metadata, text: c.text } satisfies Payload,
    }));
    const batch = 64;
    for (let i = 0; i < points.length; i += batch) {
      await this.client.upsert(this.collection, { wait: true, points: points.slice(i, i + batch) });
    }
  }

  async search(vector: number[], topK: number, filter?: SearchFilter): Promise<RetrievedChunk[]> {
    const must: Array<{ key: string; match: { value: string } }> = [];
    if (filter?.sourceId) must.push({ key: "sourceId", match: { value: filter.sourceId } });
    if (filter?.sourcePath) must.push({ key: "sourcePath", match: { value: filter.sourcePath } });

    const res = await this.client.query(this.collection, {
      query: vector,
      limit: topK,
      with_payload: true,
      ...(must.length > 0 ? { filter: { must } } : {}),
    });

    return res.points.map((p) => {
      const { text, ...metadata } = p.payload as unknown as Payload;
      return { id: String(p.id), text, metadata, score: p.score };
    });
  }

  async count(): Promise<number> {
    const res = await this.client.count(this.collection, { exact: true });
    return res.count;
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.client.delete(this.collection, {
      wait: true,
      filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
    });
  }
}

export const createVectorStore = (): VectorStore => new QdrantStore();
