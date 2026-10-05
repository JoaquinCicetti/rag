import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.ts";

export interface PaperHit {
  doi: string;
  title: string;
  year?: number;
  authors: Array<string>;
  abstract: string;
  pdfUrls: Array<string>;
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
  open_access?: OpenAlexOpenAccess;
  ids?: OpenAlexIds;
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
const OPENALEX_FIELDS = "doi,display_name,publication_year,authorships,abstract_inverted_index,best_oa_location,open_access,ids";
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

const europePmcPdfUrl = (pmcid?: string): string | undefined => {
  const pmcNumber = pmcid?.match(/PMC\d+/i)?.[0];
  return pmcNumber ? `https://europepmc.org/articles/${pmcNumber.toUpperCase()}?pdf=render` : undefined;
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
      arxivPdfUrl(doi),
      europePmcPdfUrl(work.ids?.pmcid),
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
    return (data?.results ?? []).map(parseOpenAlexWork).filter((hit): hit is PaperHit => hit !== undefined);
  }

  async lookup(doi: string): Promise<PaperHit | undefined> {
    const work = await this.getJson<OpenAlexWork>(`${OPENALEX_URL}/doi:${stripDoiPrefix(doi)}?select=${OPENALEX_FIELDS}`);
    return work ? parseOpenAlexWork(work) : undefined;
  }

  async download(hit: PaperHit): Promise<DownloadedPaper | undefined> {
    const unpaywallUrls = await this.unpaywallUrls(hit.doi);
    const candidates = uniqueUrls([...hit.pdfUrls, ...unpaywallUrls]);
    const path = join(this.dir, `${hit.year ?? "n.d"}-${slugify(hit.title)}.pdf`);
    await mkdir(this.dir, { recursive: true });
    for (const url of candidates) {
      const bytes = await this.fetchPdf(url);
      if (!bytes) continue;
      await Bun.write(path, bytes);
      return { doi: hit.doi, title: hit.title, path, url };
    }
    return undefined;
  }

  private async unpaywallUrls(doi: string): Promise<Array<string>> {
    if (!this.contactEmail) return [];
    const data = await this.getJson<UnpaywallResponse>(`${UNPAYWALL_URL}/${doi}?email=${encodeURIComponent(this.contactEmail)}`);
    return data ? parseUnpaywall(data) : [];
  }

  private async fetchPdf(url: string): Promise<Uint8Array | undefined> {
    try {
      const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return isPdf(bytes) ? bytes : undefined;
    } catch {
      return undefined;
    }
  }

  private async getJson<T>(url: string): Promise<T | undefined> {
    try {
      const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return undefined;
      return (await response.json()) as T;
    } catch {
      return undefined;
    }
  }

  private headers(): Record<string, string> {
    const contact = this.contactEmail ? ` (mailto:${this.contactEmail})` : "";
    return { "user-agent": `rag-paper-agent/0.1${contact}` };
  }
}
