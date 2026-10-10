import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { cardRefFromURL, managedWikiReference } from "./markdown";

function mathMarkdown(element: HTMLElement): string | undefined {
  const kind = element.getAttribute("data-type");
  if (kind !== "inline-math" && kind !== "block-math") return;
  const source = element.getAttribute("data-math-source");
  if (source !== null)
    return kind === "block-math" ? `\n\n${source}\n\n` : source;
  const latex = element.getAttribute("data-latex") || "";
  return kind === "block-math" ? `\n\n$$\n${latex}\n$$\n\n` : `$${latex}$`;
}

export function richTextToMarkdown(html: string | HTMLElement): string {
  const owner = (
    typeof html === "string"
      ? (globalThis.document ?? Zotero.getMainWindow().document)
      : html.ownerDocument
  ) as Document;
  const root = owner.createElement("div");
  if (typeof html === "string") root.innerHTML = html;
  else root.append(html.cloneNode(true));
  let prefix = "knowledgebasemathsource";
  while (root.innerHTML.includes(prefix)) prefix += "x";
  const inlineMath: string[] = [];
  for (const node of Array.from(
    root.querySelectorAll('span.math, [data-type="inline-math"]'),
  ) as HTMLElement[]) {
    const source = node.classList.contains("math")
      ? node.textContent || ""
      : mathMarkdown(node as HTMLElement)!;
    node.replaceWith(
      owner.createTextNode(`${prefix}${inlineMath.push(source) - 1}end`),
    );
  }
  // Merge math and adjacent prose before escaping Markdown. A text node starting
  // with "-norm" after inline math is not the start of a Markdown list.
  root.normalize();
  const converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    blankReplacement: (_content, node) =>
      mathMarkdown(node as HTMLElement) ??
      ((node as HTMLElement & { isBlock: boolean }).isBlock ? "\n\n" : ""),
  });
  converter.use(gfm);
  converter.addRule("nativeMath", {
    filter: (node) =>
      ["SPAN", "PRE"].includes(node.nodeName) &&
      node.classList.contains("math"),
    replacement: (_content, node) =>
      node.nodeName === "PRE"
        ? `\n\n${node.textContent}\n\n`
        : node.textContent || "",
  });
  // Preserve the host's structured data rather than flattening citations or images.
  converter.addRule("nativeData", {
    filter: (node) =>
      !!(
        node.getAttribute("data-citation") ||
        node.getAttribute("data-annotation") ||
        node.getAttribute("data-attachment-key")
      ),
    replacement: (_content, node) => (node as HTMLElement).outerHTML,
  });
  converter.addRule("citation", {
    filter: (node) =>
      node.nodeName === "A" && !!node.getAttribute("data-citation-key"),
    replacement: (_content, node) =>
      `[@${node.getAttribute("data-citation-key")}]`,
  });
  converter.addRule("math", {
    filter: (node) =>
      ["inline-math", "block-math"].includes(
        node.getAttribute("data-type") || "",
      ),
    replacement: (_content, node) => {
      return mathMarkdown(node as HTMLElement)!;
    },
  });
  converter.addRule("cardReference", {
    filter: (node) =>
      node.nodeName === "A" &&
      !!(
        cardRefFromURL(node.getAttribute("href") || "") ||
        managedWikiReference(
          node.getAttribute("title") || "",
          node.getAttribute("href") || "",
        )
      ),
    replacement: (_content, node) => {
      const link = node as HTMLElement;
      const wiki = managedWikiReference(
        link.getAttribute("title") || "",
        link.getAttribute("href") || "",
      );
      if (wiki) {
        if (!wiki.includes("|")) return wiki;
        return `[[${wiki.slice(2, -2).split("|")[0]}|${(link.textContent || "").replace(/[\][\n]/g, " ")}]]`;
      }
      const id = cardRefFromURL(link.getAttribute("href") || "");
      const alias = link.getAttribute("data-card-alias");
      if (alias) return `[[${id}|${alias.replace(/[[\]\n]/g, " ")}]]`;
      if (link.textContent === `[[${id}]]`) return `[[${id}]]`;
      const label = (link.textContent || id || "").replace(
        /([\\[\]`*_])/g,
        "\\$1",
      );
      return `[${label}](${link.getAttribute("href")})`;
    },
  });
  converter.addRule("managedImage", {
    filter: (node) =>
      node.nodeName === "IMG" &&
      /^resource:\/\/knowledge-base-assets\//.test(
        node.getAttribute("src") || "",
      ),
    replacement: (_content, node) => {
      const image = node as HTMLElement;
      const filename = (image.getAttribute("src") || "").split("/").pop();
      const alt = (image.getAttribute("alt") || "image")
        .replaceAll("[", "")
        .replaceAll("]", "");
      return `![${alt}](knowledge-base-asset:${filename})`;
    },
  });
  converter.addRule("tableLineBreak", {
    filter: (node) =>
      node.nodeName === "BR" && !!(node as HTMLElement).closest("th, td"),
    replacement: () => "<br>",
  });
  let result = converter.turndown(root);
  inlineMath.forEach((source, index) => {
    result = result.replaceAll(`${prefix}${index}end`, source);
  });
  return result;
}
