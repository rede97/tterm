import { describe, expect, it } from "vitest";
import { IME_PIN_PAD, imePinnedOrigin } from "../src/util/imepin";

describe("imePinnedOrigin", () => {
  it("sits at the bottom-left of the element", () => {
    expect(imePinnedOrigin(800, 600, 8, 16)).toEqual({
      x: IME_PIN_PAD,
      y: 600 - 16 - IME_PIN_PAD,
      cellH: 16,
    });
  });

  it("uses a nominal cell when metrics are missing", () => {
    expect(imePinnedOrigin(800, 600, 0, 0)).toEqual({
      x: IME_PIN_PAD,
      y: 600 - 16 - IME_PIN_PAD,
      cellH: 16,
    });
  });

  it("returns null for a 0-sized element", () => {
    expect(imePinnedOrigin(0, 0, 8, 16)).toBeNull();
  });
});
