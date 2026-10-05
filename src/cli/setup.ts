import { config } from "../config.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const store = createVectorStore();
await store.ensureCollection(config.embeddings.dim);
const pointCount = await store.count();
console.log(
  `collection "${config.qdrant.collection}" ready at ${config.qdrant.url} (dim=${config.embeddings.dim}, points=${pointCount})`,
);
