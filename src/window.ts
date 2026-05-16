import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createElement, Minus, Square, Copy, X } from "lucide";

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
  } catch (_) {}
}

// -- drag ----

function initDrag() {
  const tabBar = document.getElementById("tab-bar")!;
  tabBar.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "BUTTON" || target.closest("button")) return;

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
    if (target?.closest("button")) return;
    invoke("window_toggle_maximize");
  });
}

// -- icons ---

function injectIcons() {
  const btnMinimize = document.getElementById("btn-minimize")!;
  const btnClose = document.getElementById("btn-close")!;

  btnMinimize.appendChild(createElement(Minus, { stroke: "currentColor", width: 14, height: 14 }));
  const icoMax = createElement(Square, { stroke: "currentColor", width: 14, height: 14 });
  icoMax.classList.add("ico-max");
  btnMaximize.appendChild(icoMax);
  const icoRestore = createElement(Copy, { stroke: "currentColor", width: 14, height: 14 });
  icoRestore.classList.add("ico-restore");
  btnMaximize.appendChild(icoRestore);
  btnClose.appendChild(createElement(X, { stroke: "currentColor", width: 14, height: 14 }));
}

// -- init ----

export function initWindowControls() {
  initDrag();
  initWindowButtons();
  injectIcons();
  updateMaximizeIcon();

  appWindow.onResized(() => {
    updateMaximizeIcon();
  });
}


