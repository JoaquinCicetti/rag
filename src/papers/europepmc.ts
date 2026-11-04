import { decodeEntities } from "../ingest/entities.ts";
import { mathmlToText } from "./mathml.ts";

const EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const DROPPED_ELEMENTS = ["fig", "ref-list", "xref", "supplementary-material", "graphic"];
const FORMULA_IMAGE = "[formula image not extracted]";
const TABLE_IMAGE = "[table image not extracted]";
const BLOCK_MARKER = "\ue001";

interface EuropePmcResult {
  doi?: string;
  pmcid?: string;
  isOpenAccess?: string;
}

interface EuropePmcResultList {
  result: Array<EuropePmcResult>;
}

interface EuropePmcSearchResponse {
  resultList?: EuropePmcResultList;
}

// What is left of "[1,2]" once the <xref> elements are gone.
const EMPTY_CITATION = /\s*\[[\s,;–-]*\]/g;

const superscript = (_: string, inner: string): string => {
  const text = inner.replace(/<[^>]+>/g, "").trim();
  if (text === "") return "";
  return /\s/.test(text) ? `^(${text})` : `^${text}`;
};

const plainText = (xml: string): string =>
  decodeEntities(
    xml
      .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/g, superscript)
      .replace(/<break\s*\/>|<\/p>/g, " ")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(EMPTY_CITATION, "")
    .replace(/\s+/g, " ")
    .trim();

const dropElements = (xml: string): string =>
  DROPPED_ELEMENTS.reduce(
    (cleaned, tag) => cleaned.replace(new RegExp(`<${tag}\\b[^>]*?(/>|>[\\s\\S]*?</${tag}>)`, "g"), ""),
    xml,
  );

const firstMatch = (xml: string, pattern: RegExp): string => xml.match(pattern)?.[1] ?? "";

const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const texFormula = (inner: string): string | undefined => {
  const raw = inner.match(/<tex-math\b[^>]*>([\s\S]*?)<\/tex-math>/)?.[1];
  if (raw === undefined) return undefined;
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, cdata: string) => escapeXml(cdata));
  const body = unwrapped.match(/\\begin\{document\}([\s\S]*?)\\end\{document\}/)?.[1] ?? unwrapped;
  return body.replace(/\$/g, "").trim();
};

const mathmlFormula = (inner: string): string | undefined => {
  const math = inner.match(/<(?:mml:)?math\b[^>]*>[\s\S]*?<\/(?:mml:)?math>/)?.[0];
  return math ? mathmlToText(math) : undefined;
};

const formulaText = (inner: string): string => {
  const label = plainText(firstMatch(inner, /<label\b[^>]*>([\s\S]*?)<\/label>/));
  const withoutLabel = inner.replace(/<label\b[^>]*>[\s\S]*?<\/label>/, "");
  const text = texFormula(withoutLabel) ?? mathmlFormula(withoutLabel);
  const fallback = /<(inline-)?graphic\b/.test(withoutLabel) ? FORMULA_IMAGE : withoutLabel;
  return [text ?? fallback, label].filter(Boolean).join(" ");
};

const FORMULA = (tag: string): RegExp => new RegExp(`<${tag}(?![\\w-])[^>]*?(?:/>|>([\\s\\S]*?)</${tag}>)`, "g");

const inlineFormulas = (xml: string, tag: string): string =>
  xml.replace(FORMULA(tag), (_, inner = "") => formulaText(inner));

const tableRows = (inner: string): Array<string> =>
  [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((row) =>
      [...(row[1] ?? "").matchAll(/<(td|th)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g)].map((cell) => plainText(cell[2] ?? "")),
    )
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells) => cells.join(" | "));

const tableText = (inner: string): string => {
  const label = plainText(firstMatch(inner, /<label\b[^>]*>([\s\S]*?)<\/label>/));
  const caption = plainText(firstMatch(inner, /<caption\b[^>]*>([\s\S]*?)<\/caption>/));
  const note = plainText(firstMatch(inner, /<table-wrap-foot\b[^>]*>([\s\S]*?)<\/table-wrap-foot>/));
  const rows = tableRows(inner);
  const heading = [label, caption].filter(Boolean).join(" ");
  return [heading, ...(rows.length > 0 ? rows : [TABLE_IMAGE]), note].filter(Boolean).join("\n");
};

interface ExtractedBlocks {
  xml: string;
  blocks: Array<string>;
}

// Tables and display equations can sit between paragraphs or inside one, and tables keep
// their line breaks, so both leave the XML as markers that blocksOf puts back as blocks.
const extractBlocks = (xml: string): ExtractedBlocks => {
  const blocks: Array<string> = [];
  const marker = (block: string): string => {
    blocks.push(block);
    return `${BLOCK_MARKER}${blocks.length - 1}${BLOCK_MARKER}`;
  };
  const withoutTables = xml.replace(/<table-wrap(?![\w-])[^>]*?(?:\/>|>([\s\S]*?)<\/table-wrap>)/g, (_, inner = "") => {
    const flattened = inlineFormulas(inlineFormulas(inner, "disp-formula"), "inline-formula");
    return marker(tableText(dropElements(flattened)));
  });
  const withoutEquations = withoutTables.replace(FORMULA("disp-formula"), (_, inner = "") =>
    marker(plainText(dropElements(formulaText(inner)))),
  );
  return { xml: dropElements(inlineFormulas(withoutEquations, "inline-formula")), blocks };
};

const paragraphBlocks = (text: string, tables: Array<string>): Array<string> =>
  text
    .split(new RegExp(`${BLOCK_MARKER}(\\d+)${BLOCK_MARKER}`))
    .map((part, index) => (index % 2 === 1 ? (tables[Number(part)] ?? "") : part.trim()));

const blocksOf = (xml: string, tables: Array<string>): Array<string> =>
  [...xml.matchAll(new RegExp(`<(title|p)\\b[^>]*>([\\s\\S]*?)</\\1>|${BLOCK_MARKER}(\\d+)${BLOCK_MARKER}`, "g"))]
    .flatMap((match) => {
      if (match[3] !== undefined) return [tables[Number(match[3])] ?? ""];
      const text = plainText(match[2] ?? "");
      return match[1] === "title" ? [`## ${text}`] : paragraphBlocks(text, tables);
    })
    .filter((block) => block !== "" && block !== "##");

export const jatsToMarkdown = (xml: string): string => {
  const { xml: cleaned, blocks } = extractBlocks(xml);
  const title = plainText(firstMatch(cleaned, /<article-title\b[^>]*>([\s\S]*?)<\/article-title>/));
  const abstract = blocksOf(firstMatch(cleaned, /<abstract\b[^>]*>([\s\S]*?)<\/abstract>/), blocks);
  const body = blocksOf(firstMatch(cleaned, /<body\b[^>]*>([\s\S]*?)<\/body>/), blocks);
  if (body.length === 0) return "";
  const abstractHeading = abstract[0]?.startsWith("## ") ? [] : ["## Abstract"];
  const abstractSection = abstract.length > 0 ? [...abstractHeading, ...abstract] : [];
  const sections = [`# ${title}`, ...abstractSection, ...body];
  return `${sections.join("\n\n")}\n`;
};

export type JsonFetcher = <T>(url: string) => Promise<T | undefined>;

export const findOpenPmcids = async (dois: Array<string>, fetchJson: JsonFetcher): Promise<Map<string, string>> => {
  const pmcidByDoi = new Map<string, string>();
  if (dois.length === 0) return pmcidByDoi;
  const query = encodeURIComponent(dois.map((doi) => `DOI:"${doi}"`).join(" OR "));
  const data = await fetchJson<EuropePmcSearchResponse>(
    `${EUROPE_PMC_URL}/search?query=${query}&format=json&resultType=lite&pageSize=${dois.length * 2}`,
  );
  for (const result of data?.resultList?.result ?? []) {
    if (result.doi && result.pmcid && result.isOpenAccess === "Y") pmcidByDoi.set(result.doi.toLowerCase(), result.pmcid);
  }
  return pmcidByDoi;
};

export const fullTextXmlUrl = (pmcid: string): string => `${EUROPE_PMC_URL}/${pmcid}/fullTextXML`;
