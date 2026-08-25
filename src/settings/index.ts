// Settings shell — sidebar navigation, footer (Apply/Revert), panel routing.
// Delegates panel content to settings-*.ts modules.

import { loadAllWtData } from "../config/wt-profiles";
import { configStore } from "../core/store";
import { showToast } from "../ui/toast";
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
import {
  collectSshSettings,
  createSshPanel,
  isSshConfigDirty,
  refreshSshPanel,
  saveSshConfigToDisk,
} from "./ssh";

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
  // Design (docs/settings-preview.html): the footer carries ONLY the dirty
  // hint + Revert + Apply; success/failure feedback goes to the bottom-left
  // toast. SSH edits join the same Apply — one click writes app config and
  // ~/.ssh/config together.
  const footer = document.createElement("div");
  footer.className = "settings-footer";

  let appDirty = false;
  let sshDirty = isSshConfigDirty();
  const dirtyHint = document.createElement("span");
  dirtyHint.id = "dirty-hint";
  footer.appendChild(dirtyHint);

  const syncDirty = (): void => {
    dirtyHint.classList.toggle("on", appDirty || sshDirty);
    dirtyHint.textContent = sshDirty
      ? appDirty
        ? "Unsaved changes · SSH config will be written"
        : "SSH config will be written on Apply"
      : "Unsaved changes";
  };
  syncDirty();

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
    appDirty = false;
    applyBtn.classList.add("applied");
    syncDirty();
    showToast("Reverted to saved settings", "info");
  });
  footer.appendChild(revertBtn);

  // Apply button
  const applyBtn = document.createElement("button");
  applyBtn.className = "settings-btn";
  applyBtn.textContent = "Apply";
  applyBtn.addEventListener("click", async () => {
    await applySettings(root);
    // SSH host edits write ~/.ssh/config in the same Apply. On failure the
    // app settings stay applied; the SSH dirty flag is kept and reported.
    let sshWrote = false;
    if (isSshConfigDirty()) {
      try {
        await saveSshConfigToDisk(root);
        sshWrote = true;
      } catch (err) {
        showToast(`Failed to write SSH config: ${String(err)}`, "error");
      }
    }
    appDirty = false;
    applyBtn.classList.add("applied");
    sshDirty = isSshConfigDirty();
    syncDirty();
    showToast(sshWrote ? "Settings applied · SSH config written" : "Settings applied", "info");
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
        appDirty = true;
        syncDirty();
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
      const name = (t as HTMLElement).dataset.panel;
      if (!name) return;
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
    appDirty = false;
    applyBtn.classList.add("applied");
    syncDirty();
    showToast("All settings cleared", "info");
  });

  // Panels with non-native edits (font picker, keybinding capture) signal
  // dirty state with this bubbling event — any panel, one listener.
  root.addEventListener("tterm-settings-changed", () => {
    applyBtn.classList.remove("applied");
    appDirty = true;
    syncDirty();
  });

  // SSH config dirty state — pushed by the ssh panel (Add/Edit/Delete/
  // drag/Apply/Reload), folded into the single footer dirty hint.
  root.addEventListener("tterm-ssh-dirty", (e) => {
    sshDirty = (e as CustomEvent<boolean>).detail;
    syncDirty();
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
