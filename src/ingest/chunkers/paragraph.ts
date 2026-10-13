import type { Span } from "../../types.ts";
import { isEmpty, shift, trimSpan } from "../spans.ts";
import { assertChunkOptions, fixedSizeSpans, type FixedChunkOptions } from "./fixed.ts";

const PARAGRAPH_BREAK = /\n[ \t]*\n/g;

export const paragraphsIn = (text: string, range?: Span): Array<Span> => {
  const from = range?.start ?? 0;
  const to = range?.end ?? text.length;
  const paragraphs: Array<Span> = [];
  let cursor = from;
  const push = (end: number): void => {
    const paragraph = trimSpan(text, cursor, end);
    if (!isEmpty(paragraph)) paragraphs.push(paragraph);
  };
  for (const match of text.slice(from, to).matchAll(PARAGRAPH_BREAK)) {
    push(from + match.index);
    cursor = from + match.index + match[0].length;
  }
  push(to);
  return paragraphs;
};

const carriedOver = (group: Array<Span>, next: Span, options: FixedChunkOptions): Array<Span> => {
  const groupEnd = group.at(-1)!.end;
  let keepFrom = group.length;
  while (keepFrom > 0) {
    const candidate = group[keepFrom - 1]!;
    if (groupEnd - candidate.start > options.overlap || next.end - candidate.start > options.size) break;
    keepFrom--;
  }
  return group.slice(keepFrom);
};

const HEADING_ONLY = /^#{1,6}[ \t][^\n]*$/;

const detachTrailingHeadings = (text: string, group: Array<Span>): Array<Span> => {
  let keep = group.length;
  while (keep > 0 && HEADING_ONLY.test(text.slice(group[keep - 1]!.start, group[keep - 1]!.end))) keep--;
  return group.splice(keep);
};

export const paragraphSpans = (text: string, options: FixedChunkOptions, range?: Span): Array<Span> => {
  assertChunkOptions(options);
  const spans: Array<Span> = [];
  let group: Array<Span> = [];
  const emit = (): void => {
    if (group.length > 0) spans.push({ start: group[0]!.start, end: group.at(-1)!.end });
  };

  for (const paragraph of paragraphsIn(text, range)) {
    const fits = group.length === 0 || paragraph.end - group[0]!.start <= options.size;
    if (fits && paragraph.end - paragraph.start <= options.size) {
      group.push(paragraph);
      continue;
    }

    const headings = detachTrailingHeadings(text, group);
    const start = headings[0]?.start ?? paragraph.start;
    emit();
    if (paragraph.end - start > options.size) {
      group = [];
      const pieces = fixedSizeSpans(text.slice(start, paragraph.end), options);
      spans.push(...pieces.map((piece) => shift(piece, start)));
    } else {
      group = headings.length > 0 ? [...headings, paragraph] : [...carriedOver(group, paragraph, options), paragraph];
    }
  }
  emit();
  return spans;
};
