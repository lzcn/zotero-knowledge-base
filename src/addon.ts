import type { LocaleService } from "./utils/locale";
import { config } from "../package.json";
import hooks from "./hooks";
import { api } from "./modules/api";
import { createZToolkit } from "./utils/ztoolkit";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    ztoolkit: ZToolkit;
    locale?: {
      current: LocaleService;
    };
  };
  public hooks: typeof hooks;
  public api: typeof api;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = new Proxy(api, {
      get: (target, key, receiver) => {
        const method = Reflect.get(target, key, receiver);
        if (typeof method !== "function") return method;
        return (...args: unknown[]) => {
          if (!this.data.alive && key !== "releaseImageDraft")
            throw new Error("Knowledge Base is shutting down.");
          return Reflect.apply(method, target, args);
        };
      },
    });
  }
}

export default Addon;
