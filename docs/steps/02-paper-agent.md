# Step 2 (parcial): agente de papers open access

Objetivo: juntar papers científicos sobre un tema y alimentar el pipeline de ingest con PDFs reales.

## Decisiones

**Solo fuentes legales.** Búsqueda en OpenAlex (`is_oa:true`). El PDF se resuelve en orden: `best_oa_location.pdf_url` y `oa_url` de OpenAlex, arXiv (DOIs `10.48550/arxiv.*`), Europe PMC (`pmcid`) y Unpaywall (requiere `CONTACT_EMAIL`). Se descarta cualquier respuesta que no empiece con `%PDF` (landing pages, paywalls).

**Agente con tool calling.** `LLM.chat` acepta `tools` y devuelve `toolCalls`, mapeado a `/api/chat` de Ollama y a `tool_use`/`tool_result` de Anthropic. Dos tools: `search_papers(query)` y `download_paper(doi)`. El loop corta al llegar a `--max` papers o a `PAPERS_MAX_STEPS`.

**Guardas para modelos chicos.** `llama3.1` 8B tiende a narrar descargas sin llamar la tool y a repetir la misma búsqueda. Por eso:
- si responde texto sin llegar al objetivo, se le recuerda cuántos papers tiene realmente;
- las búsquedas repetidas se rechazan y solo se devuelven hits nuevos;
- se deduplica por DOI y por título (preprint y versión publicada).

Con Anthropic (`LLM_PROVIDER=anthropic`) la selección es bastante mejor.

**PDF loader.** `unpdf` extrae el texto con las páginas unidas. El título sale del nombre de archivo (`<año>-<slug-del-título>.pdf`). Todavía no se guarda metadata de página: queda para el resto del paso 2.

**Observabilidad.** Cada corrida es un trace `papers`: un span `llm` por paso (tokens y tools pedidas) y un span `tool` por llamada (argumentos y resultado).

## Requisitos

Bun >= 1.4. Bun 1.2.4 tiene un segfault con algunos PDFs dentro de pdf.js.
