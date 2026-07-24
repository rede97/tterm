import { describe, it, expect } from "vitest";
import { hysteresis } from "../src/util/hysteresis";

// Column thresholds used by TerminalTab.fit(): th_low=0.8, th_high=0.9
const COL_LO = 0.8, COL_HI = 0.9;
// Row thresholds: th_low=0.98, th_high=1.0
const ROW_LO = 0.98, ROW_HI = 1.0;

describe("hysteresis (cols: 0.8/0.9)", () => {
  it("keeps current when fractional part is below the high threshold", () => {
    // 107.3 fits, current=107 -> stays 107 (needs >90% of a char to grow)
    expect(hysteresis(107.3, 107, COL_LO, COL_HI)).toBe(107);
  });

  it("grows when fractional part exceeds the high threshold", () => {
    expect(hysteresis(107.95, 107, COL_LO, COL_HI)).toBe(108);
  });

  it("shrinks when float drops well below current", () => {
    expect(hysteresis(105.1, 107, COL_LO, COL_HI)).toBe(105);
  });

  it("never exceeds ceil(float - th_high)", () => {
    // hi = ceil(107.3 - 0.9) = 107, so current=120 clamps down to 107
    expect(hysteresis(107.3, 120, COL_LO, COL_HI)).toBe(107);
  });
});

describe("hysteresis (rows: 0.98/1.0)", () => {
  it("never grows past floor(float)", () => {
    // hi = ceil(50.9 - 1.0) = 50 -> stays 50 even with 90% of a row visible
    expect(hysteresis(50.9, 50, ROW_LO, ROW_HI)).toBe(50);
  });

  it("grows only when float crosses the next integer", () => {
    expect(hysteresis(51.1, 50, ROW_LO, ROW_HI)).toBe(51);
  });

  it("shrinks immediately when float drops below current", () => {
    expect(hysteresis(49.5, 50, ROW_LO, ROW_HI)).toBe(49);
  });
});

describe("hysteresis (general)", () => {
  it("clamps to min=2 floor", () => {
    expect(hysteresis(0.4, 5, COL_LO, COL_HI)).toBe(2);
    expect(hysteresis(-10, 5, COL_LO, COL_HI)).toBe(2);
  });

  it("respects a custom min", () => {
    expect(hysteresis(0.4, 5, COL_LO, COL_HI, 10)).toBe(10);
  });

  it("is stable when float equals current (no oscillation)", () => {
    expect(hysteresis(107.0, 107, COL_LO, COL_HI)).toBe(107);
  });
});
