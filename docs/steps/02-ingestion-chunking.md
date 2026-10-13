# Step 2: ingestion y chunking serio

Objetivo: leer los formatos reales (Markdown, TXT, PDF, HTML, DOCX), poder cambiar de estrategia de chunking sin tocar el resto del pipeline, y que cada chunk sepa de qué sección y página salió.

## Decisiones

**Todo se normaliza a markdown.** Cada formato tiene su loader en `src/ingest/loaders.ts` y todos devuelven texto con headings `#`. Así hay un solo parser de secciones (`src/ingest/structure.ts`) para todos los formatos, la misma idea que ya usaba `jatsToMarkdown` con los papers de Europe PMC.

- **HTML**: `src/ingest/html.ts` usa el `HTMLRewriter` que trae Bun, sin dependencias. Convierte `h1`–`h6`, párrafos, listas, `pre` (a bloque con ```) y filas de tabla. Descarta `script`, `style`, `nav`, `footer`, `aside`, `form` y similares. `header` se conserva porque muchos artículos ponen ahí el `h1`. El título sale del primer `h1` y, si no hay, de `<title>`.
- **DOCX**: `mammoth` lo pasa a HTML y de ahí va por el mismo conversor. Es la única dependencia nueva: parsear el zip y el OOXML a mano no enseñaba nada sobre RAG.
- **PDF**: `unpdf` con `mergePages: false`. Las páginas se unen con una línea en blanco y se guarda el offset de cada una (`Document.pages`), que es lo que permite decir en qué página cae un chunk. Un PDF no trae headings, así que no tiene secciones.

**Una estrategia es una función que devuelve spans.** Cada chunker (`src/ingest/chunkers/`) recibe el texto y devuelve offsets `{ start, end }`. Nunca reescribe texto, así que `chunk.text === doc.text.slice(start, end)` vale para todas y la metadata se calcula en un solo lugar (`chunkDocument`). Se elige con `CHUNK_STRATEGY` o `--strategy`.

| Estrategia | Cómo corta | Overlap |
| --- | --- | --- |
| `fixed` | Ventana de `CHUNK_SIZE` chars; el corte prefiere párrafo, línea, oración, espacio (paso 1) | `CHUNK_OVERLAP` chars |
| `paragraph` | Agrupa párrafos enteros hasta llenar el tamaño. Un heading nunca queda al final de un chunk: pasa al siguiente con su texto | Repite los últimos párrafos que entren en `CHUNK_OVERLAP` |
| `heading` | Un chunk por sección. Los headings sin cuerpo se unen a la sección que sigue; las secciones más grandes que el tamaño se subdividen por párrafos | No |
| `semantic` | Embebe cada oración (con una vecina a cada lado), mide la distancia coseno entre oraciones consecutivas y corta donde supera el percentil `CHUNK_SEMANTIC_PERCENTILE` | No |

Cuando una unidad no entra en `CHUNK_SIZE` (un párrafo o una oración enormes), todas caen a `fixed` para esa parte. `semantic` además une los grupos de menos de un cuarto del tamaño y parte los que se pasan por la frontera de mayor distancia.

**`fixed` sigue siendo el default.** Los números de abajo dicen cuál corta más prolijo, no cuál recupera mejor. Eso se decide en el paso 7 con un dataset de preguntas.

**Metadata por chunk.** `sourceId`, `sourcePath`, `title`, `chunkIndex`, `start`, `end`, `strategy`, `format`, `contentHash`, y cuando existen `section`, `page` y `pageEnd`. La sección es el breadcrumb de headings (`Retrieval > Top-k`) sin repetir el título del documento. Si un chunk toca más de una sección se queda con la que ocupa más caracteres. El context builder agrega `section` y `page` al encabezado de cada bloque, y las citas los devuelven.

**IDs estables.** `chunkId = uuid(sha256(sourceId:start:end))`. Antes era `sourceId:chunkIndex`, que identificaba "el chunk número N" y no un pedazo concreto del documento: si un chunk anterior cambiaba de tamaño, el mismo ID pasaba a apuntar a otro texto. Ahora el ID es el rango de la fuente. `chunkIndex` queda solo para ordenar y mostrar (`archivo#chunk3`). `Document.contentHash` y el `contentHash` del chunk permiten detectar si el contenido cambió sin comparar texto.

Consecuencia para el paso 7: las fuentes esperadas del dataset de evaluación se tienen que expresar como `sourcePath` + rango de caracteres, no como IDs de chunk, porque cada estrategia genera chunks distintos sobre el mismo texto.

**Hay que re-ingestar.** Los IDs y el payload cambiaron. `ingest` borra los chunks viejos de cada fuente antes del upsert, así que alcanza con volver a correrlo.

## Comparación

`bun run chunks <path>` carga los documentos y aplica cada estrategia sin indexar nada. Con 5 papers en markdown (213.502 chars), `CHUNK_SIZE=1000`, `CHUNK_OVERLAP=200`:

| Estrategia | Chunks | Mín | p50 | Promedio | Máx | Termina a mitad de oración | Cruza secciones | Tiempo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fixed` | 336 | 370 | 859 | 831 | 999 | 25,6% | 32,4% | 3 ms |
| `paragraph` | 308 | 219 | 789 | 744 | 1000 | 2,3% | 7,5% | 2 ms |
| `heading` | 331 | 72 | 727 | 691 | 1000 | 1,2% | 0,0% | 3 ms |
| `semantic` | 344 | 259 | 624 | 619 | 1000 | 9,3% | 12,8% | 30 s |

- `fixed` mezcla dos secciones en un tercio de los chunks y corta una de cada cuatro veces a mitad de oración.
- `paragraph` casi no corta oraciones, pero sigue juntando el final de una sección con el principio de la otra.
- `heading` no cruza secciones nunca. El costo son chunks chicos (secciones de una línea como "Disclosure").
- `semantic` embebió 183.515 tokens solo para encontrar las fronteras, casi el triple de lo que cuesta indexar los chunks (65.224). Corta mejor que `fixed` pero ignora los headings, que en estos documentos ya marcan los cambios de tema.

"Termina a mitad de oración" cuenta los chunks que no terminan en `.`, `!`, `?`, `:` o `;`. "Cruza secciones" cuenta los que tocan el cuerpo de más de una sección.

## Limitaciones conocidas

- Los pedazos de una sección subdividida no repiten el heading en el texto, solo en la metadata.
- Las tablas de HTML y DOCX quedan como filas `a | b`, sin encabezado repetido.
- Los bloques de código con líneas en blanco se pueden partir entre chunks en `paragraph` y `heading`.
- El separador de oraciones es una regex: abreviaturas como "et al." o "Fig." generan cortes de más, que `semantic` suele volver a unir.
- PDFs escaneados (sin capa de texto) dan un documento vacío y se saltean.
