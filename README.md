# rag

A progressive, hand-built Retrieval-Augmented Generation system. Every component is implemented manually first (no LangChain/LlamaIndex) so each piece of the pipeline is understood before any framework is introduced.

Stack: Bun + TypeScript, Hono, Qdrant, Ollama (`bge-m3` embeddings, `llama3.1` generation), Postgres and MinIO (from step 9), Docker Compose.

## Quickstart

```bash
bun run bootstrap                    # containers + models + collection (idempotent)
bun run ingest data/samples          # index sample docs
bun run ask "¿Qué es un chunk?"      # answer with [n] citations
bun run dev                          # API on http://localhost:3000
```

```bash
curl -s localhost:3000/health
curl -s localhost:3000/ask -H 'content-type: application/json' -d '{"question":"What is recall@k?"}'
```

## Docs

- [Roadmap](docs/ROADMAP.md): the 11-step plan and current status.
- [Setup](docs/SETUP.md): prerequisites, commands, configuration, troubleshooting.
- [Architecture](docs/ARCHITECTURE.md): pipeline and module map.
- [Step notes](docs/steps/): design decisions per step.

## Layout

```
data/samples/   sample docs for smoke tests
docs/           roadmap, setup, architecture, step notes
scripts/        bootstrap.sh, reset.sh, wait-for.sh
src/            ingest, embeddings, vectorstore, retrieval, generation, pipeline, cli, api
tests/          bun test
```
