import { tabManager } from "./tabmanager";
import { createElement, ChevronUp, ChevronDown, X } from "lucide";

// -- DOM --

const searchBar = document.createElement("div");
searchBar.id = "search-bar";
searchBar.style.display = "none";

const searchInput = document.createElement("input");
searchInput.type = "text";
searchInput.placeholder = "Find...";
searchBar.appendChild(searchInput);

const searchPrev = document.createElement("button");
searchPrev.appendChild(createElement(ChevronUp, { stroke: "currentColor", width: 14, height: 14 }));
searchBar.appendChild(searchPrev);

const searchNext = document.createElement("button");
searchNext.appendChild(createElement(ChevronDown, { stroke: "currentColor", width: 14, height: 14 }));
searchBar.appendChild(searchNext);

const searchResults = document.createElement("span");
searchResults.id = "search-results";
searchBar.appendChild(searchResults);

const searchClose = document.createElement("button");
searchClose.appendChild(createElement(X, { stroke: "currentColor", width: 14, height: 14 }));
searchClose.className = "search-close";
searchBar.appendChild(searchClose);

// -- functions --

function currentTab() {
  const tabId = searchInput.dataset.tabId;
  return tabId ? tabManager.get(tabId) : undefined;
}

export function closeFind() {
  // save query back to tab
  const tab = currentTab();
  if (tab) tab.searchQuery = searchInput.value;

  searchBar.style.display = "none";
  if (tab) tab.terminal.focus();
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
  const tab = tabManager.get(tabId);
  if (!tab?.searchAddon) return;

  searchInput.dataset.tabId = tabId;
  searchInput.value = tab.searchQuery;
  searchResults.textContent = "";
  searchBar.style.display = "flex";
  searchInput.focus();
}

// -- init --

export function initSearchBar() {
  const container = document.getElementById("terminal-container")!;
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



