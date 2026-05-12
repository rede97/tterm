import { Tab } from "./types";

export const appState = {
  tabs: new Map<string, Tab>(),
  activeTabId: null as string | null,
};
