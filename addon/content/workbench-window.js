"use strict";

const workbench =
  /** @type {{ load(win: Window): void; stop(): void; closed(): void }} */ (
    window.arguments[0]
  );
window.addEventListener("load", () => workbench.load(window), { once: true });
window.addEventListener("beforeunload", () => workbench.stop(), { once: true });
window.addEventListener(
  "unload",
  () => {
    workbench.stop();
    workbench.closed();
  },
  { once: true },
);
