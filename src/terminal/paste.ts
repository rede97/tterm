// Shared paste entry point — the single place paste settings are honored.
// Both paste paths (right-click on the terminal, shift+right-click menu's
// Paste) go through here:
//   - pasteTrim:    trim trailing whitespace/newlines (core/common)
//   - pasteWarning: multi-line pastes ask first (confirmDialog); a
//                   single-line command pastes straight through

import { trimPasteContent } from "../core/common";
import { configStore } from "../core/store";
import { confirmPaste } from "../ui/confirm";

interface PasteTarget {
  paste(text: string): void;
}

export function pasteIntoTerminal(target: PasteTarget, raw: string): void {
  const text = trimPasteContent(raw, configStore.get("pasteTrim"));
  if (!text) return;

  // A single trailing newline just means "run the command" — it is not a
  // multi-line paste. Interior newlines are what the warning guards.
  const body = text.replace(/\r?\n$/, "");
  if (!body.includes("\n") || !configStore.get("pasteWarning")) {
    target.paste(text);
    return;
  }

  // Editable preview (design): the user reviews — and can edit — the exact
  // text before it runs. The confirmed text pastes verbatim (a trailing
  // newline executes the last line, as before).
  const lines = body.split("\n").length;
  confirmPaste({ lines, text }).then((edited) => {
    if (edited !== null) target.paste(edited);
  });
}
