import type { Span } from "../types.ts";

export const trimSpan = (text: string, from: number, to: number): Span => {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { start, end };
};

export const isEmpty = (span: Span): boolean => span.end <= span.start;

export const shift = (span: Span, by: number): Span => ({ start: span.start + by, end: span.end + by });
