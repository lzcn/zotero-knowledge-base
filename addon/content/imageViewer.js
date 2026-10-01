"use strict";
window.addEventListener("load", () => {
  document.getElementById("zettel-knowledge-base-full-image").src =
    window.arguments[0].url;
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") window.close();
});
