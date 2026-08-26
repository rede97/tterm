// DOM contracts for the quick-panel modem section — asserted against both
// app-rendered panels and pure qpPanelView fixtures so draft↔app cannot drift.

export function modemSection(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-section="serial-modem"]');
}

function rowByLabel(sec: HTMLElement, label: string): HTMLElement | undefined {
  return [...sec.querySelectorAll<HTMLElement>(".qp-row")].find(
    (r) => r.querySelector(".qp-label")?.textContent === label,
  );
}

function switchIn(row: HTMLElement | undefined): HTMLButtonElement | null {
  return row?.querySelector<HTMLButtonElement>(".tt-switch") ?? null;
}

/** Hardware RTS/CTS: RTS disabled + asserted look; DTR free; no hint prose. */
export function assertModemHardware(root: ParentNode): void {
  const sec = modemSection(root);
  if (!sec) throw new Error("serial-modem section missing");
  const rts = switchIn(rowByLabel(sec, "RTS"));
  const dtr = switchIn(rowByLabel(sec, "DTR"));
  if (!rts || !dtr) throw new Error("RTS/DTR switches missing");
  if (!rts.disabled) throw new Error("RTS must be disabled under hardware flow");
  if (!rts.classList.contains("on")) throw new Error("RTS must show driver-asserted (on)");
  if (dtr.disabled) throw new Error("DTR must stay enabled under hardware flow");
  if (!rowByLabel(sec, "CTS")?.querySelector(".qp-led")) throw new Error("CTS led missing");
  if (!rowByLabel(sec, "DSR")?.querySelector(".qp-led")) throw new Error("DSR led missing");
  if (sec.textContent?.includes("RTS is driver-managed")) {
    throw new Error("hardware hint copy must not appear (grey alone signals unavailable)");
  }
}

/** Port cannot report modem lines: flow row greyed, no signal toggles. */
export function assertModemUnsupported(root: ParentNode): void {
  const sec = modemSection(root);
  if (!sec) throw new Error("serial-modem section missing");
  const flowRow = rowByLabel(sec, "Flow control");
  if (!flowRow?.classList.contains("qp-disabled")) {
    throw new Error("Flow control row must be qp-disabled when unsupported");
  }
  if (rowByLabel(sec, "RTS")) throw new Error("RTS must be hidden when unsupported");
  if (rowByLabel(sec, "DSR")) throw new Error("DSR must be hidden when unsupported");
  if (!sec.textContent?.includes("not supported by this port")) {
    throw new Error("unsupported hint missing");
  }
}
