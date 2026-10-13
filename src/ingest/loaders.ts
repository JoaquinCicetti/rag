import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { Document, PageSpan } from "../types.ts";
import { htmlToMarkdown } from "./html.ts";
import { sha256, sourceIdFor } from "./ids.ts";

interface Loaded {
  text: string;
  title?: string;
  pages?: Array<PageSpan>;
}

type Loader = (path: string) => Promise<Loaded>;

const PAGE_SEPARATOR = "\n\n";

const normalize = (text: string): string => text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");

export const joinPages = (pageTexts: Array<string>): Required<Pick<Loaded, "text" | "pages">> => {
  const pages: Array<PageSpan> = [];
  let text = "";
  for (const [index, raw] of pageTexts.entries()) {
    const pageText = normalize(raw).trim();
    if (pageText === "") continue;
    if (text !== "") text += PAGE_SEPARATOR;
    pages.push({ page: index + 1, start: text.length, end: text.length + pageText.length });
    text += pageText;
  }
  return { text, pages };
};

const loadPlain: Loader = async (path) => ({ text: normalize(await Bun.file(path).text()) });

const loadPdf: Loader = async (path) => {
  const bytes = await Bun.file(path).bytes();
  const pdf = await getDocumentProxy(bytes);
  const extracted = await extractText(pdf, { mergePages: false });
  return joinPages(extracted.text);
};

const loadHtml: Loader = async (path) => {
  const html = await htmlToMarkdown(await Bun.file(path).text());
  return { text: normalize(html.markdown), title: html.title };
};

const loadDocx: Loader = async (path) => {
  const converted = await mammoth.convertToHtml({ path });
  const html = await htmlToMarkdown(converted.value);
  return { text: normalize(html.markdown) };
};

const LOADERS: Record<string, Loader> = {
  ".md": loadPlain,
  ".markdown": loadPlain,
  ".txt": loadPlain,
  ".pdf": loadPdf,
  ".html": loadHtml,
  ".htm": loadHtml,
  ".docx": loadDocx,
};

const HEADING_FORMATS = new Set([".md", ".markdown", ".html", ".htm", ".docx"]);

export const SUPPORTED_EXTENSIONS = new Set(Object.keys(LOADERS));

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

const titleFor = (loaded: Loaded, path: string): string => {
  const extension = extname(path).toLowerCase();
  const heading = HEADING_FORMATS.has(extension) ? loaded.text.match(/^#\s+(.+)$/m)?.[1]?.trim() : undefined;
  return heading || loaded.title || basename(path, extension);
};

export const loadDocuments = async (root: string): Promise<Array<Document>> => {
  const absRoot = resolve(root);
  const rootStats = await stat(absRoot);
  const rootIsFile = rootStats.isFile();
  const base = rootIsFile ? resolve(absRoot, "..") : absRoot;
  const files = await listSourceFiles(absRoot);

  const documents: Array<Document> = [];
  for (const file of files) {
    const extension = extname(file).toLowerCase();
    const loaded = await LOADERS[extension]!(file);
    if (loaded.text.trim().length === 0) continue;
    const sourcePath = relative(base, file).replace(/\\/g, "/");
    documents.push({
      sourceId: sourceIdFor(sourcePath),
      sourcePath,
      title: titleFor(loaded, file),
      text: loaded.text,
      format: extension.slice(1),
      contentHash: sha256(loaded.text),
      ...(loaded.pages ? { pages: loaded.pages } : {}),
    });
  }
  return documents;
};
