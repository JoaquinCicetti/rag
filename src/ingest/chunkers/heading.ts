import type { Span } from "../../types.ts";
import { isEmpty, trimSpan } from "../spans.ts";
import { parseSections } from "../structure.ts";
import type { FixedChunkOptions } from "./fixed.ts";
import { paragraphSpans } from "./paragraph.ts";

export const headingSpans = (text: string, options: FixedChunkOptions): Array<Span> => {
  const sections = parseSections(text);
  if (!sections.some((section) => section.level > 0)) return paragraphSpans(text, options);

  const spans: Array<Span> = [];
  let pendingStart: number | undefined;
  for (const section of sections) {
    const start = pendingStart ?? section.start;
    const headingOnly = section.bodyEnd <= section.bodyStart;
    if (headingOnly) {
      pendingStart = start;
      continue;
    }
    pendingStart = undefined;
    const unit = trimSpan(text, start, section.end);
    if (isEmpty(unit)) continue;
    if (unit.end - unit.start <= options.size) spans.push(unit);
    else spans.push(...paragraphSpans(text, options, unit));
  }
  return spans;
};
