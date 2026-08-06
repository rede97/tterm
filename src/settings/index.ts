// Settings shell — sidebar navigation, footer (Apply/Revert), panel routing.
// Delegates panel content to settings-*.ts modules.

import { configStore } from "../core/store";
import { parseFontFamily, updateFontStack } from "../util/fontconfig";
import { createGeneralPanel, refreshGeneralPanel, collectGeneralSettings } from "./general";
import { createAppearancePanel, refreshAppearancePanel, collectAppearanceSettings, renderThemeGallery } from "./appearance";
import { createProfilePanel, collectProfileSettings, refreshProfilePanelForm } from "./profile";
import { createSshPanel, refreshSshPanel, collectSshSettings } from "./ssh";
import { createSerialPanel, collectSerialSettings, refreshSerialPanel } from "./serial";
import { loadAllWtData } from "../config/wt-profiles";
import { setWtThemes } from "../util/themes";

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
  ];

  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const nav = document.createElement("button");
    nav.className = "settings-nav-item" + (i === 0 ? " active" : "");
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

  // -- Footer --
  const footer = document.createElement("div");
  footer.className = "settings-footer";

  const feedback = document.createElement("span");
  feedback.className = "settings-feedback";
  footer.appendChild(feedback);

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
    setTimeout(() => { feedback.textContent = ""; }, 2000);
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
    setTimeout(() => { feedback.textContent = ""; }, 2500);
  });
  footer.appendChild(applyBtn);

  body.appendChild(footer);
  root.appendChild(body);

  // Enable Apply on any input change
  root.querySelectorAll("input, select").forEach(el => {
    el.addEventListener("input", () => applyBtn.classList.remove("applied"));
    el.addEventListener("change", () => applyBtn.classList.remove("applied"));
  });

  // Sidebar navigation
  const navItems = root.querySelectorAll(".settings-nav-item");
  navItems.forEach(t => {
    t.addEventListener("click", () => {
      navItems.forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const name = (t as HTMLElement).dataset.panel!;
      root.querySelectorAll(".settings-panel-content").forEach(p => {
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
    setTimeout(() => { feedback.textContent = ""; }, 2000);
  });

  // Handle appearance changes (font picker)
  panelAppearance.addEventListener("tterm-settings-changed", () => {
    applyBtn.classList.remove("applied");
  });

  return root;
}

function refreshAll(root: HTMLElement) {
  refreshGeneralPanel(root);
  refreshAppearancePanel(root);
  refreshProfilePanelForm(root);
  refreshSshPanel(root);
  refreshSerialPanel(root);
  renderThemeGallery(root);
}

async function applySettings(root: HTMLElement) {
  const partial = {
    ...collectGeneralSettings(root),
    ...collectAppearanceSettings(root),
    ...collectProfileSettings(root),
    ...collectSshSettings(root),
    ...collectSerialSettings(root),
  };
  configStore.set(partial);
  updateFontStack(parseFontFamily(configStore.get("fontFamily")));
  // The configStore.subscribe listener in main.ts will apply changes to terminals.
}
