// True overlay scrollbar (parity-gap Q8b). On Chromium there is NO CSS
// overlay scrollbar: `overflow: overlay` is dead, and giving
// ::-webkit-scrollbar a width forces a CLASSIC bar whose gutter squeezes
// the 148px control column when content overflows.
//
// Strategy: hide the native bar entirely (scoped `.ov-scroll` rules) and
// paint a floating thumb that never takes layout width. The bar is sticky
// with height 0 (not absolute+translateY) so it cannot extend scrollHeight
// at the bottom. Thumb position syncs on scroll + ResizeObserver; it is
// display-only (pointer-events: none) — wheel/touch scrolling stay native.

/** Attach a floating scrollbar to a scroll container. Returns detach. */
export function attachOverlayScrollbar(el: HTMLElement): () => void {
  el.classList.add("ov-scroll");
  const bar = document.createElement("div");
  bar.className = "ov-sb";
  const thumb = document.createElement("div");
  thumb.className = "ov-sb-thumb";
  bar.appendChild(thumb);
  el.prepend(bar);

  const sync = (): void => {
    // Settings panels fully rebuild on Revert (render(nothing) clears
    // children, this bar included) — re-attach on the next sync.
    if (!bar.isConnected) el.prepend(bar);
    const { scrollHeight, clientHeight, scrollTop } = el;
    const scrollable = scrollHeight > clientHeight + 1;
    bar.classList.toggle("on", scrollable);
    if (!scrollable) return;
    // Clamp: WebView2 can report scrollTop past the range during rubber-band
    // (and an unclamped thumb/bar used to extend scrollHeight → a jump).
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const y = Math.min(Math.max(0, scrollTop), maxScroll);
    const trackH = clientHeight - 8;
    const thumbH = Math.max(24, Math.min(trackH, (clientHeight / scrollHeight) * trackH));
    const top = 4 + (y / maxScroll) * (trackH - thumbH);
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
