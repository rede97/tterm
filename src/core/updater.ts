// Auto-update check (GitHub Releases via tauri-plugin-updater).
// Silent on "no update" and on network errors; only surfaces real updates
// and failures of an update the user already accepted.

import { check } from "@tauri-apps/plugin-updater";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { showToast } from "../ui/toast";
import { logCatch } from "./errorlog";
import { configStore } from "./store";

// Launch-time update check, skipped when the user disabled it
// (Settings → General → Updates).
export function scheduleAutoUpdateCheck(delayMs = 3000): void {
  setTimeout(() => {
    if (!configStore.get("autoCheckUpdates")) return;
    checkForUpdates().catch(logCatch("updater"));
  }, delayMs);
}

export async function checkForUpdates(manual = false): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      if (manual) showToast("You're up to date.", "info");
      return;
    }
    const yes = await ask(
      `A new version of TTerm is available: v${update.version} (current: v${update.currentVersion}).\n\nDownload and install now? The app will restart to finish updating.`,
      { title: "Update Available", kind: "info", okLabel: "Update", cancelLabel: "Later" }
    );
    if (!yes) return;

    const toast = showToast("Downloading update…", "info", 600000);
    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall(e => {
      if (e.event === "Started" && e.data.contentLength) total = e.data.contentLength;
      else if (e.event === "Progress") {
        downloaded += e.data.chunkLength;
        if (total > 0) toast.textContent = `Downloading update… ${Math.round((downloaded / total) * 100)}%`;
      } else if (e.event === "Finished") {
        toast.textContent = "Installing update…";
      }
    });
    toast.remove();
    await relaunch();
  } catch (err) {
    if (manual) showToast(`Update check failed: ${err}`, "error");
    else logCatch("updater.check")(err);
  }
}
