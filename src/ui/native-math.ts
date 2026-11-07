import { normalizeRichMath } from "./text-format";

/** Extend this editor's native schema; keep math editable and stored as native math. */
export function attachHeadingMath(
  frame: Window,
  html: string,
): (() => void) | undefined {
  const core = (frame as any).wrappedJSObject?._currentEditorInstance
    ?._editorCore;
  const view = core?.view;
  const schema = view?.state.schema;
  const heading = schema?.nodes.heading;
  const math = schema?.nodes.math_inline;
  if (!heading || !math || heading.contentMatch.matchType(math)) return;
  const content = heading.spec.content;
  if (!/^\([^()]+\)\*$/.test(content))
    throw new Error("Unsupported native heading content expression");
  const previous = heading.contentMatch;
  const expanded = previous.constructor.parse(
    content.slice(0, -2) + " | math_inline)*",
    schema.nodes,
  );
  heading.spec.content = content.slice(0, -2) + " | math_inline)*";
  heading.contentMatch = expanded;
  // The initial host parse can split a formula out of a heading. Reparse the
  // saved document after extending the schema, before the user starts editing.
  core.applyExternalChanges(
    (frame as any).wrappedJSObject.JSON.parse(JSON.stringify({ html })),
    true,
  );
  normalizeRichMath(view, true);
  return () => {
    if (heading.contentMatch !== expanded) return;
    heading.contentMatch = previous;
    heading.spec.content = content;
  };
}
