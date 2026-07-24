// Disconnect overlay: shown over a terminal when its session dies
// (PTY exit, serial unplug). Instructs the user to press Enter to reconnect.

export class DisconnectOverlay {
  private el: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "disconnect-overlay";
    this.el.style.display = "none";

    const box = document.createElement("div");
    box.className = "disconnect-box";

    const title = document.createElement("div");
    title.className = "disconnect-title";
    title.textContent = "⚠ Session disconnected";
    box.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "disconnect-hint";
    hint.textContent = "Press Enter to reconnect";
    box.appendChild(hint);

    this.el.appendChild(box);
    parent.appendChild(this.el);
  }

  show(): void {
    this.el.style.display = "flex";
  }

  hide(): void {
    this.el.style.display = "none";
  }

  destroy(): void {
    this.el.remove();
  }

  get isVisible(): boolean {
    return this.el.style.display !== "none";
  }
}
