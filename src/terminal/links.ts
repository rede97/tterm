// Clickable terminal links.
//
// Two flavors:
// - OSC 8 hyperlinks (apps emit clickable text) open on a plain click via
//   the terminal's linkHandler option.
// - Auto-detected http(s) URLs (WebLinksAddon) open on Ctrl+click only, so
//   plain clicks and drag selections over a URL keep behaving as normal
//   text operations.
//
// Both open in the system browser via the opener plugin (opener:default
// already permits http/https/mailto/tel).

import { openUrl } from "@tauri-apps/plugin-opener";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Terminal } from "@xterm/xterm";
import { logError } from "../core/errorlog";
import { showToast } from "../ui/toast";

export function openExternalLink(uri: string): void {
  openUrl(uri).catch((e) => {
    logError("openExternalLink", e);
    showToast(`Failed to open link: ${uri}`, "error");
  });
}

/**
 * WebLinksAddon handler: only Ctrl (Windows/Linux) / Cmd (macOS) clicks
 * open the URL; plain clicks fall through to normal text selection.
 */
export function handleWebLink(event: MouseEvent, uri: string): void {
  if (event.ctrlKey || event.metaKey) openExternalLink(uri);
}

/**
 * Wire link support into a terminal: plain-click OSC 8 hyperlinks plus
 * Ctrl+click auto-detected URLs.
 */
export function setupTerminalLinks(terminal: Terminal): void {
  // OSC 8 explicit hyperlinks: open on plain click. Non-http(s) protocols
  // stay inert (allowNonHttpProtocols left unset).
  terminal.options.linkHandler = {
    activate: (_event, uri) => openExternalLink(uri),
  };
  terminal.loadAddon(new WebLinksAddon(handleWebLink));
}
