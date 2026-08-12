import { beforeEach, describe, expect, it } from "vitest";

import { attachStepper } from "../src/ui/stepper";

function fixture(value = "14", min = "10", max = "32", step = "1"): HTMLInputElement {
  document.body.innerHTML = `<div><input type="number" value="${value}" min="${min}" max="${max}" step="${step}" /></div>`;
  const input = document.querySelector<HTMLInputElement>("input")!;
  attachStepper(input);
  return input;
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".stepper-btn")];
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("attachStepper", () => {
  it("wraps the input in place with − / + buttons", () => {
    const input = fixture();
    expect(buttons().map((b) => b.textContent)).toEqual(["−", "+"]);
    expect(input.parentElement!.className).toBe("stepper");
    expect(input.value).toBe("14");
  });

  it("steps up and down within the step", () => {
    const input = fixture("14", "10", "32", "1");
    const [dec, inc] = buttons();
    inc.click();
    expect(input.value).toBe("15");
    dec.click();
    dec.click();
    expect(input.value).toBe("13");
  });

  it("clamps at min and max", () => {
    const input = fixture("10", "10", "32", "1");
    const [dec, inc] = buttons();
    dec.click();
    expect(input.value).toBe("10");
    input.value = "32";
    inc.click();
    expect(input.value).toBe("32");
  });

  it("recovers from an empty/unparseable value using min", () => {
    const input = fixture("100", "100", "100000", "100");
    input.value = "";
    buttons()[1].click();
    expect(input.value).toBe("200");
  });

  it("dispatches bubbling input and change events (dirty tracking)", () => {
    const _input = fixture();
    const seen: string[] = [];
    for (const type of ["input", "change"]) {
      document.body.addEventListener(type, () => seen.push(type));
    }
    buttons()[1].click();
    expect(seen).toEqual(["input", "change"]);
  });
});
