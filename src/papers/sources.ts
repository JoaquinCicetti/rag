import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";
import { findOpenPmcids, fullTextXmlUrl, jatsToMarkdown } from "./europepmc.ts";

export interface PaperHit {
  doi: string;
  title: string;
  year?: number;
  authors: Array<string>;
  abstract: string;
  pdfUrls: Array<string>;
  pmcid?: string;
}

export interface DownloadedPaper {
  doi: string;
  title: string;
  path: string;
  url: string;
}

export interface PaperSources {
  search(query: string, limit: number): Promise<Array<PaperHit>>;
  lookup(doi: string): Promise<PaperHit | undefined>;
  download(hit: PaperHit): Promise<DownloadedPaper | undefined>;
}

interface OpenAlexAuthor {
  display_name: string;
}

interface OpenAlexAuthorship {
  author: OpenAlexAuthor;
}

interface OpenAlexOpenAccess {
  oa_url?: string | null;
}

interface OpenAlexIds {
  pmcid?: string;
}

interface OpenAlexLocation {
  pdf_url?: string | null;
}

interface OpenAlexWork {
  doi?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  authorships?: Array<OpenAlexAuthorship>;
  abstract_inverted_index?: Record<string, Array<number>> | null;
  best_oa_location?: OpenAlexLocation | null;
  locations?: Array<OpenAlexLocation>;
  open_access?: OpenAlexOpenAccess;
  ids?: OpenAlexIds;
}

interface FullText {
  url: string;
  markdown: string;
}

interface OpenAlexSearchResponse {
  results: Array<OpenAlexWork>;
}

interface UnpaywallLocation {
  url_for_pdf?: string | null;
}

interface UnpaywallResponse {
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: Array<UnpaywallLocation>;
}

const OPENALEX_URL = "https://api.openalex.org/works";
const UNPAYWALL_URL = "https://api.unpaywall.org/v2";
const OPENALEX_FIELDS = "doi,display_name,publication_year,authorships,abstract_inverted_index,best_oa_location,locations,open_access,ids";
const ABSTRACT_MAX_CHARS = 400;
const MAX_AUTHORS = 3;
const PDF_MAGIC = "%PDF";
const FETCH_TIMEOUT_MS = 30_000;

const stripDoiPrefix = (doi: string): string => doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();

const rebuildAbstract = (invertedIndex: Record<string, Array<number>>): string => {
  const words: Array<string> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) words[position] = word;
  }
  return words.join(" ");
};

const arxivPdfUrl = (doi: string): string | undefined => {
  const arxivId = doi.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  return arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined;
};

const uniqueUrls = (urls: Array<string | null | undefined>): Array<string> => [
  ...new Set(urls.filter((url): url is string => Boolean(url))),
];

export const parseOpenAlexWork = (work: OpenAlexWork): PaperHit | undefined => {
  if (!work.doi || !work.display_name) return undefined;
  const doi = stripDoiPrefix(work.doi);
  const abstract = work.abstract_inverted_index ? rebuildAbstract(work.abstract_inverted_index) : "";
  return {
    doi,
    title: work.display_name,
    year: work.publication_year ?? undefined,
    authors: (work.authorships ?? []).slice(0, MAX_AUTHORS).map((authorship) => authorship.author.display_name),
    abstract: abstract.slice(0, ABSTRACT_MAX_CHARS),
    pdfUrls: uniqueUrls([
      work.best_oa_location?.pdf_url,
      work.open_access?.oa_url,
      ...(work.locations ?? []).map((location) => location.pdf_url),
      arxivPdfUrl(doi),
    ]),
  };
};

export const parseUnpaywall = (response: UnpaywallResponse): Array<string> =>
  uniqueUrls([response.best_oa_location?.url_for_pdf, ...(response.oa_locations ?? []).map((location) => location.url_for_pdf)]);

export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

export const isRetrievable = (hit: PaperHit): boolean =>
  Boolean(hit.pmcid) || hit.pdfUrls.some((url) => url.startsWith("https://arxiv.org/"));

export const isPdf = (bytes: Uint8Array): boolean => new TextDecoder().decode(bytes.slice(0, 4)) === PDF_MAGIC;

export class OpenAccessSources implements PaperSources {
  private readonly dir: string;
  private readonly contactEmail: string;

  constructor(dir = config.papers.dir, contactEmail = config.papers.contactEmail) {
    this.dir = dir;
    this.contactEmail = contactEmail;
  }

  async search(query: string, limit: number): Promise<Array<PaperHit>> {
    const params = new URLSearchParams({
      search: query,
      filter: "is_oa:true,has_doi:true",
      "per-page": String(limit),
      select: OPENALEX_FIELDS,
      ...(this.contactEmail && { mailto: this.contactEmail }),
    });
    const data = await this.getJson<OpenAlexSearchResponse>(`${OPENALEX_URL}?${params}`);
    const hits = (data?.results ?? []).map(parseOpenAlexWork).filter((hit): hit is PaperHit => hit !== undefined);
    const annotated = await this.withPmcids(hits);
    return annotated.sort((left, right) => Number(isRetrievable(right)) - Number(isRetrievable(left)));
  }

  async lookup(doi: string): Promise<PaperHit | undefined> {
    const work = await this.getJson<OpenAlexWork>(`${OPENALEX_URL}/doi:${stripDoiPrefix(doi)}?select=${OPENALEX_FIELDS}`);
    const hit = work && parseOpenAlexWork(work);
    if (!hit) return undefined;
    const [annotated] = await this.withPmcids([hit]);
    return annotated;
  }

  private async withPmcids(hits: Array<PaperHit>): Promise<Array<PaperHit>> {
    const pmcidByDoi = await findOpenPmcids(hits.map((hit) => hit.doi), (url) => this.getJson(url));
    return hits.map((hit) => ({ ...hit, pmcid: pmcidByDoi.get(hit.doi) }));
  }

  async download(hit: PaperHit): Promise<DownloadedPaper | undefined> {
    const basePath = join(this.dir, `${hit.year ?? "n.d"}-${slugify(hit.title)}`);
    await mkdir(this.dir, { recursive: true });

    const fullText = hit.pmcid ? await this.europePmcFullText(hit.pmcid) : undefined;
    if (fullText) {
      const path = `${basePath}.md`;
      await Bun.write(path, fullText.markdown);
      return { doi: hit.doi, title: hit.title, path, url: fullText.url };
    }

    const unpaywallUrls = await this.unpaywallUrls(hit.doi);
    for (const url of uniqueUrls([...hit.pdfUrls, ...unpaywallUrls])) {
      const bytes = await this.fetchPdf(url);
      if (!bytes) continue;
      const path = `${basePath}.pdf`;
      await Bun.write(path, bytes);
      return { doi: hit.doi, title: hit.title, path, url };
    }
    return undefined;
  }

  private async europePmcFullText(pmcid: string): Promise<FullText | undefined> {
    const url = fullTextXmlUrl(pmcid);
    const response = await this.fetchOk(url);
    const xml = await response?.text();
    const markdown = xml ? jatsToMarkdown(xml) : "";
    return markdown ? { url, markdown } : undefined;
  }

  private async unpaywallUrls(doi: string): Promise<Array<string>> {
    if (!this.contactEmail) return [];
    const data = await this.getJson<UnpaywallResponse>(`${UNPAYWALL_URL}/${doi}?email=${encodeURIComponent(this.contactEmail)}`);
    return data ? parseUnpaywall(data) : [];
  }

  private async fetchPdf(url: string): Promise<Uint8Array | undefined> {
    const response = await this.fetchOk(url);
    const buffer = await response?.arrayBuffer().catch(() => undefined);
    const bytes = buffer && new Uint8Array(buffer);
    return bytes && isPdf(bytes) ? bytes : undefined;
  }

  private async getJson<T>(url: string): Promise<T | undefined> {
    const response = await this.fetchOk(url);
    const data = await response?.json().catch(() => undefined);
    return data as T | undefined;
  }

  private async fetchOk(url: string): Promise<Response | undefined> {
    try {
      const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return response.ok ? response : undefined;
    } catch {
      return undefined;
    }
  }

  private headers(): Record<string, string> {
    const contact = this.contactEmail ? ` (mailto:${this.contactEmail})` : "";
    return { "user-agent": `rag-paper-agent/0.1${contact}` };
  }
}
