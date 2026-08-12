// Settings shell — sidebar navigation, footer (Apply/Revert), panel routing.
// Delegates panel content to settings-*.ts modules.

import { loadAllWtData } from "../config/wt-profiles";
import { configStore } from "../core/store";
import { parseFontFamily, updateFontStack } from "../util/fontconfig";
import { setWtThemes } from "../util/themes";
import {
  collectAppearanceSettings,
  createAppearancePanel,
  refreshAppearancePanel,
  renderThemeGallery,
} from "./appearance";
import { collectGeneralSettings, createGeneralPanel, refreshGeneralPanel } from "./general";
import { collectProfileSettings, createProfilePanel, refreshProfilePanel } from "./profile";
import { collectSerialSettings, createSerialPanel, refreshSerialPanel } from "./serial";
import { collectShortcutsSettings, createShortcutsPanel, refreshShortcutsPanel } from "./shortcuts";
import { collectSshSettings, createSshPanel, isSshConfigDirty, refreshSshPanel } from "./ssh";

export function createSettingsContent(): HTMLElement {
  const root = document.createElement("div");
  root.className = "settings-page";

  // -- Sidebar --
  const sidebar = document.createElement("div");
  sidebar.className = "settings-sidebar";

  const panels = [
    { id: "general", label: "General" },
    { id: "appearance", label: "Appearance" },
    { id: "profile", label: "Profile" },
    { id: "ssh", label: "SSH" },
    { id: "serial", label: "Serial" },
    { id: "keyboard", label: "Keyboard" },
  ];

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const nav = document.createElement("button");
    nav.className = `settings-nav-item${i === 0 ? " active" : ""}`;
    nav.textContent = p.label;
    nav.dataset.panel = p.id;
    sidebar.appendChild(nav);
  }
  root.appendChild(sidebar);

  // -- Body --
  const body = document.createElement("div");
  body.className = "settings-body";

  // Create panels
  const panelGeneral = createGeneralPanel();
  body.appendChild(panelGeneral);

  const panelAppearance = createAppearancePanel();
  body.appendChild(panelAppearance);

  const panelProfile = createProfilePanel();
  body.appendChild(panelProfile);

  const panelSsh = createSshPanel();
  body.appendChild(panelSsh);

  const panelSerial = createSerialPanel();
  body.appendChild(panelSerial);

  const panelShortcuts = createShortcutsPanel();
  body.appendChild(panelShortcuts);

  // -- Footer --
  const footer = document.createElement("div");
  footer.className = "settings-footer";

  const feedback = document.createElement("span");
  feedback.className = "settings-feedback";
  footer.appendChild(feedback);

  // Persistent SSH-config dirty hint in the footer bar, next to the
  // transient feedback — visible in real time no matter which panel is
  // active. Driven by the ssh panel's tterm-ssh-dirty events.
  const sshDirty = document.createElement("span");
  sshDirty.id = "ssh-dirty-hint";
  sshDirty.style.cssText = `color:#e8a33d;margin-right:10px;${isSshConfigDirty() ? "" : "display:none;"}`;
  sshDirty.textContent = "● SSH Config edited — unsaved";
  footer.appendChild(sshDirty);

  const spacer = document.createElement("div");
  spacer.style.flex = "1";
  footer.appendChild(spacer);

  // Revert button
  const revertBtn = document.createElement("button");
  revertBtn.className = "settings-btn settings-btn-revert";
  revertBtn.textContent = "Revert";
  revertBtn.addEventListener("click", async () => {
    await configStore.load();
    // Reload WT profiles in case they changed
    const wt = await loadAllWtData();
    setWtThemes(wt.themes);
    configStore.set({ localProfiles: wt.profiles, vsInstalls: wt.vsInstalls });
    updateFontStack(parseFontFamily(configStore.get("fontFamily")));
    refreshAll(root);
    feedback.textContent = "Reverted to saved config";
    feedback.className = "settings-feedback settings-feedback-info";
    setTimeout(() => {
      feedback.textContent = "";
    }, 2000);
  });
  footer.appendChild(revertBtn);

  // Apply button
  const applyBtn = document.createElement("button");
  applyBtn.className = "settings-btn";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", async () => {
    await applySettings(root);
    applyBtn.classList.add("applied");
    feedback.textContent = "Config saved";
    feedback.className = "settings-feedback settings-feedback-ok";
    setTimeout(() => {
      feedback.textContent = "";
    }, 2500);
  });
  footer.appendChild(applyBtn);

  body.appendChild(footer);
  root.appendChild(body);

  // Enable Apply on any input change. Delegated on root, not per-element:
  // panels re-render their controls (SSH panel on host save/delete/reload,
  // profile panel on refresh) and listeners bound to the old nodes would
  // be lost with them.
  for (const ev of ["input", "change"] as const) {
    root.addEventListener(ev, (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        applyBtn.classList.remove("applied");
      }
    });
  }

  // Sidebar navigation
  const navItems = root.querySelectorAll(".settings-nav-item");
  navItems.forEach((t) => {
    t.addEventListener("click", () => {
      navItems.forEach((x) => {
        x.classList.remove("active");
      });
      t.classList.add("active");
      const name = (t as HTMLElement).dataset.panel!;
      root.querySelectorAll(".settings-panel-content").forEach((p) => {
        (p as HTMLElement).style.display = p.getAttribute("data-panel") === name ? "" : "none";
      });
    });
  });

  // Theme gallery (needs applyBtn reference)
  renderThemeGallery(root);

  // Handle reset event from General panel
  panelGeneral.addEventListener("tterm-settings-reset", () => {
    refreshAll(root);
    feedback.textContent = "All settings cleared";
    feedback.className = "settings-feedback settings-feedback-info";
    setTimeout(() => {
      feedback.textContent = "";
    }, 2000);
  });

  // Panels with non-native edits (font picker, keybinding capture) signal
  // dirty state with this bubbling event — any panel, one listener.
  root.addEventListener("tterm-settings-changed", () => {
    applyBtn.classList.remove("applied");
  });

  // SSH config dirty state — pushed by the ssh panel (Add/Edit/Delete/
  // drag/Save/Reload), shown persistently in the footer.
  root.addEventListener("tterm-ssh-dirty", (e) => {
    sshDirty.style.display = (e as CustomEvent).detail ? "" : "none";
  });

  return root;
}

function refreshAll(root: HTMLElement) {
  refreshGeneralPanel(root);
  refreshAppearancePanel(root);
  refreshProfilePanel(root);
  refreshSshPanel(root);
  refreshSerialPanel(root);
  refreshShortcutsPanel(root);
  renderThemeGallery(root);
}

async function applySettings(root: HTMLElement) {
  const partial = {
    ...collectGeneralSettings(root),
    ...collectAppearanceSettings(root),
    ...collectProfileSettings(root),
    ...collectSshSettings(root),
    ...collectSerialSettings(root),
    ...collectShortcutsSettings(root),
  };
  configStore.set(partial);
  updateFontStack(parseFontFamily(configStore.get("fontFamily")));
  // The configStore.subscribe listener in main.ts will apply changes to terminals.
}
