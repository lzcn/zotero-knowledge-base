/** Add Markdown to the native note toolbar menu, including recreated popups. */
export function attachMarkdownMenu(
  frame: Window,
  label: string,
  onToggle: () => void,
): () => void {
  const dropdown = frame.document.querySelector(".toolbar .end .dropdown");
  if (!dropdown) return () => {};
  const selector = ".knowledge-base-markdown-option";
  const insert = () => {
    const popup = dropdown.querySelector(".popup");
    if (!popup || popup.querySelector(selector)) return;
    const button = frame.document.createElement("button");
    button.className = "option knowledge-base-markdown-option";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      (dropdown.querySelector(".toolbar-button") as HTMLElement)?.click();
      onToggle();
    });
    popup.append(button);
  };
  const Observer = (
    frame as Window & { MutationObserver: typeof MutationObserver }
  ).MutationObserver;
  const observer = new Observer(insert);
  observer.observe(dropdown, { childList: true, subtree: true });
  insert();
  return () => {
    observer.disconnect();
    dropdown.querySelector(selector)?.remove();
  };
}
