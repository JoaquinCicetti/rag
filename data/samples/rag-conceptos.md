# Conceptos básicos de RAG

RAG (Retrieval-Augmented Generation) es una técnica que combina búsqueda de información con generación de texto por un modelo de lenguaje. En lugar de confiar solo en lo que el modelo aprendió durante el entrenamiento, el sistema recupera fragmentos relevantes de una base de documentos y los pasa como contexto al modelo para que responda basándose en evidencia.

## Chunking

Un chunk es un fragmento de un documento. Los documentos largos se dividen en chunks porque los modelos de embeddings y los LLMs tienen límites de contexto, y porque fragmentos más pequeños permiten recuperar exactamente la parte relevante en lugar de todo el documento. El tamaño típico de un chunk va de 200 a 1000 tokens. Es común agregar un solapamiento (overlap) entre chunks consecutivos para no cortar ideas por la mitad.

## Embeddings

Un embedding es un vector numérico que representa el significado de un texto. Textos con significado similar producen vectores cercanos en el espacio vectorial. Para buscar, se calcula el embedding de la pregunta y se comparan con los embeddings de los chunks usando una métrica como la similitud coseno.

## Vector database

Una base de datos vectorial almacena embeddings junto con metadata y permite hacer búsquedas por similitud de forma eficiente. Ejemplos: Qdrant, Weaviate, Milvus, pgvector. En este proyecto usamos Qdrant.

## Citations

Cada respuesta debe indicar de qué fragmento proviene la información. Para eso cada chunk tiene un identificador estable que permite rastrearlo hasta el documento original, la sección y la posición.
