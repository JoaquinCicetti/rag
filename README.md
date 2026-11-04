# rag

A progressive, hand-built Retrieval-Augmented Generation system. Every component is implemented manually first (no LangChain/LlamaIndex) so each piece of the pipeline is understood before any framework is introduced.

Stack: Bun + TypeScript, Hono, Qdrant, Ollama (`bge-m3` embeddings, `qwen3.5:35b` generation), Postgres and MinIO (from step 9), Docker Compose.

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

## Ingestion and chunking

`ingest` reads `.md`, `.txt`, `.pdf`, `.html` and `.docx`. Four chunking strategies share one interface: `fixed`, `paragraph`, `heading` and `semantic` (`CHUNK_STRATEGY` or `--strategy`). Every chunk keeps its section and page.

```bash
bun run chunks data/samples --strategy fixed,paragraph,heading   # compare sizes and boundaries, no indexing
bun run ingest data/samples --strategy heading
```

## Search UI

`bun run dev`, then open http://localhost:3000. **Search** finds passages without calling the LLM. **Ask** answers with the LLM and clickable `[n]` citations. Results and citations open the full document with the passage highlighted.

The viewer rebuilds each document from its indexed chunks, so it shows the extracted text rather than the original file.

## Tracing

Every `ask` and `ingest` writes a trace (one JSONL line) to `data/traces/YYYY-MM-DD.jsonl`.

```bash
bun run ask "¿Qué es un chunk?" --trace   # answer + span tree
bun run traces                            # last 20 runs: latency, tokens in/cached/out
bun run traces <id> [--prompt] [--json]   # one run; --prompt dumps the exact messages sent
curl -s localhost:3000/traces/<id>        # same over the API (/ask returns traceId)
```

How to read the `generate` span: `load` is the model cold start (Ollama unloads idle models), `prompt` is the tokens the LLM read (`cached` = prefix reused from the KV cache, usually just the system prompt because the retrieved context changes per question), `output` is the generated tokens and decode speed. Disable with `TRACES_ENABLED=false`.

## Paper agent

An LLM tool-calling agent that searches open-access papers (OpenAlex), finds a legal PDF (OpenAlex, Unpaywall, arXiv, Europe PMC) and saves it to `data/papers/`. Set `CONTACT_EMAIL` to enable Unpaywall.

```bash
bun run papers "retrieval augmented generation" --max 5 --ingest
bun run traces <id>                       # llm steps and tool calls
```

Papers from Europe PMC keep tables (`a | b` rows) and equations (from TeX or MathML), and a marker shows where one exists only as an image. PDFs are plain extracted text, so their tables and equations can come out scrambled, and `ask` may then present an invented equation next to correct coefficients. Check equations against the original PDF.

To switch topic, run `bun run infra:reset` first. It empties the index and deletes the downloaded papers. `ingest` never removes chunks for a file you delete, so remove off-topic downloads before indexing.

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
