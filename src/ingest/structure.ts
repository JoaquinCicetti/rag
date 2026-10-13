import type { PageSpan, Span } from "../types.ts";
import { trimSpan } from "./spans.ts";

export interface Section {
  level: number;
  path: Array<string>;
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}

interface Heading {
  level: number;
  title: string;
  start: number;
  lineEnd: number;
}

const HEADING_LINE = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE_LINE = /^\s*(```|~~~)/;

const findHeadings = (text: string): Array<Heading> => {
  const headings: Array<Heading> = [];
  let inFence = false;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    const match = inFence ? null : line.match(HEADING_LINE);
    if (match) {
      headings.push({ level: match[1]!.length, title: match[2]!, start: offset, lineEnd: offset + line.length });
    }
    offset += line.length + 1;
  }
  return headings;
};

export const parseSections = (text: string): Array<Section> => {
  const headings = findHeadings(text);
  const sections: Array<Section> = [];
  const firstStart = headings[0]?.start ?? text.length;

  const preamble = trimSpan(text, 0, firstStart);
  if (preamble.end > preamble.start) {
    sections.push({ level: 0, path: [], start: 0, end: firstStart, bodyStart: preamble.start, bodyEnd: preamble.end });
  }

  const path: Array<Heading> = [];
  for (const [index, heading] of headings.entries()) {
    while (path.length > 0 && path.at(-1)!.level >= heading.level) path.pop();
    path.push(heading);
    const end = headings[index + 1]?.start ?? text.length;
    const body = trimSpan(text, heading.lineEnd, end);
    sections.push({
      level: heading.level,
      path: path.map((ancestor) => ancestor.title),
      start: heading.start,
      end,
      bodyStart: body.start,
      bodyEnd: body.end,
    });
  }
  return sections;
};

const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): number =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

const hasBody = (section: Section): boolean => section.bodyEnd > section.bodyStart;

export const sectionsWithBodyIn = (sections: Array<Section>, span: Span): Array<Section> =>
  sections.filter(
    (section) => hasBody(section) && overlap(span.start, span.end, section.bodyStart, section.bodyEnd) > 0,
  );

export const sectionFor = (sections: Array<Section>, span: Span): string | undefined => {
  let best: Section | undefined;
  let bestOverlap = 0;
  for (const section of sections) {
    const shared = overlap(span.start, span.end, section.start, section.end);
    if (shared > bestOverlap) {
      best = section;
      bestOverlap = shared;
    }
  }
  return best && best.path.length > 0 ? best.path.join(" > ") : undefined;
};

export const pageAt = (pages: Array<PageSpan>, offset: number): number | undefined => {
  let page: number | undefined;
  for (const span of pages) {
    if (span.start > offset) break;
    page = span.page;
  }
  return page ?? pages[0]?.page;
};
