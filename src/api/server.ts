import { Hono } from "hono";
import { config } from "../config.ts";
import { createEmbedder } from "../embeddings/ollama.ts";
import { createLLM } from "../generation/llm.ts";
import { ask } from "../pipeline/ask.ts";
import { ingestPath } from "../pipeline/ingest.ts";
import { createVectorStore } from "../vectorstore/qdrant.ts";

const deps = { embedder: createEmbedder(), store: createVectorStore(), llm: createLLM() };

export const app = new Hono();

app.get("/health", async (c) => {
  const check = async (name: string, url: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return { [name]: res.ok ? "ok" : `http ${res.status}` };
    } catch (e) {
      return { [name]: `unreachable (${(e as Error).message})` };
    }
  };
  const status = {
    ...(await check("qdrant", `${config.qdrant.url}/readyz`)),
    ...(await check("ollama", `${config.ollama.url}/api/tags`)),
  };
  const ok = Object.values(status).every((v) => v === "ok");
  return c.json(
    {
      status: ok ? "ok" : "degraded",
      services: status,
      collection: config.qdrant.collection,
      embedModel: config.embeddings.model,
      llm: { provider: config.llm.provider, model: deps.llm.model },
    },
    ok ? 200 : 503,
  );
});

app.post("/ask", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { question?: string; topK?: number };
  if (!body.question?.trim()) return c.json({ error: "question is required" }, 400);
  try {
    const answer = await ask(body.question, deps, { topK: body.topK });
    return c.json(answer);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.post("/ingest", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { path?: string };
  if (!body.path?.trim()) return c.json({ error: "path is required" }, 400);
  try {
    const report = await ingestPath(body.path, deps);
    return c.json(report);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

app.onError((err, c) => c.json({ error: err.message }, 500));

console.log(`rag api listening on http://localhost:${config.api.port}`);
export default { port: config.api.port, fetch: app.fetch };
