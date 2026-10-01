import { Marked } from "marked";
import createDOMPurify from "dompurify";

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
          ref: ref.trim(),
          display: alias.join("|").trim() || ref.trim(),
        };
      },
      renderer(token) {
        return `<a href="zkb://zettel/${encodeURIComponent(token.ref)}" class="zettel-link">${escapeHTML(token.display)}</a>`;
      },
    },
  ],
});

export function cardRefFromURL(href: string): string | null {
  const match = /^zkb:\/\/zettel\/([^?#]+)$/i.exec(href);
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

export function renderMarkdown(
  body: string,
  win: Parameters<typeof createDOMPurify>[0],
  resolveImage: (url: string) => string = (url) => url,
): string {
  const tokens = markdown.lexer(body);
  markdown.walkTokens(tokens, (token) => {
    if (token.type === "image") token.href = resolveImage(token.href);
  });
  const html = markdown.parser(tokens);
  return createDOMPurify(win).sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|zotero|zkb):|resource:\/\/zettel-knowledge-base-assets\/|[#/]|[^a-z]+|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
    FORBID_TAGS: ["style", "form", "iframe"],
    FORBID_ATTR: ["style"],
  });
}
