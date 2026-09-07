# Step 1: RAG mínimo viable

Objetivo: un pipeline completo, hecho a mano, que ingiera documentos y responda preguntas con citas.

## Decisiones

**Chunking.** Fixed-size por caracteres: 1000 chars, overlap 200. Dentro de cada ventana el corte prefiere, en orden: salto de párrafo, salto de línea, fin de oración, espacio. Se buscan cortes solo en la segunda mitad de la ventana para que los chunks no queden demasiado chicos. Los offsets `start`/`end` apuntan al texto original. Es deliberadamente simple; el paso 2 compara estrategias.

**IDs estables.** `sourceId = sha256(sourcePath relativo)`, `chunkId = uuid(sha256(sourceId + ":" + chunkIndex))`. Qdrant exige UUID o entero como id de punto, así que formateamos los primeros 16 bytes del hash como UUID. Consecuencia: re-ingestar el mismo archivo sobreescribe los puntos en lugar de duplicarlos. Antes del upsert se borran los chunks previos de ese `sourceId` para no dejar huérfanos si el documento se achicó.

**Embeddings.** `bge-m3` vía Ollama (`/api/embed`, batches de 16). Multilingüe, 1024 dims, similitud coseno. El cliente valida la dimensión contra `EMBED_DIM` para fallar temprano si se cambia de modelo.

**Vector store.** Qdrant con una sola colección `documents`. Payload: `sourceId`, `sourcePath`, `title`, `chunkIndex`, `start`, `end`, `text`. Índices de payload sobre `sourceId` y `sourcePath` para filtros baratos.

**Retrieval.** Solo vector search, top-k 5 por defecto. La firma de `vectorSearch` ya recibe filtros para que el paso 3 pueda agregar BM25, hybrid y re-ranking sin cambiar los callers.

**Context builder.** Mantiene el orden por score, numera cada chunk `[n]`, agrega `source: path#chunkN | title`, y corta por presupuesto de caracteres (`CONTEXT_MAX_CHARS`, ~4 chars por token). Los chunks descartados se cuentan para observabilidad.

**Prompt.** El system prompt exige responder solo con el contexto, citar `[n]` después de cada afirmación, responder en el idioma de la pregunta y usar exactamente la frase "No hay suficiente información en los documentos para responder." cuando no alcanza. Temperatura 0.

**Citations.** Se extraen los `[n]` que el modelo usó realmente y se devuelven solo esas citas, cada una con `sourcePath`, `chunkIndex`, `score` y un snippet. Los chunks recuperados completos van en `retrieved` para poder inspeccionar el retrieval aparte de la respuesta.

**LLM.** Interfaz `LLM` con `OllamaLLM` (`/api/chat`, no streaming) y `AnthropicLLM` (Messages API con fetch). Se elige con `LLM_PROVIDER`.

## Salida de `ask`

```json
{
  "question": "...",
  "answer": "... [1] ... [2]",
  "citations": [{ "n": 1, "sourcePath": "rag-conceptos.md", "title": "...", "chunkIndex": 0, "score": 0.71, "snippet": "..." }],
  "retrieved": [ { "id": "...", "text": "...", "metadata": { ... }, "score": 0.71 } ],
  "model": "llama3.1",
  "timings": { "embedMs": 0, "searchMs": 0, "generateMs": 0, "totalMs": 0 }
}
```

## Limitaciones conocidas (a resolver en pasos siguientes)

- Solo `.md` y `.txt`. Sin sección ni página en la metadata.
- Sin búsqueda lexical, sin re-ranking, sin query rewriting.
- El presupuesto de contexto es por caracteres, no por tokens reales.
- No hay verificación de que la respuesta esté respaldada por el contexto (paso 6).
- No hay dataset de evaluación (paso 7) ni trazas persistidas (paso 8).
