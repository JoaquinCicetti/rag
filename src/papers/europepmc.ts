import { decodeEntities } from "../ingest/entities.ts";

const EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const DROPPED_ELEMENTS = ["table-wrap", "fig", "ref-list", "xref", "supplementary-material", "graphic", "inline-formula", "disp-formula"];

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

const plainText = (xml: string): string => decodeEntities(xml.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const dropElements = (xml: string): string =>
  DROPPED_ELEMENTS.reduce(
    (cleaned, tag) => cleaned.replace(new RegExp(`<${tag}\\b[^>]*?(/>|>[\\s\\S]*?</${tag}>)`, "g"), ""),
    xml,
  );

const firstMatch = (xml: string, pattern: RegExp): string => xml.match(pattern)?.[1] ?? "";

const blocksOf = (xml: string): Array<string> =>
  [...xml.matchAll(/<(title|p)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((match) => {
      const text = plainText(match[2] ?? "");
      return match[1] === "title" ? `## ${text}` : text;
    })
    .filter((block) => block !== "" && block !== "##");

export const jatsToMarkdown = (xml: string): string => {
  const cleaned = dropElements(xml);
  const title = plainText(firstMatch(cleaned, /<article-title\b[^>]*>([\s\S]*?)<\/article-title>/));
  const abstract = blocksOf(firstMatch(cleaned, /<abstract\b[^>]*>([\s\S]*?)<\/abstract>/));
  const body = blocksOf(firstMatch(cleaned, /<body\b[^>]*>([\s\S]*?)<\/body>/));
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
