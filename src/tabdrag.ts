// Mouse-based tab drag reordering.
// HTML5 drag-and-drop is unreliable in WebView2 (same reason the font picker
// avoids it), so reordering is implemented with mousedown/mousemove/mouseup.

export interface TabRect {
  left: number;
  width: number;
}

// Given sibling tab rectangles (in DOM order) and the dragged tab's center X,
// return the index (among siblings) before which the tab should be inserted.
// Returns siblings.length to append at the end.
export function insertionIndex(siblings: TabRect[], centerX: number): number {
  for (let i = 0; i < siblings.length; i++) {
    const mid = siblings[i].left + siblings[i].width / 2;
    if (centerX < mid) return i;
  }
  return siblings.length;
}

export const DRAG_THRESHOLD_PX = 6;

export interface DragCallbacks {
  // Live-reorder the dragged element before the reference element (null = end).
  onReorder(insertBefore: HTMLElement | null): void;
  onDrop(): void;
}

// Attach drag-reorder behavior to a tab element.
// `getSiblings` must return the reorderable sibling tabs (excluding the dragged
// one and non-terminal tabs like Settings) in DOM order.
// `getEndRef` returns the element that marks the end zone (e.g. the settings
// tab) so dragged tabs never move past it; may return null.
export function attachTabDrag(
  el: HTMLElement,
  getSiblings: () => HTMLElement[],
  getEndRef: () => HTMLElement | null,
  cb: DragCallbacks,
): void {
  el.addEventListener("mousedown", (e: MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tab-close")) return;
    // Prevent the window-drag handler on #tab-bar from starting a window move
    e.stopPropagation();

    const startX = e.clientX;
    let dragging = false;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        el.classList.add("dragging");
      }
      el.style.transform = `translateX(${dx}px)`;

      const center = el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2;
      const siblings = getSiblings();
      const rects = siblings.map(s => {
        const r = s.getBoundingClientRect();
        return { left: r.left, width: r.width };
      });
      const idx = insertionIndex(rects, center);
      const before: HTMLElement | null = idx < siblings.length ? siblings[idx] : getEndRef();
      // Skip no-op moves
      if (before === el.nextElementSibling) return;
      if (before === null && el.nextElementSibling === null) return;
      cb.onReorder(before);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (!dragging) return;
      el.classList.remove("dragging");
      el.style.transform = "";
      cb.onDrop();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}
