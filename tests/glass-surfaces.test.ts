import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function css(rel: string): string {
  return readFileSync(join(__dirname, "..", rel), "utf8");
}

function block(src: string, selector: string): string {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]+\\}`);
  const m = src.match(re);
  if (!m) throw new Error(`CSS block for ${selector} not found`);
  return m[0];
}

describe("frosted overlay surfaces", () => {
  const palette = css("src/ui/kit/palette.css");
  const styles = css("src/styles.css");
  const controls = css("src/ui/kit/controls.css");

  it("palette panel uses the same --tt-glass-* fill as menus", () => {
    const panel = block(palette, "body.tt-glass .pal-panel");
    expect(panel).toContain("backdrop-filter: var(--tt-glass-filter)");
    expect(panel).toContain("background: var(--tt-glass-bg)");
    expect(panel).toContain("border-color: var(--tt-glass-border)");
  });

  it("IME composition mirror uses the same --tt-glass-* fill", () => {
    const box = block(styles, "body.tt-glass .ime-box");
    expect(box).toContain("backdrop-filter: var(--tt-glass-filter)");
    expect(box).toContain("background: var(--tt-glass-bg)");
    expect(box).not.toContain("opacity:");
  });

  it("IME mirror keeps the original 0.8 chip when glass is off", () => {
    const box = block(styles, ".ime-box");
    expect(box).toContain("opacity: 0.8");
    expect(box).toContain("background: var(--tt-chrome)");
  });

  it("select menus stay on the same glass tokens", () => {
    const menu = block(controls, "body.tt-glass .tt-select-menu");
    expect(menu).toContain("backdrop-filter: var(--tt-glass-filter)");
    expect(menu).toContain("background: var(--tt-glass-bg)");
  });
});
