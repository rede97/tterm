// Floating IME composition box.
// Shows the in-progress IME composition near the cursor, anchored ONCE at
// compositionstart and frozen until compositionend — so the box never drifts
// while the terminal content scrolls or the cursor moves underneath.

export interface CursorPos {
  x: number; // px, relative to the terminal element
  y: number;
  cellH: number;
}

export class ImeBox {
  private el: HTMLElement;
  private active = false;

  constructor(private parent: HTMLElement, fontFamily = "") {
    this.el = document.createElement("div");
    this.el.className = "ime-box";
    if (fontFamily) this.el.style.fontFamily = fontFamily;
    this.el.style.display = "none";
    parent.appendChild(this.el);
  }

  // getPos is called exactly once per composition (anti-drift core)
  attach(textarea: HTMLElement, getPos: () => CursorPos): void {
    textarea.addEventListener("compositionstart", () => {
      const pos = getPos();
      this.show(pos);
    });
    textarea.addEventListener("compositionupdate", (e: CompositionEvent) => {
      this.update(e.data ?? "");
    });
    textarea.addEventListener("compositionend", () => {
      this.hide();
    });
  }

  private show(pos: CursorPos): void {
    this.active = true;
    this.el.textContent = "";
    // Clamp inside the parent; flip above the cursor line when near the bottom
    const parentW = this.parent.clientWidth;
    const parentH = this.parent.clientHeight;
    const boxW = this.el.offsetWidth || 120;
    const boxH = this.el.offsetHeight || 28;
    let x = Math.max(4, Math.min(pos.x, parentW - boxW - 4));
    let y = pos.y + pos.cellH + 4;
    if (y + boxH > parentH - 4) y = pos.y - boxH - 4;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${Math.max(4, y)}px`;
    this.el.style.display = "block";
  }

  update(text: string): void {
    if (!this.active) return;
    this.el.textContent = text;
  }

  hide(): void {
    this.active = false;
    this.el.style.display = "none";
  }

  destroy(): void {
    this.el.remove();
  }

  get isVisible(): boolean {
    return this.el.style.display !== "none";
  }

  get text(): string {
    return this.el.textContent ?? "";
  }

  get position(): { left: string; top: string } {
    return { left: this.el.style.left, top: this.el.style.top };
  }
}
