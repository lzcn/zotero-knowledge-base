import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { cardRefFromURL } from "./markdown";

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
  const converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    blankReplacement: (_content, node) =>
      mathMarkdown(node as HTMLElement) ??
      ((node as HTMLElement & { isBlock: boolean }).isBlock ? "\n\n" : ""),
  });
  converter.use(gfm);
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
      !!cardRefFromURL(node.getAttribute("href") || ""),
    replacement: (_content, node) => {
      const link = node as HTMLElement;
      const id = cardRefFromURL(link.getAttribute("href") || "");
      const alias = link.getAttribute("data-card-alias");
      return `[[${id}${alias ? "|" + alias.replace(/[[\]\n]/g, " ") : ""}]]`;
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
  return converter.turndown(html);
}
