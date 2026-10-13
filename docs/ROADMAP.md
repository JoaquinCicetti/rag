# Plan de desarrollo: RAG productivo para LLMs

Roadmap práctico para pasar de un RAG implementado desde cero a un sistema robusto, evaluable y preparado para producción.

Estado: `[x]` hecho · `[~]` en progreso · `[ ]` pendiente. Cada paso tiene sus notas de diseño en `docs/steps/`.

## 1. RAG mínimo viable — `[x]` ([notas](steps/01-mvp.md))

- [x] Implementar ingestion de documentos.
- [x] Implementar chunking básico.
- [x] Generar embeddings.
- [x] Guardar embeddings y metadata en una vector database.
- [x] Implementar similarity search.
- [x] Construir el contexto a partir de los chunks recuperados.
- [x] Enviar contexto + pregunta al LLM.
- [x] Devolver respuesta con sources/citations.

Tecnologías: Bun + TypeScript + Docker + Qdrant + Ollama. No usar LangChain/LlamaIndex todavía: implementar el pipeline manualmente para entender cada pieza.

## 2. Ingestion y chunking serio — `[x]` ([notas](steps/02-ingestion-chunking.md), [agente de papers](steps/02-paper-agent.md))

- [x] Soportar Markdown, TXT, PDF, HTML y DOCX.
- [x] Comparar fixed-size chunking.
- [x] Comparar chunking por párrafos.
- [x] Comparar chunking por headings/secciones.
- [x] Experimentar con chunks semánticos.
- [x] Agregar overlap cuando corresponda.
- [x] Guardar metadata: documento, sección, página, título, posición y source ID.
- [x] Diseñar IDs estables para poder rastrear cada chunk hasta su fuente original.

La comparación de este paso es estructural (tamaños y fronteras, `bun run chunks`). Cuál recupera mejor se mide en el paso 7.

## 3. Retrieval avanzado — `[ ]`

- [ ] Implementar vector search.
- [ ] Implementar búsqueda lexical/keyword (por ejemplo BM25).
- [ ] Combinar vector + keyword en hybrid search.
- [ ] Experimentar con diferentes top-k.
- [ ] Agregar filtros por metadata.
- [ ] Agregar re-ranking de los resultados.
- [ ] Medir por separado la calidad del retrieval y la calidad de la respuesta.

## 4. Query understanding — `[ ]`

- [ ] Implementar query rewriting.
- [ ] Resolver referencias de conversaciones anteriores.
- [ ] Experimentar con multi-query retrieval.
- [ ] Separar preguntas complejas en subpreguntas cuando sea necesario.
- [ ] Comparar query original vs. query transformada y medir cuál recupera mejor.

## 5. Context engineering — `[ ]`

- [ ] Crear un Context Builder dedicado.
- [ ] Experimentar con cantidad y tamaño de chunks.
- [ ] Eliminar contexto redundante.
- [ ] Ordenar los chunks por relevancia o estructura.
- [ ] Incluir metadata útil en el contexto.
- [ ] Controlar límites de tokens.
- [ ] Diseñar instrucciones para que el LLM responda solamente con evidencia recuperada.
- [ ] Definir comportamiento explícito para "no hay suficiente información".

## 6. Grounded answers y citations — `[ ]`

- [ ] Cada chunk debe tener una referencia identificable.
- [ ] Devolver source, documento, sección y/o página.
- [ ] Permitir que el usuario navegue desde una afirmación hasta su fuente.
- [ ] Detectar respuestas que no están respaldadas por el contexto.
- [ ] Evitar que el sistema invente información cuando el retrieval es insuficiente.

## 7. Evaluation — `[ ]`

- [ ] Crear un dataset de preguntas reales.
- [ ] Definir expected answers y/o expected sources.
- [ ] Medir retrieval quality por separado de generation quality.
- [ ] Evaluar recall@k y precision@k.
- [ ] Medir faithfulness/groundedness de las respuestas.
- [ ] Comparar estrategias de chunking, embeddings, top-k y re-ranking.
- [ ] Automatizar los experimentos para poder comparar versiones del pipeline.
- [ ] Crear un pequeño benchmark que corra cada vez que cambies el sistema.

## 8. Observability y debugging — `[~]` (tracing básico adelantado)

- [ ] Trazar cada request de punta a punta.
- [ ] Registrar query rewriting.
- [x] Registrar embedding model.
- [ ] Registrar búsquedas vectoriales y lexicales.
- [x] Registrar resultados del retrieval.
- [ ] Registrar re-ranking.
- [x] Registrar contexto final enviado al LLM.
- [~] Registrar modelo, tokens, costo y latencia. (tokens, cache y latencia listos; falta costo)
- [x] Medir latencia por etapa.
- [ ] Construir una vista para inspeccionar por qué una respuesta fue generada.

## 9. Production architecture — `[ ]`

- [ ] Separar ingestion, retrieval y generation como componentes independientes.
- [ ] Crear un ingestion worker/background job.
- [ ] Agregar procesamiento asíncrono de documentos.
- [ ] Agregar versionado de documentos e índices.
- [ ] Agregar re-indexación.
- [ ] Agregar caching donde tenga sentido.
- [ ] Manejar errores, retries y timeouts.
- [ ] Agregar autenticación y aislamiento de datos por tenant.
- [ ] Preparar escalabilidad horizontal.

## 10. Agentic RAG — `[ ]`

- [ ] Agregar tools como search_documents, get_document y get_section.
- [ ] Permitir que el modelo decida cuándo necesita buscar.
- [ ] Permitir múltiples pasos de retrieval.
- [ ] Combinar RAG con herramientas externas cuando corresponda.
- [ ] Implementar planificación para preguntas complejas.
- [ ] Agregar límites de pasos, timeouts y controles contra loops.

## 11. Proyecto final — `[ ]`

Construir una plataforma tipo "Knowledge AI":

- [ ] Upload de documentos.
- [ ] Procesamiento automático.
- [ ] Indexación.
- [ ] Chat sobre los documentos.
- [ ] Hybrid retrieval + re-ranking.
- [ ] Citations navegables.
- [ ] Conversaciones con memoria.
- [ ] Dashboard de retrieval y traces.
- [ ] Dataset de evaluación + benchmark automático.
- [ ] Versionado de índices.
- [ ] Multi-tenant.
- [ ] API pública.
- [ ] Deploy con Docker y una arquitectura cloud.

## Stack

| Capa | Elección | Estado |
| --- | --- | --- |
| Backend | Bun + TypeScript | en uso |
| API | Hono | en uso |
| Vector DB | Qdrant (Docker) | en uso |
| LLM local | Ollama (`qwen3.5:35b`) | en uso |
| Embeddings | Ollama (`bge-m3`, multilingüe, 1024 dims) | en uso |
| Storage de archivos | MinIO (S3-compatible, Docker) | levantado, sin uso hasta el paso 9 |
| Database | PostgreSQL (Docker) | levantado, sin uso hasta el paso 9 |
| Infra | Docker Compose | en uso |

## Regla de aprendizaje

Primero implementar cada componente manualmente. Recién después introducir frameworks como LangChain, LlamaIndex u otros y comparar qué problemas resuelven y qué abstracciones agregan.
