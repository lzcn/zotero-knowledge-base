import type {
  KnowledgeBaseAPI,
  EditorArgs,
  ManagerArgs,
  AnnotationPickerArgs,
} from "../src/modules/api";
declare global {
  namespace Zotero {
    const ZoteroKnowledgeBase: { api: KnowledgeBaseAPI };
  }
  interface Window {
    knowledgeBaseCardId?: string | null;
    knowledgeBaseDraftId?: string;
    knowledgeBaseStopping?: boolean;
    knowledgeBaseFlushDraft?: () => Promise<void>;
    KnowledgeBaseRichEditor: {
      create(
        options: import("../src/ui/rich-editor").RichEditorOptions,
      ): import("../src/ui/rich-editor").RichEditorController;
    };
    KnowledgeBaseEditing: {
      formatEdit: typeof import("../src/ui/editor-formatting").formatEdit;
      continueList: typeof import("../src/ui/editor-formatting").continueList;
    };
    Zotero: typeof Zotero;
    arguments: unknown[];
    DOMParser: typeof DOMParser;
    ZoteroKnowledgeBaseMarkdown: {
      render(container: Element, body: string): void;
      identity(container: Element, id: string, title: string): void;
      renderFamily(
        container: Element,
        family: import("../src/modules/hierarchy").CardFamily,
        api: KnowledgeBaseAPI,
      ): void;
    };
    ZoteroKnowledgeBase_selectZettel?: (id: string) => void;
    ZoteroKnowledgeBase_showGraph?: (id?: string) => void;
  }
}

export interface EditorElements {
  "knowledge-base-rich-frame": HTMLIFrameElement;
  "knowledge-base-command-open": HTMLButtonElement;
  "knowledge-base-command-menu": HTMLDivElement;
  "knowledge-base-command-search": HTMLInputElement;
  "knowledge-base-command-list": HTMLDivElement;
  "knowledge-base-parent-label": HTMLLabelElement;
  "knowledge-base-parent-display": HTMLButtonElement;
  "knowledge-base-parent-search": HTMLInputElement;
  "knowledge-base-parent-results": HTMLUListElement;
  "knowledge-base-parent-root": HTMLButtonElement;
  "knowledge-base-editor-family": HTMLDivElement;
  "knowledge-base-editor": Element;
  "knowledge-base-editor-root": HTMLElementTagNameMap["div"];
  "knowledge-base-editor-toolbar": HTMLElementTagNameMap["div"];
  "knowledge-base-src-label": HTMLElementTagNameMap["span"];
  "knowledge-base-src-display": HTMLElementTagNameMap["span"];
  "knowledge-base-src-pick": HTMLElementTagNameMap["button"];
  "knowledge-base-src-jump": HTMLElementTagNameMap["button"];
  "knowledge-base-src-anno": HTMLElementTagNameMap["button"];
  "knowledge-base-src-clear": HTMLElementTagNameMap["button"];
  "knowledge-base-src-drop": HTMLElementTagNameMap["div"];
  "knowledge-base-src-search": HTMLElementTagNameMap["input"];
  "knowledge-base-src-selected": HTMLElementTagNameMap["button"];
  "knowledge-base-src-status": HTMLElementTagNameMap["div"];
  "knowledge-base-src-results": HTMLElementTagNameMap["ul"];
  "knowledge-base-editor-title": HTMLElementTagNameMap["input"];
  "knowledge-base-markdown-toolbar": HTMLElementTagNameMap["div"];
  "knowledge-base-link-pick": HTMLElementTagNameMap["button"];
  "knowledge-base-url-insert": HTMLElementTagNameMap["button"];
  "knowledge-base-image-insert": HTMLElementTagNameMap["button"];
  "knowledge-base-src-insert": HTMLElementTagNameMap["button"];
  "knowledge-base-editor-mode": XULMenuListElement;
  "knowledge-base-link-drop": HTMLElementTagNameMap["div"];
  "knowledge-base-link-search": HTMLElementTagNameMap["input"];
  "knowledge-base-link-status": HTMLElementTagNameMap["div"];
  "knowledge-base-link-results": HTMLElementTagNameMap["ul"];
  "knowledge-base-editor-content": HTMLElementTagNameMap["div"];
  "knowledge-base-editor-workspace": HTMLElementTagNameMap["div"];
  "knowledge-base-editor-body": HTMLElementTagNameMap["textarea"];
  "knowledge-base-editor-preview": HTMLElementTagNameMap["div"];
  "knowledge-base-editor-relations-summary": HTMLElementTagNameMap["summary"];
  "knowledge-base-editor-relations": HTMLElementTagNameMap["aside"];
  "knowledge-base-editor-graph": HTMLElementTagNameMap["button"];
  "knowledge-base-editor-outgoing-label": HTMLElementTagNameMap["html"];
  "knowledge-base-editor-outgoing": HTMLElementTagNameMap["ul"];
  "knowledge-base-editor-backlinks-label": HTMLElementTagNameMap["html"];
  "knowledge-base-editor-backlinks": HTMLElementTagNameMap["ul"];
  "knowledge-base-editor-footer": HTMLElementTagNameMap["footer"];
  "knowledge-base-editor-status": HTMLElementTagNameMap["span"];
  "knowledge-base-editor-cancel": HTMLElementTagNameMap["button"];
  "knowledge-base-editor-save": HTMLElementTagNameMap["button"];
  "knowledge-base-anno-layer": HTMLElementTagNameMap["div"];
  "knowledge-base-anno-box": HTMLElementTagNameMap["div"];
  "knowledge-base-anno-head": HTMLElementTagNameMap["html"];
  "knowledge-base-anno-list": HTMLElementTagNameMap["ul"];
  "knowledge-base-anno-empty": HTMLElementTagNameMap["div"];
  "knowledge-base-anno-cancel": HTMLElementTagNameMap["button"];
  "knowledge-base-anno-insert": HTMLElementTagNameMap["button"];
}

export interface ManagerElements {
  "knowledge-base-entries": HTMLInputElement;
  "knowledge-base-entries-label": HTMLSpanElement;
  "knowledge-base-family": HTMLDivElement;
  "knowledge-base-manager": Element;
  "knowledge-base-root": HTMLElementTagNameMap["div"];
  "knowledge-base-toolbar": HTMLElementTagNameMap["header"];
  "knowledge-base-btn-new": HTMLElementTagNameMap["button"];
  "knowledge-base-btn-graph": HTMLElementTagNameMap["button"];
  "knowledge-base-search": HTMLElementTagNameMap["input"];
  "knowledge-base-stats": HTMLElementTagNameMap["span"];
  "knowledge-base-main": HTMLElementTagNameMap["main"];
  "knowledge-base-list-pane": HTMLElementTagNameMap["section"];
  "knowledge-base-list": HTMLElementTagNameMap["ul"];
  "knowledge-base-splitter": HTMLElementTagNameMap["div"];
  "knowledge-base-detail-pane": HTMLElementTagNameMap["section"];
  "knowledge-base-detail-empty": HTMLElementTagNameMap["div"];
  "knowledge-base-detail": HTMLElementTagNameMap["div"];
  "knowledge-base-detail-title": HTMLElementTagNameMap["html"];
  "knowledge-base-detail-id": HTMLDivElement;
  "knowledge-base-btn-child": HTMLButtonElement;
  "knowledge-base-detail-meta": HTMLElementTagNameMap["div"];
  "knowledge-base-detail-source": HTMLElementTagNameMap["div"];
  "knowledge-base-outgoing-head": HTMLElementTagNameMap["html"];
  "knowledge-base-outgoing": HTMLElementTagNameMap["div"];
  "knowledge-base-backlinks-head": HTMLElementTagNameMap["html"];
  "knowledge-base-backlinks": HTMLElementTagNameMap["ul"];
  "knowledge-base-preview-head": HTMLElementTagNameMap["html"];
  "knowledge-base-preview": HTMLElementTagNameMap["div"];
  "knowledge-base-btn-edit": HTMLElementTagNameMap["button"];
  "knowledge-base-btn-local-graph": HTMLElementTagNameMap["button"];
  "knowledge-base-btn-delete": HTMLElementTagNameMap["button"];
  "knowledge-base-unresolved": HTMLElementTagNameMap["div"];
  "knowledge-base-unresolved-head": HTMLElementTagNameMap["html"];
  "knowledge-base-unresolved-list": HTMLElementTagNameMap["ul"];
  "knowledge-base-error": HTMLElementTagNameMap["div"];
}

export interface AnnotationsElements {
  "knowledge-base-annotations": Element;
  "knowledge-base-pick-root": HTMLElementTagNameMap["div"];
  "knowledge-base-pick-toolbar": HTMLElementTagNameMap["header"];
  "knowledge-base-pick-head": HTMLElementTagNameMap["div"];
  "knowledge-base-pick-title": HTMLElementTagNameMap["html"];
  "knowledge-base-pick-source": HTMLElementTagNameMap["div"];
  "knowledge-base-pick-toggle": HTMLElementTagNameMap["button"];
  "knowledge-base-pick-rows": HTMLElementTagNameMap["ul"];
  "knowledge-base-pick-empty": HTMLElementTagNameMap["div"];
  "knowledge-base-pick-footer": HTMLElementTagNameMap["footer"];
  "knowledge-base-pick-status": HTMLElementTagNameMap["span"];
  "knowledge-base-pick-close": HTMLElementTagNameMap["button"];
  "knowledge-base-pick-create": HTMLElementTagNameMap["button"];
}

export interface GraphElements {
  "graph-display-menu": XULMenuPopupElement;
  "knowledge-base-graph": Element;
  "knowledge-base-graph-root": HTMLElementTagNameMap["div"];
  "knowledge-base-graph-toolbar": HTMLElementTagNameMap["header"];
  "graph-search": HTMLElementTagNameMap["input"];
  "graph-fit": HTMLElementTagNameMap["button"];
  "graph-refresh": HTMLElementTagNameMap["button"];
  "graph-stats": HTMLElementTagNameMap["span"];
  "knowledge-base-graph-main": HTMLElementTagNameMap["main"];
  "graph-canvas": HTMLElementTagNameMap["div"];
  "graph-svg": SVGSVGElement;
  "graph-empty": HTMLElementTagNameMap["div"];
  "graph-inspector": HTMLElementTagNameMap["aside"];
  "graph-selection": HTMLElementTagNameMap["div"];
  "graph-node-title": HTMLElementTagNameMap["html"];
  "graph-node-kind": HTMLElementTagNameMap["div"];
  "graph-node-snippet": HTMLElementTagNameMap["div"];
  "graph-node-open": HTMLElementTagNameMap["button"];
  "graph-connections-title": HTMLElementTagNameMap["html"];
  "graph-connections": HTMLElementTagNameMap["div"];
  "graph-legend": HTMLElementTagNameMap["footer"];
  "graph-legend-cards": HTMLElementTagNameMap["span"];
  "graph-legend-sources": HTMLElementTagNameMap["span"];
  "graph-legend-unresolved": HTMLElementTagNameMap["span"];
  "graph-error": HTMLElementTagNameMap["span"];
}
