// Shared keyboard model for the app's custom popup menus (phase-1 P1-02 /
// P1-04 / P1-05). Only the genuinely repeated behavior lives here:
// collecting usable items, moving focus between them, activating the
// focused item, and Escape-to-close. Each menu keeps its own DOM, open
// state, and focus-restore target.

/// happy-dom/jsdom have no layout, so visibility is judged by inline
/// `display: none` on the element or an ancestor — the same mechanism the
/// menus themselves use to hide groups and closed submenus.
export function isShown(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.style.display === "none") return false;
  }
  return true;
}

/// Visible, enabled menu entries in DOM order. Menu entries are native
/// buttons (P1-01), so a real `disabled` attribute excludes an item.
export function menuItems(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => !b.disabled && isShown(b),
  );
}

/// Refocus a remembered trigger after a popup closes; refuses to move
/// focus to a detached or non-focusable element (never lands on <body>).
export function restoreFocus(el: Element | null | undefined): void {
  if (el instanceof HTMLElement && el.isConnected && el.tabIndex >= 0) {
    el.focus();
  }
}

export interface MenuKeyHandlers {
  // Current entries, freshest first call (menus re-render asynchronously).
  items(): HTMLElement[];
  // Close the menu; the owner restores focus.
  close(): void;
}

/// Standard menu keydown: ArrowUp/Down cycle, Home/End jump to the edges,
/// Enter/Space activate the focused entry, Escape closes. Returns true when
/// the key was consumed (already stopped from reaching the terminal).
export function handleMenuKeydown(e: KeyboardEvent, h: MenuKeyHandlers): boolean {
  const items = h.items();
  if (items.length === 0) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      h.close();
      return true;
    }
    return false;
  }

  const active = document.activeElement as HTMLElement | null;
  const index = active ? items.indexOf(active) : -1;

  switch (e.key) {
    case "ArrowDown":
      items[(index + 1) % items.length].focus();
      break;
    case "ArrowUp":
      items[(index - 1 + items.length) % items.length].focus();
      break;
    case "Home":
      items[0].focus();
      break;
    case "End":
      items[items.length - 1].focus();
      break;
    case "Enter":
    case " ": {
      if (index < 0) return false;
      // preventDefault suppresses the button's native Enter/Space click so
      // the action dispatches exactly once.
      active?.click();
      break;
    }
    case "Escape":
      h.close();
      break;
    default:
      return false;
  }
  e.preventDefault();
  e.stopPropagation();
  return true;
}
