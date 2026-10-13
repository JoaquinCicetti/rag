const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  deg: "°",
  times: "×",
  iexcl: "¡",
  iquest: "¿",
  euro: "€",
  szlig: "ß",
};

const COMBINING_MARKS: Record<string, string> = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  uml: "\u0308",
  tilde: "\u0303",
  cedil: "\u0327",
  ring: "\u030a",
};

const ACCENTED = /&([A-Za-z])(acute|grave|circ|uml|tilde|cedil|ring);/g;

export const decodeEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(ACCENTED, (_, letter: string, mark: string) => `${letter}${COMBINING_MARKS[mark]}`.normalize("NFC"))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name] ?? entity);
