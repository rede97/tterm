// Tab title state machine — extracted from TerminalTab. Pure model holding
// the label, the rename lock, and the last OSC title. The tab keeps the DOM
// sync (label element + tooltip + tray) in a single helper.

export class TitleModel {
  label: string;
  locked = false;
  private oscTitle: string | undefined;

  constructor(initialLabel: string) {
    this.label = initialLabel;
  }

  /** OSC title sequence. Returns true when the visible label changed. */
  onOscTitle(title: string): boolean {
    if (!title) return false;
    this.oscTitle = title;
    if (this.locked) return false;
    this.label = title;
    return true;
  }

  /** Commit a rename. `lock` stops OSC updates (user rename); internal
   *  refreshes (e.g. serial baud) pass lock=false and keep tracking. */
  rename(newName: string, lock: boolean): void {
    this.label = newName.trim();
    if (lock) this.locked = true;
  }

  /** Clear the rename lock and restore the last OSC title, if any. */
  reset(): void {
    this.locked = false;
    if (this.oscTitle) this.label = this.oscTitle;
  }
}
