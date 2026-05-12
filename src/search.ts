import { appState } from "./state";

// ── DOM ──────────────────────────────────────────────────────────────

const searchBar = document.createElement("div");
searchBar.id = "search-bar";
searchBar.style.display = "none";

const searchInput = document.createElement("input");
searchInput.type = "text";
searchInput.placeholder = "查找...";
searchBar.appendChild(searchInput);

const searchPrev = document.createElement("button");
searchPrev.textContent = "▲";
searchBar.appendChild(searchPrev);

const searchNext = document.createElement("button");
searchNext.textContent = "▼";
searchBar.appendChild(searchNext);

const searchResults = document.createElement("span");
searchResults.id = "search-results";
searchBar.appendChild(searchResults);

const searchClose = document.createElement("button");
searchClose.textContent = "✕";
searchClose.className = "search-close";
searchBar.appendChild(searchClose);

// ── functions ────────────────────────────────────────────────────────

export function closeFind() {
  searchBar.style.display = "none";
  const tabId = searchInput.dataset.tabId;
  if (tabId) {
    const tab = appState.tabs.get(tabId);
    if (tab) tab.terminal.focus();
  }
}

function doFindNext() {
  const tabId = searchInput.dataset.tabId;
  const tab = appState.tabs.get(tabId || "");
  if (!tab?.searchAddon || !searchInput.value) return;
  const found = tab.searchAddon.findNext(searchInput.value);
  searchResults.textContent = found ? "" : "无结果";
}

function doFindPrev() {
  const tabId = searchInput.dataset.tabId;
  const tab = appState.tabs.get(tabId || "");
  if (!tab?.searchAddon || !searchInput.value) return;
  const found = tab.searchAddon.findPrevious(searchInput.value);
  searchResults.textContent = found ? "" : "无结果";
}

export function openFind(tabId: string) {
  const tab = appState.tabs.get(tabId);
  if (!tab?.searchAddon) return;

  searchInput.dataset.tabId = tabId;
  searchInput.value = "";
  searchResults.textContent = "";
  searchBar.style.display = "flex";
  searchInput.focus();
}

// ── init ─────────────────────────────────────────────────────────────

export function initSearchBar() {
  const container = document.getElementById("terminal-container")!;
  container.appendChild(searchBar);

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
