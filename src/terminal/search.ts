import { ChevronDown, ChevronUp, createElement, X } from "lucide";
import { DOM_ID } from "../core/dom-ids";
import { mustGetById } from "../ui/dom";
import type { TerminalTab } from "./tab";

// ---- Injected handlers (bound by wiring.ts — no tabmanager import here) ----

export interface SearchHandlers {
  getTab: (tabId: string) => TerminalTab | undefined;
}

let handlers: SearchHandlers;

export function setSearchHandlers(h: SearchHandlers): void {
  handlers = h;
}

// -- DOM --

const searchBar = document.createElement("div");
searchBar.id = "search-bar";
searchBar.style.display = "none";

const searchInput = document.createElement("input");
searchInput.type = "text";
searchInput.placeholder = "Find...";
searchBar.appendChild(searchInput);

const searchPrev = document.createElement("button");
searchPrev.setAttribute("aria-label", "Previous match");
searchPrev.title = "Previous match";
searchPrev.appendChild(createElement(ChevronUp, { stroke: "currentColor", width: 14, height: 14 }));
searchBar.appendChild(searchPrev);

const searchNext = document.createElement("button");
searchNext.setAttribute("aria-label", "Next match");
searchNext.title = "Next match";
searchNext.appendChild(
  createElement(ChevronDown, { stroke: "currentColor", width: 14, height: 14 }),
);
searchBar.appendChild(searchNext);

const searchResults = document.createElement("span");
searchResults.id = "search-results";
searchBar.appendChild(searchResults);

const searchClose = document.createElement("button");
searchClose.setAttribute("aria-label", "Close search");
searchClose.title = "Close search";
searchClose.appendChild(createElement(X, { stroke: "currentColor", width: 14, height: 14 }));
searchClose.className = "search-close";
searchBar.appendChild(searchClose);

// -- functions --

function currentTab() {
  const tabId = searchInput.dataset.tabId;
  return tabId ? handlers.getTab(tabId) : undefined;
}

export function closeFind() {
  // save query back to tab
  const tab = currentTab();
  if (tab) tab.searchQuery = searchInput.value;

  searchBar.style.display = "none";
  if (tab) tab.terminal.focus();
}

/// Called when a tab closes: hide the find bar if it was bound to that
/// tab — otherwise it floats over the next tab with dead find actions.
export function closeFindForTab(tabId: string): void {
  if (searchInput.dataset.tabId === tabId) {
    searchInput.dataset.tabId = "";
    searchBar.style.display = "none";
  }
}

function doFindNext() {
  const tab = currentTab();
  if (!tab?.searchAddon || !searchInput.value) return;
  const found = tab.searchAddon.findNext(searchInput.value);
  searchResults.textContent = found ? "" : "No results";
}

function doFindPrev() {
  const tab = currentTab();
  if (!tab?.searchAddon || !searchInput.value) return;
  const found = tab.searchAddon.findPrevious(searchInput.value);
  searchResults.textContent = found ? "" : "No results";
}

export function openFind(tabId: string) {
  const tab = handlers.getTab(tabId);
  if (!tab?.searchAddon) return;

  searchInput.dataset.tabId = tabId;
  searchInput.value = tab.searchQuery;
  searchResults.textContent = "";
  searchBar.style.display = "flex";
  searchInput.focus();
}

// -- init --

export function initSearchBar() {
  const container = mustGetById(DOM_ID.terminalContainer);
  container.appendChild(searchBar);

  searchInput.addEventListener("input", () => {
    const tab = currentTab();
    if (tab) tab.searchQuery = searchInput.value;
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) doFindPrev();
      else doFindNext();
    } else if (e.key === "Escape") {
      closeFind();
    }
  });

  searchNext.addEventListener("click", doFindNext);
  searchPrev.addEventListener("click", doFindPrev);
  searchClose.addEventListener("click", closeFind);
}
