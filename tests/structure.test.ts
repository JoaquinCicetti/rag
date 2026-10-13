import { describe, expect, test } from "bun:test";
import { pageAt, parseSections, sectionFor, sectionsWithBodyIn } from "../src/ingest/structure.ts";

const TEXT = ["intro", "# A", "## B", "body b", "```\n# not a heading\n```", "## C ##", "body c", "# D", "body d"].join("\n\n");

describe("parseSections", () => {
  const sections = parseSections(TEXT);

  test("builds heading paths and ignores fenced code", () => {
    expect(sections.map((section) => section.path.join(" > "))).toEqual(["", "A", "A > B", "A > C", "D"]);
    expect(sections.map((section) => section.level)).toEqual([0, 1, 2, 2, 1]);
  });

  test("sections cover the whole text without gaps", () => {
    expect(sections[0]!.start).toBe(0);
    expect(sections.at(-1)!.end).toBe(TEXT.length);
    for (let index = 1; index < sections.length; index++) expect(sections[index]!.start).toBe(sections[index - 1]!.end);
  });

  test("body excludes the heading line", () => {
    const b = sections[2]!;
    expect(TEXT.slice(b.bodyStart, b.bodyEnd)).toBe("body b\n\n```\n# not a heading\n```");
    const a = sections[1]!;
    expect(a.bodyEnd).toBe(a.bodyStart);
  });

  test("text without headings is a single unnamed section", () => {
    expect(parseSections("solo texto")).toMatchObject([{ level: 0, path: [], start: 0, end: 10 }]);
    expect(parseSections("")).toEqual([]);
  });
});

describe("sectionFor", () => {
  const sections = parseSections(TEXT);

  test("picks the section that holds most of the span", () => {
    const c = sections[3]!;
    expect(sectionFor(sections, { start: c.start, end: c.end })).toBe("A > C");
    expect(sectionFor(sections, { start: sections[1]!.start, end: sections[2]!.end })).toBe("A > B");
    expect(sectionFor(sections, { start: 0, end: 5 })).toBeUndefined();
  });

  test("sectionsWithBodyIn ignores heading-only sections", () => {
    const span = { start: sections[1]!.start, end: sections[2]!.end };
    expect(sectionsWithBodyIn(sections, span).map((section) => section.path.at(-1))).toEqual(["B"]);
    const wide = { start: sections[2]!.start, end: sections[3]!.end };
    expect(sectionsWithBodyIn(sections, wide).length).toBe(2);
  });
});

describe("pageAt", () => {
  const pages = [
    { page: 1, start: 0, end: 10 },
    { page: 3, start: 12, end: 20 },
  ];

  test("maps offsets to the page that contains them", () => {
    expect(pageAt(pages, 0)).toBe(1);
    expect(pageAt(pages, 11)).toBe(1);
    expect(pageAt(pages, 12)).toBe(3);
    expect(pageAt(pages, 99)).toBe(3);
    expect(pageAt([], 5)).toBeUndefined();
  });
});
