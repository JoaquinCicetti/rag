# Architecture

Current state: step 1 (MVP). This document is updated as each roadmap step lands.

## Pipeline

```
INGEST   file/dir ──► loaders ──► chunk (fixed size + overlap) ──► embed (Ollama bge-m3) ──► Qdrant upsert
                                          │ stable ids: uuid(sha256(sourceId:chunkIndex))
ASK      question ──► embed ──► Qdrant search (cosine, top-k) ──► context builder ([n] + source) ──► LLM (Ollama qwen3.5:35b) ──► answer + citations
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/config.ts` | env parsing with defaults |
| `src/types.ts` | `Document`, `Chunk`, `RetrievedChunk`, `Citation`, `Answer` |
| `src/ingest/loaders.ts` | file discovery + loading (`.md`, `.txt`), title extraction |
| `src/ingest/chunk.ts` | fixed-size chunking with overlap and boundary preference |
| `src/ingest/ids.ts` | deterministic source and chunk ids |
| `src/embeddings/ollama.ts` | `Embedder` interface + Ollama implementation |
| `src/vectorstore/qdrant.ts` | `VectorStore` interface + Qdrant implementation |
| `src/retrieval/search.ts` | vector search (hybrid + re-rank land here in step 3) |
| `src/generation/context.ts` | numbered context block with a char budget |
| `src/generation/prompt.ts` | system prompt, "no info" sentence |
| `src/generation/llm.ts` | `LLM` interface, Ollama and Anthropic implementations |
| `src/pipeline/ingest.ts` | ingest orchestration, idempotent |
| `src/pipeline/ask.ts` | ask orchestration, citation extraction |
| `src/cli/*` | `setup`, `ingest`, `ask` commands |
| `src/api/server.ts` | Hono: `GET /health`, `POST /ask`, `POST /ingest` |

## Design rules

- Every external call is plain `fetch` or a thin client. No orchestration framework until the roadmap says so.
- Interfaces (`Embedder`, `VectorStore`, `LLM`) exist so implementations can be swapped and later compared in the evaluation step.
- Every chunk is traceable: `sourcePath`, `chunkIndex`, and character offsets `start`/`end` in the original text.
- Ingestion is idempotent by construction (ids derived from content location, stale chunks per source removed before upsert).

## Data stores

| Store | Used from | Contents |
| --- | --- | --- |
| Qdrant | step 1 | chunk vectors + payload (text + metadata) |
| Postgres | step 9 | documents, versions, tenants, traces |
| MinIO | step 9 | original uploaded files |
