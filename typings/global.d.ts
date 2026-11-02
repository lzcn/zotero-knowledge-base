declare const _globalThis: {
  Zotero: _ZoteroTypes.Zotero;
  ztoolkit: ZToolkit;
  addon: typeof addon;
};

declare type ZToolkit = ReturnType<
  typeof import("../src/utils/ztoolkit").createZToolkit
>;

declare const ztoolkit: ZToolkit;

declare const rootURI: string;

declare const addon: import("../src/addon").default;

declare const __env__: "production" | "development";

declare namespace Zotero {
  interface Item {
    isInTrash(): boolean;
  }
}

declare const libraryRuntime: {
  readonly state: "idle" | "ready" | "stopped";
  start(): Promise<void>;
  wakeIndex(): void;
  openTagManager(win: Window, libraryID: number): Window;
  getStatus(): Record<string, any> | null;
  getItemPaneCallbacks(): Record<string, (props: any) => any>;
  setItemPaneID(id?: string): void;
  stop(): void;
  close(appShutdown?: boolean): Promise<void>;
  onWindowLoad(win: Window): void;
  onWindowUnload(win: Window): void;
};
