interface MathElement {
  tag: string;
  children: Array<MathNode>;
}

type MathNode = string | MathElement;

const TOKEN = /<(\/?)([\w:.-]+)[^>]*?(\/?)>|([^<]+)/g;
const ATOM = /^[\p{L}\p{N}.]+$/u;
const IGNORED = new Set(["annotation", "annotation-xml", "mspace"]);

const parse = (xml: string): MathElement => {
  const root: MathElement = { tag: "root", children: [] };
  const stack = [root];
  for (const [, closing, tag, selfClosing, text] of xml.matchAll(TOKEN)) {
    const parent = stack.at(-1)!;
    if (text !== undefined) {
      if (text.trim() !== "") parent.children.push(text.trim());
    } else if (closing) {
      if (stack.length > 1) stack.pop();
    } else {
      const element: MathElement = { tag: tag!.replace(/^.*:/, ""), children: [] };
      parent.children.push(element);
      if (!selfClosing) stack.push(element);
    }
  }
  return root;
};

const wrap = (text: string): string => (ATOM.test(text) ? text : `(${text})`);

const render = (node: MathNode): string => {
  if (typeof node === "string") return node;
  if (IGNORED.has(node.tag)) return "";
  const parts = node.children.map(render);
  const [first = "", second = "", third = ""] = parts;
  switch (node.tag) {
    case "msup":
      return `${wrap(first)}^${wrap(second)}`;
    case "msub":
      return `${wrap(first)}_${wrap(second)}`;
    case "msubsup":
      return `${wrap(first)}_${wrap(second)}^${wrap(third)}`;
    case "mfrac":
      return `${wrap(first)}/${wrap(second)}`;
    case "msqrt":
      return `sqrt(${parts.join("")})`;
    case "mroot":
      return `root(${first}, ${second})`;
    case "mfenced":
      return `(${parts.join(", ")})`;
    default:
      return parts.join("");
  }
};

export const mathmlToText = (xml: string): string => render(parse(xml));
