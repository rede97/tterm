// Static element ids declared in index.html — the single place this
// cross-module string contract lives. Rename an id here AND in index.html
// together. Panel-internal ids (#set-*, .kb-*, .qp-*) stay local to their
// modules; this table is only for the app chrome.

export const DOM_ID = {
  tabBar: "tab-bar",
  settingsBtn: "settings-btn",
  tabs: "tabs",
  newTabGroup: "new-tab-group",
  newTab: "new-tab",
  newTabMenuBtn: "new-tab-menu-btn",
  dragSpacer: "drag-spacer",
  windowControls: "window-controls",
  quickActions: "quick-actions",
  quickStatus: "quick-status",
  btnParkTray: "btn-park-tray",
  btnMinimize: "btn-minimize",
  btnMaximize: "btn-maximize",
  btnClose: "btn-close",
  terminalContainer: "terminal-container",
} as const;
