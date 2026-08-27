// Place a `position: fixed` menu under a chrome control (tab, + button).
// Flips above the anchor and clamps to the window if it would overflow.

const PAD = 4;

export function placeMenuBelow(menu: HTMLElement, anchor: HTMLElement, pad = PAD): void {
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom}px`;
  requestAnimationFrame(() => {
    if (!menu.isConnected) return;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = rect.left;
    let top = rect.bottom;
    if (left + mw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - mw - pad);
    if (top + mh > window.innerHeight - pad) top = Math.max(pad, rect.top - mh);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  });
}
