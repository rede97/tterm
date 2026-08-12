// Per-tab terminal size hint: a small overlay showing "cols × rows"
// that fades in when the grid size changes (window resize, tab switch).

export class SizeHint {
  private el: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    parent: HTMLElement,
    private hideDelay = 1200,
    fontFamily = "",
  ) {
    this.el = document.createElement("div");
    this.el.className = "size-hint";
    if (fontFamily) this.el.style.fontFamily = fontFamily;
    parent.appendChild(this.el);
  }

  show(cols: number, rows: number): void {
    this.el.textContent = `${cols} × ${rows}`;
    this.el.classList.add("visible");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), this.hideDelay);
  }

  hide(): void {
    this.el.classList.remove("visible");
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }

  get text(): string {
    return this.el.textContent ?? "";
  }

  get isVisible(): boolean {
    return this.el.classList.contains("visible");
  }
}
