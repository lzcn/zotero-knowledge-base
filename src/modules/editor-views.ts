import { config } from "../../package.json";
import { getDOMWindow } from "../utils/dom";
import type { EditorArgs } from "./api";

type EditorWindow = Window & {
  knowledgeBaseCardId?: string;
};

const windows = new Map<string, EditorWindow>();
const stoppingWrites = new WeakMap<
  Window,
  { document: Document; writing: Promise<void> }
>();

function report(error: unknown): void {
  Zotero.logError(error instanceof Error ? error : new Error(String(error)));
}

/** Reuse an editor even while its chrome document is still loading. */
export function openEditorWindow(args: EditorArgs): void {
  const key = args.zettelId ? `note:${args.zettelId}` : null;
  const focus = (editor: EditorWindow) => {
    editor.focus();
    if (!args.editTags) return;
    const edit = () => {
      void editor.knowledgeBaseEditTags?.().catch(report);
    };
    if (editor.knowledgeBaseEditTags) edit();
    else editor.addEventListener("load", edit, { once: true });
  };
  const pending = key ? windows.get(key) : null;
  if (pending && !pending.closed) {
    focus(pending);
    return;
  }
  for (const win of Services.wm.getEnumerator("knowledge-base:editor")) {
    const editor = win as unknown as EditorWindow;
    if (
      !editor.closed &&
      args.zettelId &&
      editor.knowledgeBaseCardId === args.zettelId
    ) {
      focus(editor);
      return;
    }
  }
  const opened = getDOMWindow().openDialog(
    `chrome://${config.addonRef}/content/editor.xhtml`,
    "_blank",
    "chrome,centerscreen,resizable=yes,width=1000,height=720",
    args,
  ) as EditorWindow | null;
  if (!opened) throw new Error("Could not open note editor");
  if (key) {
    windows.set(key, opened);
    opened.addEventListener(
      "unload",
      () => {
        if (windows.get(key) === opened) windows.delete(key);
      },
      { once: true },
    );
  }
  if (args.zettelId) opened.knowledgeBaseCardId = args.zettelId;
}

/** Finish direct note saves before disposing any editor host. */
export function stopEditorView(
  editor: Window | null | undefined,
): Promise<void> | undefined {
  if (!editor) return;
  const document = editor.document;
  const existing = stoppingWrites.get(editor);
  if (existing && existing.document === document) return existing.writing;
  if (editor.knowledgeBaseStopping) return;
  const writing = (async () => {
    try {
      await editor.knowledgeBaseSaveBeforeStop?.();
    } catch (error) {
      report(error);
    } finally {
      if (editor.document === document) {
        editor.knowledgeBaseStopping = true;
        try {
          editor.knowledgeBaseStopEditor?.();
        } catch (error) {
          report(error);
        }
      }
    }
  })();
  stoppingWrites.set(editor, { document, writing });
  return writing;
}

/** All hosts use the document's save/cancellation rules before navigation. */
export async function prepareEditorView(
  editor: Window | null | undefined,
): Promise<boolean> {
  if (!editor) return true;
  await editor.knowledgeBaseReady?.();
  if (editor.knowledgeBaseStopping) return false;
  if (editor.knowledgeBasePrepareNavigation)
    return editor.knowledgeBasePrepareNavigation();
  return editor.save ? editor.save(false) : true;
}

/** Keep the document alive until its pending note save has completed. */
export async function closeEditorView(
  editor: Window | null | undefined,
  dispose: () => void,
): Promise<void> {
  try {
    await stopEditorView(editor);
  } finally {
    dispose();
  }
}
