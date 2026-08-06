// Number stepper — the shared styled − / + control for number inputs.
// Native spinner buttons are hidden globally (styles.css): they render with
// the platform look and clash with the app chrome. attachStepper wraps an
// existing input in place (its id, classes, and listeners are untouched)
// and adds buttons that step within [min, max], dispatching bubbling
// input+change events so dirty tracking (settings Apply button) keeps
// working. New number inputs get this — never the native spinners.

export function attachStepper(input: HTMLInputElement): void {
  const wrap = document.createElement("div");
  wrap.className = "stepper";
  input.parentNode?.insertBefore(wrap, input);

  const mkBtn = (label: string, dir: 1 | -1): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "stepper-btn";
    btn.textContent = label;
    btn.tabIndex = -1; // the input owns keyboard focus order
    btn.setAttribute("aria-label", dir === 1 ? "Increase" : "Decrease");
    btn.addEventListener("click", () => {
      const step = parseFloat(input.step) || 1;
      const min = parseFloat(input.min);
      const max = parseFloat(input.max);
      let v = parseFloat(input.value);
      if (!Number.isFinite(v)) v = Number.isFinite(min) ? min : 0;
      v += dir * step;
      if (Number.isFinite(min)) v = Math.max(min, v);
      if (Number.isFinite(max)) v = Math.min(max, v);
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    return btn;
  };

  wrap.appendChild(mkBtn("−", -1));
  wrap.appendChild(input);
  wrap.appendChild(mkBtn("+", 1));
}
