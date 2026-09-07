# Setup

## Prerequisites

- [Bun](https://bun.sh) 1.2+
- Docker with Compose v2+
- [Ollama](https://ollama.com) installed natively (recommended on macOS for GPU access). If you don't have it, see "Ollama in Docker" below.
- `curl`

## First run

```bash
git clone git@github.com:JoaquinCicetti/rag.git
cd rag
bun run bootstrap
```

`bootstrap` is idempotent. It:

1. Checks `bun`, `docker` and `curl` are installed.
2. Creates `.env` from `.env.example` if missing.
3. Runs `bun install`.
4. Starts Qdrant, Postgres and MinIO with `docker compose up -d` and waits until they are healthy.
5. Verifies Ollama is reachable and pulls `bge-m3` and `llama3.1` if absent (about 6 GB total the first time).
6. Creates the Qdrant collection with the right vector dimension.

Then:

```bash
bun run ingest data/samples          # index the sample docs
bun run ask "¿Qué es un chunk?"      # ask, get an answer with [n] citations
bun run dev                          # HTTP API on :3000
```

## Services

| Service | URL | Notes |
| --- | --- | --- |
| Qdrant REST | http://127.0.0.1:6333 | dashboard at http://127.0.0.1:6333/dashboard |
| Qdrant gRPC | 127.0.0.1:6334 | |
| Postgres | 127.0.0.1:5432 | user/pass/db `rag` (from `.env`) |
| MinIO API | http://127.0.0.1:9000 | bucket `documents` created automatically |
| MinIO console | http://127.0.0.1:9001 | `minioadmin` / `minioadmin` |
| Ollama | http://127.0.0.1:11434 | native, or docker profile |
| RAG API | http://127.0.0.1:3000 | `bun run dev` |

## Everyday commands

| Command | What it does |
| --- | --- |
| `bun run infra:up` / `infra:down` | start / stop containers, keep data |
| `bun run infra:reset` | **destroys all volumes** and re-bootstraps from scratch |
| `bun run infra:ps` / `infra:logs` | status / tail logs |
| `bun run models:pull` | pull the embedding + LLM models |
| `bun run ingest <path>` | index a file or directory (`.md`, `.txt` in step 1) |
| `bun run ask "..." [--top-k 5] [--json] [--show-context]` | query the index |
| `bun run test` / `typecheck` | unit tests / `tsc --noEmit` |

## Configuration

All settings live in `.env` (see `.env.example` for every key and its default). The ones you are most likely to touch:

- `EMBED_MODEL` / `EMBED_DIM`: must match. Changing the model requires a new collection (`QDRANT_COLLECTION`) or `infra:reset`.
- `LLM_PROVIDER=ollama|anthropic`, `LLM_MODEL`, `ANTHROPIC_API_KEY`.
- `CHUNK_SIZE`, `CHUNK_OVERLAP`, `TOP_K`, `CONTEXT_MAX_CHARS`.

## Ollama in Docker

On a machine without native Ollama:

```bash
USE_DOCKER_OLLAMA=1 bun run bootstrap
# or manually: docker compose --profile ollama up -d
```

The container exposes the same port, so `OLLAMA_URL` does not change. Expect CPU-only inference unless you configure GPU passthrough.

## Troubleshooting

- **`ollama not reachable`**: start the Ollama app, or `ollama serve`, or use the docker profile.
- **`embedding dim mismatch`**: `EMBED_DIM` does not match the model. `bge-m3` is 1024, `nomic-embed-text` is 768.
- **`collection ... has dim X, expected Y`**: you changed the embedding model. Run `bun run infra:reset` or set a new `QDRANT_COLLECTION`.
- **Port already in use**: change the host side of the port mapping in `docker-compose.yml` and the matching URL in `.env`.
- **Slow first answer**: Ollama loads the model into memory on first use. Subsequent calls are faster.
