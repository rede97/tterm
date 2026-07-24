import { createElement, Terminal as TerminalIcon, Globe, Cable, FlaskConical } from "lucide";
import { configStore } from "../core/store";
import { hostProp } from "../core/common";
import { loadSerialPorts } from "../config/wt-profiles";
import { tabManager } from "./tabmanager";

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

function createMenuItem(iconFn: any, label: string, detail: string, onClick: () => void, subline = ""): HTMLElement {
  const item = document.createElement("div");
  item.className = "profile-item";

  const iconWrap = document.createElement("span");
  iconWrap.className = "item-icon";
  iconWrap.appendChild(createElement(iconFn, { stroke: "currentColor", width: 14, height: 14 }));
  item.appendChild(iconWrap);

  if (subline) {
    const textWrap = document.createElement("div");
    textWrap.className = "item-text";
    const labelEl = document.createElement("span");
    labelEl.className = "item-label";
    labelEl.textContent = label;
    textWrap.appendChild(labelEl);
    const subEl = document.createElement("span");
    subEl.className = "item-subline";
    subEl.textContent = subline;
    textWrap.appendChild(subEl);
    item.appendChild(textWrap);
  } else {
    const labelEl = document.createElement("span");
    labelEl.className = "item-label";
    labelEl.textContent = label;
    item.appendChild(labelEl);
  }

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

  const localProfiles = configStore.get("localProfiles");
  const hiddenProfiles = configStore.get("hiddenProfiles");
  const sshHosts = configStore.get("sshHosts");
  const hiddenSshHosts = configStore.get("hiddenSshHosts");
  const serialPorts = configStore.get("serialPorts");

  const localCol = document.createElement("div");
  localCol.className = "profile-col";

  const localTitle = document.createElement("div");
  localTitle.className = "profile-section-title";
  localTitle.textContent = "Local";
  localCol.appendChild(localTitle);

  if (localProfiles.length > 0) {
    for (const p of localProfiles) {
      if (hiddenProfiles.includes(p.name)) continue;
      localCol.appendChild(createMenuItem(TerminalIcon, p.name, "", () => tabManager.createLocalTab(p.command, p.name)));
    }
  } else {
    localCol.appendChild(createMenuItem(TerminalIcon, "Default shell", "", () => tabManager.createLocalTab()));
  }

  if (import.meta.env.DEV) {
    localCol.appendChild(createMenuItem(FlaskConical, "Demo TTY", "debug", () => tabManager.createDemoTab()));
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
      if (hiddenSshHosts.includes(host.name)) continue;
      const detail = `${hostProp(host, "user") || "root"}@${hostProp(host, "hostname") || host.name}:${hostProp(host, "port") || "22"}`;
      sshCol.appendChild(createMenuItem(Globe, host.name, detail, () => tabManager.createSshTab(host)));
    }
    profileMenu.appendChild(sshCol);
  }

  if (serialPorts.length > 0) {
    const serialCol = document.createElement("div");
    serialCol.className = "profile-col";

    const serialTitle = document.createElement("div");
    serialTitle.className = "profile-section-title";
    serialTitle.textContent = "Serial";
    serialCol.appendChild(serialTitle);

    for (const port of serialPorts) {
      const ids = port.vid && port.pid ? `${port.vid}:${port.pid}` : "";
      const subline = [port.manufacturer, ids].filter(Boolean).join(" ");
      const friendly = port.product || port.driver;
      const label = friendly ? `${port.name} · ${friendly}` : port.name;
      serialCol.appendChild(createMenuItem(Cable, label, "", () => tabManager.createSerialTab(port), subline));
    }
    profileMenu.appendChild(serialCol);
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
      loadSerialPorts().then(ports => {
        configStore.set({ serialPorts: ports });
        if (profileMenu.classList.contains("open")) {
          populateMenu();
          flipMenu();
        }
      });
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
