/* global Zotero */
window.addEventListener("DOMContentLoaded", async () => {
  const api = Zotero.ZoteroKnowledgeBase.api;
  const { token } = /** @type {{token: string}} */ (window.arguments[0]);
  const title = document.getElementById("reading-title");
  const status = document.getElementById("reading-status");
  const content = document.getElementById("reading-content");
  const input = /** @type {HTMLTextAreaElement} */ (
    document.getElementById("reading-draft")
  );
  const preview = document.getElementById("reading-preview");
  const toggle = /** @type {HTMLButtonElement} */ (
    document.getElementById("reading-toggle")
  );
  const save = /** @type {HTMLButtonElement} */ (
    document.getElementById("reading-save")
  );
  const close = document.getElementById("reading-close");
  let working = true;
  let reading = false;
  let applied = false;
  title.textContent = api.loc("codex-read-paper");
  document.title = title.textContent;
  document.getElementById("reading-help").textContent =
    api.loc("codex-reading-help");
  input.setAttribute("aria-label", api.loc("codex-draft"));
  close.textContent = api.loc("codex-cancel");
  save.textContent = api.loc("codex-save-note");
  toggle.textContent = api.loc("codex-preview");
  close.addEventListener("click", () => {
    api.closePaperReading(token);
    window.close();
  });
  window.addEventListener("unload", () => api.closePaperReading(token), {
    once: true,
  });
  const error = (failure) => {
    status.textContent = api.readingErrorMessage(failure);
    status.setAttribute("data-error", "true");
  };
  toggle.addEventListener("click", async () => {
    try {
      if (!reading) {
        window.ZoteroKnowledgeBaseMarkdown.render(preview, input.value);
        if (window.closed) return;
      }
      reading = !reading;
      input.hidden = reading;
      preview.hidden = !reading;
      toggle.textContent = api.loc(reading ? "codex-edit" : "codex-preview");
    } catch (failure) {
      error(failure);
    }
  });
  save.addEventListener("click", async () => {
    if (working || applied) return;
    working = true;
    save.disabled = true;
    close.textContent = api.loc("codex-cancel");
    status.removeAttribute("data-error");
    status.textContent = api.loc("codex-saving");
    try {
      const id = await api.applyPaperReading(token, input.value);
      if (window.closed) return;
      applied = true;
      api.openEditor({ zettelId: id });
      window.close();
    } catch (failure) {
      if (!window.closed) {
        error(failure);
        save.disabled = false;
      }
    } finally {
      working = false;
      close.textContent = api.loc("codex-close");
    }
  });
  try {
    const draft = await api.generatePaperReading(token, (phase) => {
      if (!window.closed) status.textContent = api.loc(phase);
    });
    if (window.closed) return;
    title.textContent = draft.title;
    input.value = draft.markdown;
    content.hidden = false;
    toggle.hidden = false;
    save.disabled = false;
    status.textContent = api.loc(
      draft.truncated ? "codex-ready-partial" : "codex-ready",
      { pages: draft.pages, total: draft.totalPages },
    );
    if (draft.hasExisting) {
      save.textContent = api.loc("codex-append-note");
      status.textContent += " " + api.loc("codex-preserve-existing");
    }
    input.focus();
  } catch (failure) {
    if (!window.closed) error(failure);
  } finally {
    working = false;
    if (!window.closed) close.textContent = api.loc("codex-close");
  }
});
