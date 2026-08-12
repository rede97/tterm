// Shared DOM helpers — the ONE copy. (Five private duplicates of el() had
// accumulated across quickpanel / forwardeditor / forwardtable /
// tabswitcher / settings-shortcuts; new UI modules import from here.)

/** Create an element with a class and optional text content. */
export function el(tag: string, className: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
