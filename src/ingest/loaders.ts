import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import type { Document } from "../types.ts";
import { sourceIdFor } from "./ids.ts";

export const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

const isSupported = (path: string): boolean => SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase());

export const listSourceFiles = async (root: string): Promise<Array<string>> => {
  const absolutePath = resolve(root);
  const rootStats = await stat(absolutePath);
  if (rootStats.isFile()) return isSupported(absolutePath) ? [absolutePath] : [];

  const files: Array<string> = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (isSupported(entry.name)) files.push(entryPath);
    }
  };
  await walk(absolutePath);
  return files.sort();
};

const titleFor = (text: string, path: string): string => {
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading ? heading : basename(path, extname(path));
};

export const loadDocuments = async (root: string): Promise<Array<Document>> => {
  const absRoot = resolve(root);
  const rootStats = await stat(absRoot);
  const rootIsFile = rootStats.isFile();
  const base = rootIsFile ? resolve(absRoot, "..") : absRoot;
  const files = await listSourceFiles(absRoot);

  const documents: Array<Document> = [];
  for (const file of files) {
    const rawText = await Bun.file(file).text();
    const text = normalize(rawText);
    if (text.trim().length === 0) continue;
    const sourcePath = relative(base, file).replace(/\\/g, "/");
    documents.push({
      sourceId: sourceIdFor(sourcePath),
      sourcePath,
      title: titleFor(text, file),
      text,
      format: extname(file).slice(1).toLowerCase(),
    });
  }
  return documents;
};

const normalize = (text: string): string => text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
