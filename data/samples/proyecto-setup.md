# Setup del proyecto RAG

Este proyecto está escrito en TypeScript y corre con Bun. La infraestructura local se levanta con Docker Compose e incluye Qdrant como base de datos vectorial, PostgreSQL para metadata y MinIO como storage compatible con S3.

Los modelos corren en Ollama. Para embeddings se usa bge-m3, un modelo multilingüe que funciona bien en español e inglés y produce vectores de 1024 dimensiones. Para generación se usa llama3.1 por defecto, aunque el proveedor se puede cambiar a la API de Anthropic con la variable LLM_PROVIDER.

El comando `bun run bootstrap` verifica dependencias, levanta los contenedores, descarga los modelos y crea la colección en Qdrant. El comando `bun run infra:reset` borra todos los volúmenes y vuelve a crear el entorno desde cero.
