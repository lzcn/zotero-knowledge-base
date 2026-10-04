import { Marked } from "marked";
import createDOMPurify from "dompurify";
import katex from "katex";

export interface CardLink {
  ref: string;
  display: string;
}

function escapeHTML(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

const markdown = new Marked({
  gfm: true,
  async: false,
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start: (src) => src.indexOf("$$"),
      tokenizer(src) {
        const match =
          /^ {0,3}\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$[ \t]*(?:\n|$)/.exec(src);
        if (match) return { type: "blockMath", raw: match[0], latex: match[1] };
      },
      renderer: (token) =>
        `<div data-type="block-math" data-math-source="${escapeHTML(token.raw.trimEnd())}" data-latex="${escapeHTML(token.latex)}"></div>`,
    },
    {
      name: "inlineMath",
      level: "inline",
      start: (src) => src.indexOf("$"),
      tokenizer(src) {
        const match = /^\$(?!\$)((?:\\.|[^$\\\n])+?)\$(?![\d$])/.exec(src);
        if (!match || /^\s|\s$/.test(match[1])) return;
        return { type: "inlineMath", raw: match[0], latex: match[1] };
      },
      renderer: (token) =>
        `<span data-type="inline-math" data-math-source="${escapeHTML(token.raw)}" data-latex="${escapeHTML(token.latex)}"></span>`,
    },
    {
      name: "wikilink",
      level: "inline",
      start: (src) => src.indexOf("[["),
      tokenizer(src) {
        const match = /^\[\[([^\][\n]+?)\]\]/.exec(src);
        if (!match) return;
        const [ref, ...alias] = match[1].split("|");
        if (!ref.trim()) return;
        return {
          type: "wikilink",
          raw: match[0],
          ref: ref.trim().replace(/^card:/, ""),
          display: alias.join("|").trim() || ref.trim(),
        };
      },
      renderer(token) {
        return `<a href="knowledge-base://card/${encodeURIComponent(token.ref)}" class="zettel-link"${token.raw.includes("|") ? ` data-card-alias="${escapeHTML(token.display)}"` : ""}>${escapeHTML(token.display)}</a>`;
      },
    },
  ],
});

export function cardRefFromURL(href: string): string | null {
  const match = /^knowledge-base:\/\/card\/([^?#]+)$/i.exec(href);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** Both wiki links and ordinary Markdown links participate in backlinks.
 * Code blocks, inline code and escaped brackets stay literal text. */
export function parseCardLinks(body: string): CardLink[] {
  const links = new Map<string, CardLink>();
  markdown.walkTokens(markdown.lexer(body), (token) => {
    const ref =
      token.type === "wikilink"
        ? token.ref
        : token.type === "link"
          ? cardRefFromURL(token.href)
          : null;
    if (ref && !links.has(ref)) {
      links.set(ref, {
        ref,
        display:
          token.type === "wikilink"
            ? token.display
            : token.type === "link"
              ? token.text || ref
              : ref,
      });
    }
  });
  return [...links.values()];
}

/** Actual image and link references, excluding examples in code blocks. */
export function parseAssetNames(body: string): Set<string> {
  const names = new Set<string>();
  const add = (url: string) => {
    const match =
      /^(?:knowledge-base-asset:|resource:\/\/knowledge-base-assets\/)([a-zA-Z0-9-]+\.(?:png|jpg|gif|webp|avif))$/.exec(
        url,
      );
    if (match) names.add(match[1]);
  };
  markdown.walkTokens(markdown.lexer(body), (token) => {
    if (token.type === "image" || token.type === "link") add(token.href);
    if (token.type === "html") {
      for (const match of token.text.matchAll(
        /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      ))
        add(match[1] ?? match[2] ?? match[3]);
    }
  });
  return names;
}

export function renderMarkdown(
  body: string,
  win: Parameters<typeof createDOMPurify>[0],
  resolveImage: (url: string) => string = (url) => url,
  resolveTitle: (id: string) => string | undefined = () => undefined,
): string {
  const tokens = markdown.lexer(body);
  markdown.walkTokens(tokens, (token) => {
    if (token.type === "image") token.href = resolveImage(token.href);
    if (token.type === "wikilink" && !token.raw.includes("|"))
      token.display = resolveTitle(token.ref) || token.ref;
    if (token.type === "link") {
      const ref = cardRefFromURL(token.href);
      if (ref)
        token.tokens = [
          { type: "text", raw: ref, text: resolveTitle(ref) || ref },
        ];
    }
  });
  const html = markdown.parser(tokens);
  const purifier = createDOMPurify(win);
  const fragment = purifier.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|zotero|knowledge-base):|resource:\/\/knowledge-base-assets\/|[#/]|[^a-z]+|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    FORBID_TAGS: ["style", "form", "iframe"],
    FORBID_ATTR: ["style"],
  });
  // Render only after sanitizing user HTML. KaTeX generates its own layout styles
  // with trusted commands disabled; user-authored style attributes remain forbidden.
  for (const element of Array.from(
    fragment.querySelectorAll(
      '[data-type="inline-math"], [data-type="block-math"]',
    ),
  ) as HTMLElement[]) {
    element.innerHTML = katex.renderToString(
      element.getAttribute("data-latex") || "",
      {
        displayMode: element.getAttribute("data-type") === "block-math",
        throwOnError: false,
        trust: false,
        maxExpand: 1000,
      },
    );
  }
  const container = fragment.ownerDocument.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}
