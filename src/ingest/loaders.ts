import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { Document } from "../types.ts";
import { sourceIdFor } from "./ids.ts";

/** Formats supported in step 1. Step 2 adds pdf, html, docx. */
export const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/** Recursively list supported files under a path (file or directory). */
export const listSourceFiles = async (root: string): Promise<string[]> => {
  const abs = resolve(root);
  const st = await stat(abs);
  if (st.isFile()) return SUPPORTED_EXTENSIONS.has(extname(abs).toLowerCase()) ? [abs] : [];

  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(p);
    }
  };
  await walk(abs);
  return out.sort();
};

/** Title: first markdown H1 if present, else the file name without extension. */
const titleFor = (text: string, path: string): string => {
  const h1 = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return h1 && h1.length > 0 ? h1 : basename(path, extname(path));
};

/**
 * Load documents from a file or directory.
 * `sourcePath` is relative to the ingest root so ids stay stable across machines.
 */
export const loadDocuments = async (root: string): Promise<Document[]> => {
  const absRoot = resolve(root);
  const rootIsFile = (await stat(absRoot)).isFile();
  const base = rootIsFile ? resolve(absRoot, "..") : absRoot;
  const files = await listSourceFiles(absRoot);

  const docs: Document[] = [];
  for (const file of files) {
    const text = normalize(await Bun.file(file).text());
    if (text.trim().length === 0) continue;
    const sourcePath = relative(base, file).replace(/\\/g, "/");
    docs.push({
      sourceId: sourceIdFor(sourcePath),
      sourcePath,
      title: titleFor(text, file),
      text,
      format: extname(file).slice(1).toLowerCase(),
    });
  }
  return docs;
};

/** Normalize line endings and non-breaking spaces. */
const normalize = (s: string): string => s.replace(/\r\n?/g, "\n").replace(/ /g, " ");
