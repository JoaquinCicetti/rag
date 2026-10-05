const env = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value === undefined || value === "" ? fallback : value;
};
const envInt = (key: string, fallback: number): number => {
  const parsed = Number.parseInt(env(key, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  qdrant: {
    url: env("QDRANT_URL", "http://127.0.0.1:6333"),
    collection: env("QDRANT_COLLECTION", "documents"),
  },
  ollama: {
    url: env("OLLAMA_URL", "http://127.0.0.1:11434"),
  },
  embeddings: {
    model: env("EMBED_MODEL", "bge-m3"),
    dim: envInt("EMBED_DIM", 1024),
    batchSize: envInt("EMBED_BATCH_SIZE", 16),
  },
  llm: {
    provider: env("LLM_PROVIDER", "ollama") as "ollama" | "anthropic",
    model: env("LLM_MODEL", "llama3.1"),
    anthropicModel: env("ANTHROPIC_MODEL", "claude-sonnet-5"),
    anthropicApiKey: env("ANTHROPIC_API_KEY", ""),
  },
  chunking: {
    size: envInt("CHUNK_SIZE", 1000),
    overlap: envInt("CHUNK_OVERLAP", 200),
  },
  retrieval: {
    topK: envInt("TOP_K", 5),
  },
  context: {
    maxChars: envInt("CONTEXT_MAX_CHARS", 12000),
  },
  api: {
    port: envInt("PORT", 3000),
  },
  papers: {
    dir: env("PAPERS_DIR", "data/papers"),
    contactEmail: env("CONTACT_EMAIL", ""),
    maxSteps: envInt("PAPERS_MAX_STEPS", 12),
  },
  traces: {
    enabled: env("TRACES_ENABLED", "true") !== "false",
    dir: env("TRACE_DIR", "data/traces"),
  },
} as const;

export type Config = typeof config;
