import { describe, expect, it } from "vitest";
import { type QpPanelModel, qpPanelView } from "../src/ui/kit/qp/view";
import { render } from "../src/ui/lit";
import { syncSelectTexts } from "../src/ui/select";
import { assertModemHardware, assertModemUnsupported } from "./ui-contracts/qp-modem";

function mount(model: QpPanelModel): HTMLElement {
  const root = document.createElement("div");
  root.className = "quick-panel";
  document.body.appendChild(root);
  render(qpPanelView(model), root);
  syncSelectTexts(root);
  return root;
}

const serialBase: QpPanelModel = {
  kind: "serial",
  title: "COM3",
  meta: "Serial · 115200 8N1",
  conn: "connected",
  shared: false,
  baud: "115200",
  serialProfile: "Normal",
  profileGroups: [{ label: "Built-in", items: [["Normal", "Normal"]] }],
  inputMode: "normal",
  enterNewline: "cr",
  outputNewline: "keep",
  autoReconnect: false,
  linesSupported: true,
  lines: { rts: false, cts: true, dtr: true, dsr: false },
};

describe("qp view fixture parity (shared render path)", () => {
  it("hardware flow matches modem DOM contract", () => {
    const root = mount({
      ...serialBase,
      flow: "hardware",
      lines: { rts: true, cts: true, dtr: true, dsr: true },
    });
    expect(() => assertModemHardware(root)).not.toThrow();
    root.remove();
  });

  it("unsupported modem lines match DOM contract", () => {
    const root = mount({
      ...serialBase,
      flow: "hardware",
      linesSupported: false,
      lines: null,
    });
    expect(() => assertModemUnsupported(root)).not.toThrow();
    root.remove();
  });
});
