import { decodeEntities } from "./entities.ts";

export interface HtmlDocument {
  markdown: string;
  title?: string;
}

const SKIPPED = new Set(["script", "style", "nav", "footer", "aside", "noscript", "template", "svg", "form", "button", "iframe"]);
const BLOCKS = new Set([
  "p", "div", "section", "article", "main", "header", "body", "ul", "ol", "dl", "dt", "dd",
  "table", "tr", "blockquote", "figure", "figcaption", "hr",
]);
const CELLS = new Set(["td", "th"]);
const HEADING = /^h([1-6])$/;
const LINE_BREAK = "\ue000";

export const htmlToMarkdown = async (html: string): Promise<HtmlDocument> => {
  const blocks: Array<string> = [];
  let buffer = "";
  let prefix = "";
  let title = "";
  let skipDepth = 0;
  let inPre = false;
  let inTitle = false;

  const flush = (): void => {
    const text = decodeEntities(buffer)
      .replace(/\s+/g, " ")
      .replace(/ ?\ue000 ?/g, "\n")
      .replace(/(\s*\|\s*)+$/, "")
      .trim();
    buffer = "";
    if (text !== "") blocks.push(`${prefix}${text}`);
  };

  const openPrefixed = (element: HTMLRewriterTypes.Element, marker: string): void => {
    flush();
    prefix = marker;
    element.onEndTag(() => {
      flush();
      prefix = "";
    });
  };

  const rewriter = new HTMLRewriter()
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (SKIPPED.has(tag)) {
          skipDepth++;
          element.onEndTag(() => {
            skipDepth--;
          });
          return;
        }
        if (skipDepth > 0) return;

        const heading = tag.match(HEADING);
        if (heading) return openPrefixed(element, `${"#".repeat(Number(heading[1]))} `);
        if (tag === "li") return openPrefixed(element, "- ");
        if (tag === "br") {
          buffer += LINE_BREAK;
          return;
        }
        if (tag === "title") {
          inTitle = true;
          element.onEndTag(() => {
            inTitle = false;
          });
          return;
        }
        if (tag === "pre") {
          flush();
          inPre = true;
          element.onEndTag(() => {
            const code = decodeEntities(buffer).replace(/^\n+|\s+$/g, "");
            buffer = "";
            inPre = false;
            if (code !== "") blocks.push(`\`\`\`\n${code}\n\`\`\``);
          });
          return;
        }
        if (CELLS.has(tag)) {
          element.onEndTag(() => {
            if (!inPre) buffer += " | ";
          });
          return;
        }
        if (BLOCKS.has(tag) && !inPre) {
          flush();
          if (element.canHaveContent) element.onEndTag(flush);
        }
      },
    })
    .onDocument({
      text(chunk) {
        if (skipDepth > 0) return;
        if (inTitle) title += chunk.text;
        else buffer += chunk.text;
      },
    });

  await rewriter.transform(new Response(html)).text();
  flush();

  const cleanTitle = decodeEntities(title).replace(/\s+/g, " ").trim();
  return { markdown: blocks.join("\n\n"), ...(cleanTitle ? { title: cleanTitle } : {}) };
};
