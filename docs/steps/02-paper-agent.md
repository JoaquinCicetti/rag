# Step 2 (parcial): agente de papers open access

Objetivo: juntar papers científicos sobre un tema y alimentar el pipeline de ingest con PDFs reales.

## Decisiones

**Solo fuentes legales.** Búsqueda en OpenAlex (`is_oa:true`). Cada hit se marca `fulltext: yes|uncertain` con una sola consulta batch a Europe PMC, y los recuperables van primero. Para bajar se prueba en orden:
1. El texto completo de Europe PMC (`fullTextXML`, JATS convertido a markdown). Es la fuente más confiable y da mejor texto que extraerlo de un PDF.
2. Los PDFs de todas las `locations` de OpenAlex, arXiv y Unpaywall (requiere `CONTACT_EMAIL`).

Wiley, MDPI, Elsevier y el `pdf=render` de Europe PMC devuelven 403 a scripts. No se intenta esquivarlo. Se descarta cualquier respuesta que no empiece con `%PDF`.

**Agente con tool calling.** `LLM.chat` acepta `tools` y devuelve `toolCalls`, mapeado a `/api/chat` de Ollama y a `tool_use`/`tool_result` de Anthropic. Dos tools: `search_papers(query)` y `download_paper(doi)`. El loop corta al llegar a `--max` papers o a `PAPERS_MAX_STEPS`.

**Guardas para modelos chicos.** `llama3.1` 8B tiende a narrar descargas sin llamar la tool y a repetir la misma búsqueda. Por eso:
- si responde texto sin llegar al objetivo, se le recuerda cuántos papers tiene realmente;
- las búsquedas repetidas se rechazan y solo se devuelven hits nuevos;
- se deduplica por DOI y por título (preprint y versión publicada).

**Modelo.** Con `llama3.1` 8B una corrida de 5 papers sobre "Imidazoles" bajó 2/5 (uno fuera de tema) en 277 s. Con `qwen3.5:35b` (mixture-of-experts, con soporte de tools) bajó 5/5 relevantes en 5 pasos y 73 s, así que pasó a ser el default. Las guardas quedan para modelos chicos.

**Thinking.** `qwen3.5` piensa por defecto. `ask` manda `think: false`: con el contexto ya recuperado no hace falta, y la respuesta bajó de 96 s (3.932 tokens) a 16 s (165 tokens). El agente lo deja activado.

**PDF loader.** `unpdf` extrae el texto con las páginas unidas. El título sale del nombre de archivo (`<año>-<slug-del-título>.pdf`). La metadata de página se agregó después, ver [ingestion y chunking](02-ingestion-chunking.md).

**Observabilidad.** Cada corrida es un trace `papers`: un span `llm` por paso (tokens y tools pedidas) y un span `tool` por llamada (argumentos y resultado).

## Requisitos

Bun >= 1.4. Bun 1.2.4 tiene un segfault con algunos PDFs dentro de pdf.js.
