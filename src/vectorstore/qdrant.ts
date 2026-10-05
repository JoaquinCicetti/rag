import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config.ts";
import type { Chunk, ChunkMetadata, RetrievedChunk } from "../types.ts";

export interface VectorStore {
  ensureCollection(dim: number): Promise<void>;
  upsert(chunks: Array<Chunk>, vectors: Array<Array<number>>): Promise<void>;
  search(vector: Array<number>, topK: number, filter?: SearchFilter): Promise<Array<RetrievedChunk>>;
  count(): Promise<number>;
  deleteBySource(sourceId: string): Promise<void>;
}

export interface SearchFilter {
  sourceId?: string;
  sourcePath?: string;
}

interface Payload extends ChunkMetadata {
  text: string;
}

interface StoreConnection {
  url?: string;
  collection?: string;
}

interface MatchValue {
  value: string;
}

interface FieldCondition {
  key: string;
  match: MatchValue;
}

export class QdrantStore implements VectorStore {
  readonly client: QdrantClient;
  readonly collection: string;

  constructor(connection?: StoreConnection) {
    this.client = new QdrantClient({ url: connection?.url ?? config.qdrant.url });
    this.collection = connection?.collection ?? config.qdrant.collection;
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
    await this.client.createPayloadIndex(this.collection, {
      field_name: "sourceId",
      field_schema: "keyword",
    });
    await this.client.createPayloadIndex(this.collection, {
      field_name: "sourcePath",
      field_schema: "keyword",
    });
  }

  async upsert(chunks: Array<Chunk>, vectors: Array<Array<number>>): Promise<void> {
    if (chunks.length !== vectors.length) throw new Error("chunks/vectors length mismatch");
    if (chunks.length === 0) return;
    const points = chunks.map((chunk, index) => ({
      id: chunk.id,
      vector: vectors[index] as Array<number>,
      payload: { ...chunk.metadata, text: chunk.text } satisfies Payload,
    }));
    const batchSize = 64;
    for (let offset = 0; offset < points.length; offset += batchSize) {
      await this.client.upsert(this.collection, { wait: true, points: points.slice(offset, offset + batchSize) });
    }
  }

  async search(vector: Array<number>, topK: number, filter?: SearchFilter): Promise<Array<RetrievedChunk>> {
    const must: Array<FieldCondition> = [];
    if (filter?.sourceId) must.push({ key: "sourceId", match: { value: filter.sourceId } });
    if (filter?.sourcePath) must.push({ key: "sourcePath", match: { value: filter.sourcePath } });

    const response = await this.client.query(this.collection, {
      query: vector,
      limit: topK,
      with_payload: true,
      ...(must.length > 0 ? { filter: { must } } : {}),
    });

    return response.points.map((point) => {
      const { text, ...metadata } = point.payload as unknown as Payload;
      return { id: String(point.id), text, metadata, score: point.score };
    });
  }

  async count(): Promise<number> {
    const response = await this.client.count(this.collection, { exact: true });
    return response.count;
  }

  async deleteBySource(sourceId: string): Promise<void> {
    await this.client.delete(this.collection, {
      wait: true,
      filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
    });
  }
}

export const createVectorStore = (): VectorStore => new QdrantStore();
