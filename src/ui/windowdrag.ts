// Window-move chrome on the undecorated tab bar (#drag-spacer and empty
// bar, not tabs/buttons). Native `data-tauri-drag-region` is NOT used:
// it starts a caption drag on mousedown, which blurs xterm and eats the
// dblclick-to-maximize gesture. Drag begins only after the pointer moves.

const DRAG_THRESHOLD_PX = 5;

/** Empty tab-bar chrome that moves the window — not tabs, buttons, or inputs. */
export function isWindowDragChrome(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("button, .tab, input, textarea, select, a")) return false;
  return Boolean(target.closest("#tab-bar"));
}

export interface WindowDragHandlers {
  startDrag: () => void;
  /** Put typing back on the active terminal (click and drag both steal it). */
  keepFocus: () => void;
}

/** Bind mousedown on the tab bar: keep terminal focus, start a window drag
 *  only after the pointer actually moves (so dblclick can still maximize). */
export function attachWindowDrag(tabBar: HTMLElement, h: WindowDragHandlers): void {
  tabBar.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      if (!isWindowDragChrome(e.target)) return;

      // Default mousedown on chrome blurs xterm's textarea. Cancel it so a
      // click (and the drag that may follow) never requires a re-click.
      e.preventDefault();
      h.keepFocus();

      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (ev: MouseEvent) => {
        if (
          Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX &&
          Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        stopGesture();
        h.startDrag();
        // Caption-drag (WM_SYSCOMMAND SC_MOVE) often blurs the textarea
        // again and swallows the matching mouseup inside the webview.
        const onRelease = () => {
          window.removeEventListener("pointerup", onRelease, true);
          window.removeEventListener("mouseup", onRelease, true);
          document.removeEventListener("mousemove", onIdleMove, true);
          h.keepFocus();
        };
        const onIdleMove = (mv: MouseEvent) => {
          if (mv.buttons !== 0) return;
          onRelease();
        };
        window.addEventListener("pointerup", onRelease, true);
        window.addEventListener("mouseup", onRelease, true);
        document.addEventListener("mousemove", onIdleMove, true);
        h.keepFocus();
      };
      const onUp = () => {
        stopGesture();
        h.keepFocus();
      };
      const stopGesture = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    true,
  );
}
