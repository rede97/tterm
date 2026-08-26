// True overlay scrollbar (parity-gap Q8b). On Chromium there is NO CSS
// overlay scrollbar: `overflow: overlay` is dead, and giving
// ::-webkit-scrollbar a width forces a CLASSIC bar whose gutter squeezes
// the 148px control column when content overflows.
//
// Strategy: hide the native bar entirely (scoped `.ov-scroll` rules) and
// paint a floating thumb that never takes layout width. The thumb's
// track/position syncs on scroll + ResizeObserver; it is display-only
// (pointer-events: none) — wheel/touch scrolling stay native.

/** Attach a floating scrollbar to a scroll container. Returns detach. */
export function attachOverlayScrollbar(el: HTMLElement): () => void {
  el.classList.add("ov-scroll");
  const bar = document.createElement("div");
  bar.className = "ov-sb";
  const thumb = document.createElement("div");
  thumb.className = "ov-sb-thumb";
  bar.appendChild(thumb);
  el.appendChild(bar);

  const sync = (): void => {
    // Settings panels fully rebuild on Revert (render(nothing) clears
    // children, this bar included) — re-attach on the next sync.
    if (!bar.isConnected) el.appendChild(bar);
    const { scrollHeight, clientHeight, scrollTop } = el;
    const scrollable = scrollHeight > clientHeight + 1;
    bar.classList.toggle("on", scrollable);
    if (!scrollable) return;
    // The bar lives inside the scroller (absolute = padding box, which
    // moves with scroll) — pin it back to the visible area.
    bar.style.height = `${clientHeight}px`;
    bar.style.transform = `translateY(${scrollTop}px)`;
    const trackH = clientHeight - 8;
    const thumbH = Math.max(24, Math.min(trackH, (clientHeight / scrollHeight) * trackH));
    const top = 4 + (scrollTop / (scrollHeight - clientHeight)) * (trackH - thumbH);
    thumb.style.height = `${thumbH}px`;
    thumb.style.transform = `translateY(${top}px)`;
  };

  el.addEventListener("scroll", sync, { passive: true });
  const observer = new ResizeObserver(sync);
  observer.observe(el);
  sync();

  return () => {
    el.removeEventListener("scroll", sync);
    observer.disconnect();
    bar.remove();
    el.classList.remove("ov-scroll");
  };
}
