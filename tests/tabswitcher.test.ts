import { beforeEach, describe, expect, it } from "vitest";
import {
  filterSwitcherItems,
  openQuickOpen,
  type SwitcherItem,
  setTabSwitcherHandlers,
  stepIndex,
} from "../src/ui/tabswitcher";

const mkItem = (id: string, label: string, index: number): SwitcherItem => ({
  id,
  label,
  index,
  active: false,
  disconnected: false,
  kind: "local",
});

describe("filterSwitcherItems (Ctrl+P quick open)", () => {
  const items: SwitcherItem[] = [
    {
      id: "tab-1",
      label: "Terminal",
      index: 1,
      active: true,
      disconnected: false,
      kind: "local",
    },
    {
      id: "tab-2",
      label: "prod-server",
      index: 2,
      active: false,
      disconnected: false,
      kind: "ssh",
    },
    {
      id: "tab-3",
      label: "COM3 · 115200",
      index: 3,
      active: false,
      disconnected: true,
      kind: "serial",
    },
  ];

  it("empty query returns everything", () => {
    expect(filterSwitcherItems(items, "")).toHaveLength(3);
    expect(filterSwitcherItems(items, "   ")).toHaveLength(3);
  });

  it("numeric query matches the tab number", () => {
    expect(filterSwitcherItems(items, "2").map((i) => i.id)).toEqual(["tab-2"]);
  });

  it("non-numeric query is a case-insensitive label substring", () => {
    expect(filterSwitcherItems(items, "PROD").map((i) => i.id)).toEqual(["tab-2"]);
    expect(filterSwitcherItems(items, "com3").map((i) => i.id)).toEqual(["tab-3"]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterSwitcherItems(items, "zzz")).toEqual([]);
  });
});

describe("stepIndex", () => {
  it("wraps forward and backward", () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });

  it("is a no-op on an empty list", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });

  it("stays at 0 when length is 1", () => {
    expect(stepIndex(5, 1, 1)).toBe(0);
  });
});

describe("overlay commit", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("clicking a live row switches; a row whose tab died since open is refused", () => {
    let live = [mkItem("tab-1", "one", 1), mkItem("tab-2", "two", 2)];
    const switched: string[] = [];
    setTabSwitcherHandlers({ listTabs: () => live, switchTo: (id) => switched.push(id) });

    openQuickOpen();
    // Tab dies (clean exit auto-close) while the overlay shows its snapshot.
    live = [mkItem("tab-1", "one", 1)];

    document.querySelector<HTMLElement>('.pal-row[data-tab-id="tab-2"]')!.click();
    expect(switched).toEqual([]);
    // A refused commit closes the overlay rather than silently no-oping
    // with it left open.
    expect(document.querySelector(".pal-overlay")).toBeNull();

    openQuickOpen();
    document.querySelector<HTMLElement>('.pal-row[data-tab-id="tab-1"]')!.click();
    expect(switched).toEqual(["tab-1"]);
    expect(document.querySelector(".pal-overlay")).toBeNull();
  });
});
