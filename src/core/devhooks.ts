// Dev/E2E introspection hook — `window.__tterm`, dev builds only.
// Typed here once instead of `(window as any)` at every assignment.
//
// NOTE: `tabs` must stay a getter — _syncTabOrderFromDom reassigns the Map
// on drag reorder, a captured reference would go stale.

import type { TerminalTab } from "../terminal/tab";
import type { TabManager } from "../terminal/tabmanager";
import type { ImeAnchorDump, ImeAnchorPolicy } from "../util/imeanchor";
import type { ConfigStore } from "./store";

export interface TtermDevHooks {
  readonly tabs: Map<string, TerminalTab>;
  readonly mgr: TabManager;
  readonly config: ConfigStore;
  setImeMirrorMode?: (mode: "auto" | "always" | "off") => void;
  getImeMirrorMode?: () => string;
  imeTrace?: (on: boolean) => void;
  imeDebug?: (flags: { suppress?: boolean; reanchor?: boolean }) => void;
  imeDump?: () => ImeAnchorDump | null;
  imeSetPolicy?: (policy: ImeAnchorPolicy | null) => void;
}

declare global {
  interface Window {
    __tterm?: TtermDevHooks;
  }
}
