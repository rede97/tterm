import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createElement, Minus, Square, Copy, X, Drama } from "lucide";
import { logCatch, swallow } from "../core/errorlog";

const appWindow = getCurrentWindow();

// -- maximize icon ----

const btnMaximize = document.getElementById("btn-maximize")!;

async function updateMaximizeIcon() {
  try {
    if (await appWindow.isMaximized()) {
      btnMaximize.classList.add("restore");
    } else {
      btnMaximize.classList.remove("restore");
    }
  } catch {
    swallow(); // icon state is cosmetic; IPC failure leaves it stale, harmless
  }
}

// -- drag ----

function initDrag() {
  const tabBar = document.getElementById("tab-bar")!;
  tabBar.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.closest("button")) return;
    // Tabs are handled by SortableJS (drag reorder), not window drag
    if (target.closest(".tab")) return;

    const startX = e.clientX;
    const startY = e.clientY;

    const cleanup = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", cleanup);
    };
    const onMove = (e: MouseEvent) => {
      if (Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5) return;
      cleanup();
      invoke("window_start_drag");
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", cleanup);
  });
}

// -- window control buttons ----

function initWindowButtons() {
  const tabBar = document.getElementById("tab-bar")!;

  tabBar.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : (e.target as Node).parentElement;
    const btn = target?.closest("button");
    if (!btn) return;

    switch (btn.id) {
      case "btn-park-tray":
        // Park the window in the shared system tray: the window hides,
        // sessions keep running, restore via the tray icon's menu.
        invoke("tray_park_window");
        break;
      case "btn-minimize":
        invoke("window_minimize");
        break;
      case "btn-maximize":
        invoke("window_toggle_maximize");
        break;
      case "btn-close":
        invoke("window_close");
        break;
    }
  });

  document.getElementById("tab-bar")!.addEventListener("dblclick", (e) => {
    const target = e.target instanceof Element ? e.target : (e.target as Node).parentElement;
    // Buttons have their own actions; a dblclick on a tab is rename/click
    // territory, not a window-maximize gesture (matches the drag guard).
    if (target?.closest("button") || target?.closest(".tab")) return;
    invoke("window_toggle_maximize");
  });
}

// -- icons ---

function injectIcons() {
  const btnMinimize = document.getElementById("btn-minimize")!;
  const btnClose = document.getElementById("btn-close")!;
  const btnPark = document.getElementById("btn-park-tray")!;

  btnPark.title = "Park to tray — sessions keep running; restore from the tray icon";
  // Mask icon: the window "disappears" into the tray while sessions run on.
  btnPark.appendChild(createElement(Drama, { stroke: "currentColor", width: 14, height: 14 }));
  btnMinimize.appendChild(createElement(Minus, { stroke: "currentColor", width: 14, height: 14 }));
  const icoMax = createElement(Square, { stroke: "currentColor", width: 14, height: 14 });
  icoMax.classList.add("ico-max");
  btnMaximize.appendChild(icoMax);
  const icoRestore = createElement(Copy, { stroke: "currentColor", width: 14, height: 14 });
  icoRestore.classList.add("ico-restore");
  btnMaximize.appendChild(icoRestore);
  btnClose.appendChild(createElement(X, { stroke: "currentColor", width: 14, height: 14 }));
}

// -- zen / fullscreen modes (F11 family) ----
//
// Two rebindable modes sharing the same chrome hiding (`body.zen-mode`
// hides the tab bar — terminal content only):
//   - "max"        (default Shift+F11): maximize the window
//   - "fullscreen" (default F11):       browser-style fullscreen, covers
//                                       the taskbar
// Toggling restores the pre-entry window state. A manual window restore
// (unmaximize / leaving fullscreen) while active also exits the mode, so
// the chrome can never be lost.

type ZenKind = "max" | "fullscreen";

let zenKind: ZenKind | null = null;
let zenWasMaximized = false;
// Resize events during the OS transition must not trip the manual-restore
// auto-exit check (fullscreen/maximize don't report settled state instantly).
let zenTransitionUntil = 0;

export function isZenMode(): boolean {
  return zenKind !== null;
}

async function enterZen(kind: ZenKind): Promise<void> {
  zenWasMaximized = await appWindow.isMaximized().catch(() => true);
  zenKind = kind;
  zenTransitionUntil = Date.now() + 600;
  document.body.classList.add("zen-mode");
  // Explicit window.rs commands: the JS Window API's maximize/fullscreen
  // is not in our capabilities (same restriction as the maximize button).
  if (kind === "fullscreen") {
    await invoke("window_set_fullscreen", { on: true }).catch(logCatch("window.fullscreen"));
  } else if (!zenWasMaximized) {
    await invoke("window_maximize").catch(logCatch("window.maximize"));
  }
}

async function exitZen(): Promise<void> {
  const kind = zenKind;
  zenKind = null;
  zenTransitionUntil = Date.now() + 600;
  document.body.classList.remove("zen-mode");
  if (kind === "fullscreen") {
    // Exiting fullscreen returns the window to its pre-fullscreen state
    // (a maximized window stays maximized) — no explicit restore needed.
    await invoke("window_set_fullscreen", { on: false }).catch(logCatch("window.fullscreen"));
  } else if (!zenWasMaximized) {
    await invoke("window_unmaximize").catch(logCatch("window.unmaximize"));
  }
}

// Maximize + hide chrome (default Shift+F11).
export async function toggleZenMode(): Promise<void> {
  await (zenKind ? exitZen() : enterZen("max"));
}

// Browser-style fullscreen + hide chrome (default F11).
export async function toggleFullscreenMode(): Promise<void> {
  if (zenKind === "fullscreen") return exitZen();
  // Switching from the maximize variant: leave it (restores window state),
  // then enter fullscreen.
  if (zenKind) await exitZen();
  return enterZen("fullscreen");
}

// -- init ----

// onResized's unlisten is retained so re-initialization (dev HMR) doesn't
// stack duplicate listeners.
let unlistenResized: (() => void) | null = null;

export function initWindowControls() {
  initDrag();
  initWindowButtons();
  injectIcons();
  updateMaximizeIcon();

  unlistenResized?.();
  appWindow.onResized(() => {
    updateMaximizeIcon();
    // Drag-restore or the maximize button while in zen: drop the zen chrome
    // but leave the window exactly where the user put it. The check follows
    // the mode's window state (fullscreen windows are not "maximized").
    if (zenKind && Date.now() > zenTransitionUntil) {
      const kind = zenKind;
      const settled = kind === "max" ? appWindow.isMaximized() : appWindow.isFullscreen();
      settled.then((ok) => {
        if (!ok && zenKind === kind) {
          zenKind = null;
          document.body.classList.remove("zen-mode");
        }
      });
    }
  }).then((fn) => { unlistenResized = fn; });
}


