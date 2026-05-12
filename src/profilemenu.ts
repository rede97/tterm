import { createElement, Terminal as TerminalIcon, Globe } from "lucide";
import { sshHosts, localProfiles } from "./profiles";
import { createTab, createSshTab, createCustomTab } from "./tabs";

const menuBtn = document.getElementById("new-tab-menu-btn")!;

const profileMenu = document.createElement("div");
profileMenu.id = "profile-menu";
profileMenu.className = "profile-menu";
document.body.appendChild(profileMenu);

function positionMenu() {
  const rect = menuBtn.getBoundingClientRect();
  profileMenu.style.left = (rect.left + rect.width / 2) + "px";
  profileMenu.style.top = rect.bottom + "px";
}

function flipMenu() {
  const btnRect = menuBtn.getBoundingClientRect();
  const mw = profileMenu.offsetWidth;
  const mh = profileMenu.offsetHeight;
  const pad = 4;

  let left = btnRect.left + btnRect.width / 2 - mw / 2;
  let top = btnRect.bottom;

  if (left < pad) left = pad;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - pad;
  if (top + mh > window.innerHeight) top = Math.max(pad, btnRect.top - mh);

  profileMenu.style.left = left + "px";
  profileMenu.style.top = top + "px";
}

function createMenuItem(iconFn: any, label: string, detail: string, onClick: () => void): HTMLElement {
  const item = document.createElement("div");
  item.className = "profile-item";

  const iconWrap = document.createElement("span");
  iconWrap.className = "item-icon";
  iconWrap.appendChild(createElement(iconFn, { stroke: "currentColor", width: 14, height: 14 }));
  item.appendChild(iconWrap);

  const labelEl = document.createElement("span");
  labelEl.className = "item-label";
  labelEl.textContent = label;
  item.appendChild(labelEl);

  if (detail) {
    const detailEl = document.createElement("span");
    detailEl.className = "item-detail";
    detailEl.textContent = detail;
    item.appendChild(detailEl);
  }

  item.addEventListener("click", () => {
    profileMenu.classList.remove("open");
    onClick();
  });

  return item;
}

function populateMenu() {
  profileMenu.innerHTML = "";

  const localCol = document.createElement("div");
  localCol.className = "profile-col";

  const localTitle = document.createElement("div");
  localTitle.className = "profile-section-title";
  localTitle.textContent = "Local";
  localCol.appendChild(localTitle);

  if (localProfiles.length > 0) {
    for (const p of localProfiles) {
      localCol.appendChild(createMenuItem(TerminalIcon, p.name, "", () => createCustomTab(p.command, p.name)));
    }
  } else {
    localCol.appendChild(createMenuItem(TerminalIcon, "Default shell", "", () => createTab()));
  }
  profileMenu.appendChild(localCol);

  if (sshHosts.length > 0) {
    const sshCol = document.createElement("div");
    sshCol.className = "profile-col";

    const sshTitle = document.createElement("div");
    sshTitle.className = "profile-section-title";
    sshTitle.textContent = "SSH";
    sshCol.appendChild(sshTitle);

    for (const host of sshHosts) {
      const detail = `${host.user}@${host.hostname}:${host.port}`;
      sshCol.appendChild(createMenuItem(Globe, host.name, detail, () => createSshTab(host)));
    }
    profileMenu.appendChild(sshCol);
  }
}

export function initProfileMenu() {
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (profileMenu.classList.contains("open")) {
      profileMenu.classList.remove("open");
    } else {
      populateMenu();
      positionMenu();
      profileMenu.classList.add("open");
      requestAnimationFrame(() => flipMenu());
    }
  });

  document.addEventListener("click", (e) => {
    if (profileMenu.classList.contains("open") && !profileMenu.contains(e.target as Node) && e.target !== menuBtn) {
      profileMenu.classList.remove("open");
    }
  });

  window.addEventListener("resize", () => {
    if (profileMenu.classList.contains("open")) {
      flipMenu();
    }
  });
}
