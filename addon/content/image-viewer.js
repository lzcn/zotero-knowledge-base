"use strict";
window.addEventListener("load", () => {
  const image = /** @type {HTMLImageElement} */ (
    document.getElementById("knowledge-base-full-image")
  );
  const args = /** @type {{url: string}} */ (window.arguments[0]);
  image.src = args.url;
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.close();
});
