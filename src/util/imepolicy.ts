// IME fake-caret policy: the Settings toggle (config.json) plus the
// Win10 ConPTY probe (conpty-ime.json). Pure read of those two stores.

import { getConptyImeCaps } from "../config/conpty-ime";
import { configStore } from "../core/store";
import type { ImeAnchorPolicy } from "./imeanchor";

let override: ImeAnchorPolicy | null = null;

/** e2e hatch: force Win10-legacy scan without touching conpty-ime.json. */
export function setImeAnchorPolicyOverride(policy: ImeAnchorPolicy | null): void {
  override = policy;
}

export function imeAnchorPolicy(): ImeAnchorPolicy {
  if (override) return override;
  const scanEnabled = configStore.get("imeFakeCursorScan");
  const caps = getConptyImeCaps();
  // Unknown / not yet probed: assume Win10-legacy so the first session on
  // a buggy host is not stuck following line-end. Win11 probe is fast
  // (registry only) and flips this off within the same startup.
  const scanWhenVisible =
    scanEnabled && (caps === null ? true : caps.win10 && !caps.cursorHideForwarded);
  return { scanEnabled, scanWhenVisible };
}
