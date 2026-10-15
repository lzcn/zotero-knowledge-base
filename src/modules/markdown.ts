import { Marked } from "marked";
import createDOMPurify from "dompurify";
import katex from "katex";

export interface CardLink {
  ref: string;
  display: string;
}

export interface CitationReference {
  label: string;
  selectURL: string;
}
export interface CardReference {
  id: string;
  title: string;
  label?: string;
  sourceTitle?: string;
  reference: string;
  href?: string;
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

const blockMath =
  /^ {0,3}\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$(?:[ \t]*(?:\n|$))?/;

const markdown = new Marked({
  gfm: true,
  async: false,
  tokenizer: {
    lheading(src) {
      const heading = this.rules.block.lheading.exec(src);
      const start = src.search(/^ {0,3}\$\$/m);
      // Setext headings look ahead across paragraphs before startBlock is used.
      // Let the math extension consume a formula containing a standalone '='.
      if (
        heading &&
        start >= 0 &&
        start < heading[0].length &&
        blockMath.test(src.slice(start))
      )
        return;
      return false;
    },
  },
  extensions: [
    {
      name: "blockMath",
      level: "block",
      start: (src) => src.indexOf("$$"),
      tokenizer(src) {
        const match = blockMath.exec(src);
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
          display:
            alias.join("|").trim() || `[[${ref.trim().replace(/^card:/, "")}]]`,
        };
      },
      renderer(token) {
        return `<a href="${escapeHTML(token.href || `knowledge-base://card/${encodeURIComponent(token.ref)}`)}" class="zettel-link"${token.wiki ? ` title="${escapeHTML(token.wiki)}"` : ""}${token.raw.includes("|") ? ` data-card-alias="${escapeHTML(token.display)}"` : ""}>${escapeHTML(token.display)}</a>`;
      },
    },
    {
      name: "citation",
      level: "inline",
      start: (src) => src.indexOf("[@"),
      tokenizer(src) {
        const match = /^\[@([^\s\][;]+)\](?!\()/.exec(src);
        if (match) return { type: "citation", raw: match[0], key: match[1] };
      },
      renderer(token) {
        return `<a data-citation-key="${escapeHTML(token.key)}" title="@${escapeHTML(token.key)}" href="${escapeHTML(token.href || `knowledge-base://cite/${encodeURIComponent(token.key)}`)}">${escapeHTML(token.label || token.raw)}</a>`;
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

/** Zotero note URLs remain ordinary links when rendering or converting HTML. */
export function nativeNoteRefFromURL(href: string): string | null {
  return /^zotero:\/\/(?:note\/(?:u|\d+)\/[A-Z0-9]{8}|select\/(?:items|library\/items|groups\/\d+\/items)\/[A-Z0-9]{8})(?:[/?#].*)?$/i.test(
    href,
  )
    ? href
    : null;
}
/** The native editor preserves standard link titles, unlike custom data attributes. */
export function managedWikiReference(
  title: string,
  href: string,
): string | null {
  return (nativeNoteRefFromURL(href) || cardRefFromURL(href)) &&
    /^\[\[[^\][\n]+\]\]$/.test(title)
    ? title
    : null;
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
          ? cardRefFromURL(token.href) || nativeNoteRefFromURL(token.href)
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

export function parseCitationKeys(body: string): string[] {
  const keys = new Set<string>();
  markdown.walkTokens(markdown.lexer(body), (token) => {
    if (token.type === "citation") keys.add(token.key);
  });
  return [...keys];
}

/** List previews use prose rather than raw LaTeX, HTML payloads or Markdown syntax. */
export function noteSnippet(
  body: string,
  query = "",
  formula = "∑",
  resolve?: (ref: string) => CardReference | undefined,
): string {
  const tokens = markdown.lexer(body);
  markdown.walkTokens(tokens, (token) => {
    if (token.type === "inlineMath" || token.type === "blockMath") {
      token.text = /^[\p{L}\p{N}]+$/u.test(token.latex) ? token.latex : formula;
      token.type = "text";
    } else if (token.type === "wikilink") {
      token.text = token.raw.includes("|")
        ? token.display
        : resolve?.(token.ref)?.title || token.ref;
      token.type = "text";
    }
  });
  const win = Zotero.getMainWindow() as Window & {
    DOMParser: typeof DOMParser;
  };
  const doc = new win.DOMParser().parseFromString(
    markdown.parser(tokens),
    "text/html",
  );
  for (const node of Array.from(
    doc.querySelectorAll("script,style,img"),
  ) as Element[])
    node.remove();
  for (const node of Array.from(
    doc.querySelectorAll(
      '.math,[data-type="inline-math"],[data-type="block-math"]',
    ),
  ) as Element[]) {
    const source = (node.textContent || node.getAttribute("data-latex") || "")
      .replace(/^\$+|\$+$/g, "")
      .trim();
    node.textContent = /^[\p{L}\p{N}]+$/u.test(source) ? source : formula;
  }
  for (const block of Array.from(
    doc.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,pre,blockquote"),
  ) as Element[])
    block.append(" ");
  const plain = (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  const match = query
    ? plain.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
    : 0;
  const start = Math.max(0, match - 30);
  return (
    (start ? "…" : "") +
    plain.slice(start, start + 110) +
    (plain.length > start + 110 ? "…" : "")
  );
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
  resolveCitation: (key: string) => CitationReference | undefined = () =>
    undefined,
  resolveCard: (ref: string) => CardReference | undefined = () => undefined,
): string {
  const tokens = markdown.lexer(body);
  markdown.walkTokens(tokens, (token) => {
    if (token.type === "image") token.href = resolveImage(token.href);
    if (token.type === "citation") {
      const citation = resolveCitation(token.key);
      if (citation) {
        token.label = citation.label;
        token.href = citation.selectURL;
      }
    }
    if (token.type === "wikilink") {
      const target = resolveCard(token.ref);
      if (target) {
        const alias = token.raw.includes("|")
          ? token.raw.slice(2, -2).split("|").slice(1).join("|").trim()
          : "";
        token.ref = target.id;
        token.href = target.href;
        token.display =
          alias || target.label || target.title || target.reference;
        token.wiki = `[[${target.id}${alias ? `|${alias}` : ""}]]`;
      }
    } else if (token.type === "link") {
      const ref = cardRefFromURL(token.href);
      const target = ref ? resolveCard(ref) : undefined;
      if (target?.href) {
        const automatic =
          [
            ref,
            ref?.replace(/^@/, ""),
            target.id,
            target.reference,
            target.reference.replace(/^@/, ""),
            target.title,
            target.label,
            target.sourceTitle,
          ].includes(token.text) || token.text === `[[${ref}]]`;
        const alias = automatic ? "" : token.text.replace(/[\][\n]/g, " ");
        token.href = target.href;
        // Standard Markdown link titles round-trip through Zotero's link mark.
        token.title = `[[${target.id}${alias ? `|${alias}` : ""}]]`;
        if (automatic) {
          const label = target.label || target.title || target.reference;
          token.text = label;
          token.tokens = [
            { type: "text", raw: label, text: escapeHTML(label) },
          ];
        }
      }
    }
  });
  const html = markdown.parser(tokens);
  const purifier = createDOMPurify(win);
  const fragment = purifier.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP:
      /^(?:(?:https?|mailto|zotero|knowledge-base|zkb):|resource:\/\/knowledge-base-assets\/|[#/]|[^a-z]+|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
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
