/** Ensure the Qdrant collection exists with the configured embedding dim. */
import { config } from "../config.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const store = createVectorStore();
await store.ensureCollection(config.embeddings.dim);
console.log(
  `collection "${config.qdrant.collection}" ready at ${config.qdrant.url} (dim=${config.embeddings.dim}, points=${await store.count()})`,
);
