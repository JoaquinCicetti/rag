# Evaluating a RAG system

A RAG system has two independent parts that can fail: retrieval and generation. They must be measured separately.

## Retrieval metrics

Recall@k measures whether the relevant chunks appear among the top k results. Precision@k measures how many of the top k results are actually relevant. To compute them you need a dataset of questions with their expected sources.

## Generation metrics

Faithfulness (also called groundedness) measures whether every claim in the answer is supported by the retrieved context. An answer can be fluent and wrong: if the model adds facts that are not in the context, it is hallucinating.

## Why separate them

If the answer is bad, you need to know where to look. Low recall means the right chunk never reached the model, so changing the prompt will not help. High recall with a bad answer points to the prompt, the context builder, or the model itself.

## Automating experiments

Every change to chunking, embeddings, top-k or re-ranking should be compared against a fixed benchmark. Run the benchmark on every change and keep the results so you can see regressions.
