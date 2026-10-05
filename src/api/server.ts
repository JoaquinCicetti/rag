import { Hono } from "hono";
import { config } from "../config.ts";
import { createEmbedder } from "../embeddings/ollama.ts";
import { createLLM } from "../generation/llm.ts";
import { findTrace, readTraces } from "../observability/trace.ts";
import { ask } from "../pipeline/ask.ts";
import { ingestPath } from "../pipeline/ingest.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

interface AskBody {
  question?: string;
  topK?: number;
}

interface IngestBody {
  path?: string;
}

const DEFAULT_TRACE_LIMIT = 20;
const HEALTH_TIMEOUT_MS = 2000;

const deps = { embedder: createEmbedder(), store: createVectorStore(), llm: createLLM() };

const probe = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok ? "ok" : `http ${response.status}`;
  } catch (error) {
    return `unreachable (${(error as Error).message})`;
  }
};

const emptyBody = (): object => ({});

export const app = new Hono();

app.get("/health", async (context) => {
  const [qdrant, ollama] = await Promise.all([
    probe(`${config.qdrant.url}/readyz`),
    probe(`${config.ollama.url}/api/tags`),
  ]);
  const services = { qdrant, ollama };
  const healthy = Object.values(services).every((status) => status === "ok");
  return context.json(
    {
      status: healthy ? "ok" : "degraded",
      services,
      collection: config.qdrant.collection,
      embedModel: config.embeddings.model,
      llm: { provider: config.llm.provider, model: deps.llm.model },
    },
    healthy ? 200 : 503,
  );
});

app.post("/ask", async (context) => {
  const body = (await context.req.json().catch(emptyBody)) as AskBody;
  if (!body.question?.trim()) return context.json({ error: "question is required" }, 400);
  try {
    const answer = await ask(body.question, deps, { topK: body.topK });
    return context.json(answer);
  } catch (error) {
    return context.json({ error: (error as Error).message }, 500);
  }
});

app.post("/ingest", async (context) => {
  const body = (await context.req.json().catch(emptyBody)) as IngestBody;
  if (!body.path?.trim()) return context.json({ error: "path is required" }, 400);
  try {
    const report = await ingestPath(body.path, deps);
    return context.json(report);
  } catch (error) {
    return context.json({ error: (error as Error).message }, 500);
  }
});

app.get("/traces", async (context) => {
  const requestedLimit = Number(context.req.query("limit") ?? DEFAULT_TRACE_LIMIT);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_TRACE_LIMIT;
  const traces = await readTraces({ limit });
  return context.json(traces);
});

app.get("/traces/:id", async (context) => {
  const trace = await findTrace(context.req.param("id"));
  return trace ? context.json(trace) : context.json({ error: "trace not found" }, 404);
});

app.onError((error, context) => context.json({ error: error.message }, 500));

console.log(`rag api listening on http://localhost:${config.api.port}`);
export default { port: config.api.port, fetch: app.fetch };
