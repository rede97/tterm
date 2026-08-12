import { describe, expect, it } from "vitest";
import { TitleModel } from "../src/terminal/title";

describe("TitleModel", () => {
  it("adopts OSC titles while unlocked", () => {
    const t = new TitleModel("initial");
    expect(t.onOscTitle("my-shell")).toBe(true);
    expect(t.label).toBe("my-shell");
    expect(t.locked).toBe(false);
  });

  it("ignores empty OSC titles", () => {
    const t = new TitleModel("initial");
    expect(t.onOscTitle("")).toBe(false);
    expect(t.label).toBe("initial");
  });

  it("ignores OSC titles while locked, but tracks them for reset", () => {
    const t = new TitleModel("initial");
    t.onOscTitle("first");
    t.rename("pinned", true);
    expect(t.locked).toBe(true);
    expect(t.onOscTitle("second")).toBe(false);
    expect(t.label).toBe("pinned"); // lock keeps the renamed label
    t.reset();
    expect(t.locked).toBe(false);
    expect(t.label).toBe("second"); // restores the last OSC title
  });

  it("internal refresh (lock=false) keeps OSC tracking live", () => {
    const t = new TitleModel("initial");
    t.rename("COM3 · 115200", false);
    expect(t.locked).toBe(false);
    expect(t.label).toBe("COM3 · 115200");
    expect(t.onOscTitle("shell")).toBe(true);
    expect(t.label).toBe("shell");
  });

  it("rename trims whitespace", () => {
    const t = new TitleModel("initial");
    t.rename("  foo  ", true);
    expect(t.label).toBe("foo");
  });

  it("reset with no prior OSC title keeps the current label", () => {
    const t = new TitleModel("initial");
    t.rename("pinned", true);
    t.reset();
    expect(t.locked).toBe(false);
    expect(t.label).toBe("pinned"); // no OSC title ever seen → unchanged
  });
});
