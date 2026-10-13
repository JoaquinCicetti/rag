import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { htmlToMarkdown } from "../src/ingest/html.ts";
import { joinPages, listSourceFiles, loadDocuments } from "../src/ingest/loaders.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("htmlToMarkdown", () => {
  test("keeps headings, lists and code; drops navigation and scripts", async () => {
    const html = await Bun.file(join(FIXTURES, "sample.html")).text();
    const { markdown, title } = await htmlToMarkdown(html);
    expect(title).toBe("Guía de retrieval & ranking");
    expect(markdown).toBe(
      [
        "# Retrieval híbrido",
        "Combina búsqueda vectorial y lexical.",
        "## BM25",
        "- Usa frecuencia de términos.",
        "- No entiende sinónimos.",
        "```\nscore = tf * idf\n\n# no es un heading\n```",
        "k | recall",
        "5 | 0.8",
      ].join("\n\n"),
    );
  });

  test("line breaks survive inside a block", async () => {
    const { markdown } = await htmlToMarkdown("<p>uno<br>dos</p><div>tres<p>cuatro</p></div>");
    expect(markdown).toBe("uno\ndos\n\ntres\n\ncuatro");
  });
});

describe("joinPages", () => {
  test("offsets point at each page and empty pages are skipped", () => {
    const { text, pages } = joinPages(["uno\r\n", "  ", "tres"]);
    expect(text).toBe("uno\n\ntres");
    expect(pages).toEqual([
      { page: 1, start: 0, end: 3 },
      { page: 3, start: 5, end: 9 },
    ]);
    for (const page of pages) expect(text.slice(page.start, page.end)).not.toContain("\n");
  });
});

describe("loadDocuments", () => {
  test("discovers every supported format", async () => {
    const files = await listSourceFiles(FIXTURES);
    expect(files.map((file) => file.slice(FIXTURES.length + 1))).toEqual(["sample.docx", "sample.html", "two-pages.pdf"]);
  });

  test("loads html, docx and pdf into normalised documents", async () => {
    const documents = await loadDocuments(FIXTURES);
    const byPath = new Map(documents.map((document) => [document.sourcePath, document]));

    const html = byPath.get("sample.html")!;
    expect(html).toMatchObject({ format: "html", title: "Retrieval híbrido" });
    expect(html.text).toStartWith("# Retrieval híbrido");

    const docx = byPath.get("sample.docx")!;
    expect(docx).toMatchObject({ format: "docx", title: "Manual de embeddings" });
    expect(docx.text).toContain("## Dimensiones\n\nEl modelo bge-m3 produce vectores de 1024 dimensiones.");

    const pdf = byPath.get("two-pages.pdf")!;
    expect(pdf).toMatchObject({ format: "pdf", title: "two-pages" });
    expect(pdf.pages!.map((page) => pdf.text.slice(page.start, page.end))).toEqual([
      "Primera pagina sobre chunking.",
      "Segunda pagina sobre retrieval.",
    ]);
    for (const document of documents) expect(document.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
