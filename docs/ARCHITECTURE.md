# Architecture

Current state: step 2 (ingestion and chunking). This document is updated as each roadmap step lands.

## Pipeline

```
INGEST   file/dir ──► loaders (md, txt, pdf, html, docx ──► markdown) ──► chunk (fixed | paragraph | heading | semantic) ──► embed (Ollama bge-m3) ──► Qdrant upsert
                                          │ stable ids: uuid(sha256(sourceId:start:end))
ASK      question ──► embed ──► Qdrant search (cosine, top-k) ──► context builder ([n] + source) ──► LLM (Ollama qwen3.5:35b) ──► answer + citations
```

## Module map

| Path | Responsibility |
| --- | --- |
| `src/config.ts` | env parsing with defaults |
| `src/types.ts` | `Document`, `Chunk`, `RetrievedChunk`, `Citation`, `Answer` |
| `src/ingest/loaders.ts` | file discovery, one loader per format (`.md`, `.txt`, `.pdf`, `.html`, `.docx`), title extraction, PDF page offsets |
| `src/ingest/html.ts` | HTML to markdown with Bun's `HTMLRewriter` (also used for DOCX via `mammoth`) |
| `src/ingest/structure.ts` | heading sections and page lookup over the normalised text |
| `src/ingest/chunk.ts` | strategy dispatch + chunk metadata (section, page, hashes) |
| `src/ingest/chunkers/*` | `fixed`, `paragraph`, `heading` and `semantic` span strategies |
| `src/ingest/ids.ts` | deterministic source and chunk ids |
| `src/embeddings/ollama.ts` | `Embedder` interface + Ollama implementation |
| `src/vectorstore/qdrant.ts` | `VectorStore` interface + Qdrant implementation |
| `src/retrieval/search.ts` | vector search (hybrid + re-rank land here in step 3) |
| `src/generation/context.ts` | numbered context block with a char budget |
| `src/generation/prompt.ts` | system prompt, "no info" sentence |
| `src/generation/llm.ts` | `LLM` interface, Ollama and Anthropic implementations |
| `src/pipeline/ingest.ts` | ingest orchestration, idempotent |
| `src/pipeline/ask.ts` | ask orchestration, citation extraction |
| `src/cli/*` | `setup`, `ingest`, `chunks`, `ask`, `traces`, `papers` commands |
| `src/api/server.ts` | Hono: `GET /health`, `POST /ask`, `POST /ingest` |

## Design rules

- Every external call is plain `fetch` or a thin client. No orchestration framework until the roadmap says so.
- Interfaces (`Embedder`, `VectorStore`, `LLM`) exist so implementations can be swapped and later compared in the evaluation step.
- Every chunk is traceable: `sourcePath`, `chunkIndex`, character offsets `start`/`end` in the normalised text, plus `section` and `page` when the format has them.
- Ingestion is idempotent by construction (ids derived from content location, stale chunks per source removed before upsert).

## Data stores

| Store | Used from | Contents |
| --- | --- | --- |
| Qdrant | step 1 | chunk vectors + payload (text + metadata) |
| Postgres | step 9 | documents, versions, tenants, traces |
| MinIO | step 9 | original uploaded files |
