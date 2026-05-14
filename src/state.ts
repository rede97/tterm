// Tab state is now managed by TabManager (src/tabmanager.ts)
import { tabManager } from "./tabmanager";
export { tabManager };
export const appState = tabManager;
