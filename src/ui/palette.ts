// Command palette (Ctrl+Shift+P) — the ">" face of the quick-open shell
// (docs/command-palette-preview.html).
//
// Model: one overlay, a fixed chrome ">" (.pal-prefix) on the command root,
// an input that holds only the filter/query (never the ">"), and a page STACK
// for two-level flows (New Local/SSH/Serial Tab → target; Temporary Connect…
// → open tab; password is typed in the terminal like any other SSH session).
// Escape pops one level; at the root it closes. Backspace on an
// empty command-root input flips back to quick open (tabs); typing ">" there
// flips in — the two share one continuous input, VS Code style.
//
// Commands come from KEY_COMMANDS (core/keymap): every palette action is a
// registered command, so it appears in Settings → Keyboard and can be
// bound; commands with "" default are palette-only until bound. Execution
// goes through runCommand(id) — the same handlers the keymap dispatches.
//
// Data and actions are injected (setPaletteHandlers) — this module never
// imports TabManager, same acyclic pattern as quickpanel.ts.

import { allSerialProfiles } from "../config/serial-profiles";
import { entryLabel, entryToHost, listSshHistory, rememberSshHistory } from "../config/ssh-history";
import { hostProp, SERIAL_BAUD_RATES } from "../core/common";
import { logCatch } from "../core/errorlog";
import { formatCombo, KEY_COMMANDS, resolveKeybindings, runCommand } from "../core/keymap";
import { configStore } from "../core/store";
import type { SerialFlowControl, SerialInputMode, SerialPort, SshHost } from "../core/types";
import { el } from "./dom";
import {
  addForward,
  type ForwardInfo,
  listForwards,
  type NewForward,
  removeForward,
} from "./forwarding";
import { createPaletteShell } from "./kit/shell";
import { showToast } from "./toast";

export interface PaletteHandlers {
  listLocalProfiles: () => { name: string; command: string }[];
  listSshHosts: () => SshHost[];
  // Fresh enumeration may be async — the page shows a loading row.
  listSerialPorts: () => Promise<SerialPort[]>;
  openLocalTab: (command?: string, label?: string) => void;
  openSshTab: (host: SshHost, password?: string) => void;
  openSerialTab: (port: SerialPort) => void;
  // Active-tab context for session commands (serial setters, forwards).
  getActiveTab: () => { id: string; type: string; sshEmbedded?: boolean } | null;
  setSerialBaud: (id: string, baud: number) => void;
  setSerialProfile: (id: string, name: string) => void;
  setSerialFlow: (id: string, flow: SerialFlowControl) => void;
  setSerialInputMode: (id: string, mode: SerialInputMode) => void;
  // Deleting the chrome ">" (Backspace on empty command root) returns to
  // quick open with the rest as query.
  flipToQuickOpen: (query: string) => void;
}

let _handlers: PaletteHandlers | null = null;

export function setPaletteHandlers(h: PaletteHandlers): void {
  _handlers = h;
}

// ---- Page model ----

interface PaletteRow {
  label: string;
  detail?: string;
  kbd?: string;
  /** Command palette section (draft .pal-group). */
  group?: string;
  /**
   * Tab fills this into the input without running action (Temporary Connect
   * Recent → edit port / user before connecting).
   */
  complete?: string;
  /** Glyph chips shown only while selected (Recent: keycap + action word). */
  selectHints?: { key: string; action: string }[];
  action: () => void;
}

type PalettePage =
  | { kind: "commands" }
  | {
      kind: "list";
      title: string;
      placeholder?: string;
      rows: () => PaletteRow[] | Promise<PaletteRow[]>;
    }
  | {
      kind: "text";
      title: string;
      placeholder: string;
      password?: boolean;
      /** Optional section header above live rows (draft: AUTHENTICATE). */
      group?: string;
      /** Live rows under the input (draft temp-SSH host / password steps). */
      rows?: (value: string) => PaletteRow[];
      /** Enter always submits; row clicks run their own action. */
      submit: (value: string) => void;
    };

let overlay: HTMLElement | null = null;
let stack: PalettePage[] = [];
let rows: PaletteRow[] = [];
let selected = 0;
let listEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let prefixEl: HTMLElement | null = null;
// Generation guard: an async list resolve from a stale page must not render.
let pageGen = 0;

export function paletteOpen(): boolean {
  return overlay !== null;
}

function top(): PalettePage {
  return stack[stack.length - 1];
}

function push(page: PalettePage): void {
  stack.push(page);
  selected = 0;
  // Secondary pages start with a blank filter (draft clears the field).
  if (inputEl && page.kind !== "commands") inputEl.value = "";
  void renderPage();
}

function pop(): void {
  if (stack.length > 1) {
    stack.pop();
    selected = 0;
    if (inputEl) inputEl.value = "";
    void renderPage();
  } else {
    close();
  }
}

function syncPrefix(): void {
  prefixEl?.classList.toggle("on", top()?.kind === "commands");
}

function inputQuery(): string {
  return inputEl?.value ?? "";
}

// ---- Command list ----

function commandRows(query: string): PaletteRow[] {
  const bindings = resolveKeybindings(configStore.get("keybindings"));
  const q = query.trim().toLowerCase();
  // Only commands with a draft `group` appear in the palette (order = registry).
  return KEY_COMMANDS.filter(
    (c) =>
      c.group &&
      (!q ||
        c.title.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q)),
  ).map((c) => ({
    label: c.title,
    group: c.group,
    kbd: bindings[c.id] ? formatCombo(bindings[c.id]) : undefined,
    action: () => run(() => runCommand(c.id)),
  }));
}

// ---- Two-level flows ----

function newTabLocalPage(): PalettePage {
  return {
    kind: "list",
    title: "Local shells",
    placeholder: "Local shell — type to filter",
    rows: () => {
      const h = _handlers;
      if (!h) return [];
      const profiles = h.listLocalProfiles();
      if (profiles.length === 0) {
        return [{ label: "Default shell", action: () => run(h.openLocalTab) }];
      }
      return profiles.map((p) => ({
        label: p.name,
        detail: p.command,
        action: () => run(() => h.openLocalTab(p.command, p.name)),
      }));
    },
  };
}

function parseTempHost(input: string): SshHost | null {
  // user@host[:port] — any part except host may be omitted.
  const m = /^(?:([^@]+)@)?([^:]+?)(?::(\d+))?$/.exec(input.trim());
  if (!m) return null;
  const host: SshHost = { name: m[2], hostname: m[2] };
  if (m[1]) host.user = m[1];
  if (m[3]) host.port = m[3];
  return host;
}

function tempHostLabel(host: SshHost): string {
  const h = host.hostname || host.name;
  const base = host.user ? `${host.user}@${h}` : h;
  // Always show port (default 22) — matches draft Connect → sync row.
  return `${base}:${host.port || "22"}`;
}

/** Value filled into the input on Tab (always includes port for easy edit). */
function historyComplete(e: { user?: string; hostname: string; port?: string }): string {
  const base = e.user ? `${e.user}@${e.hostname}` : e.hostname;
  return `${base}:${e.port && e.port !== "22" ? e.port : "22"}`;
}

/** Open tab + bump local history. Password is typed in the terminal (unified). */
function connectTempSsh(host: SshHost): void {
  const h = _handlers;
  if (!h) return;
  rememberSshHistory(host).catch(logCatch("sshHistory.remember"));
  close();
  h.openSshTab(host);
}

/**
 * Host step: row 0 is the live Connect → sync (or Examples when empty) —
 * default-selected as the closest match. Recent ranked below; Tab on a
 * history row completes into the input without connecting.
 */
function tempSshHostPage(): PalettePage {
  return {
    kind: "text",
    title: "SSH · Temporary",
    placeholder: "user@host[:port] — kept in connection history",
    rows: (value) => {
      const q = value.trim().toLowerCase();
      const host = parseTempHost(value);
      const recent = listSshHistory()
        .filter((e) => {
          if (!q) return true;
          const label = entryLabel(e).toLowerCase();
          return (
            label.includes(q) ||
            e.hostname.toLowerCase().includes(q) ||
            (e.user ?? "").toLowerCase().includes(q) ||
            (e.port ?? "").includes(q)
          );
        })
        .map((e) => ({
          label: entryLabel(e),
          group: "Recent",
          complete: historyComplete(e),
          selectHints: [
            { key: "Enter", action: "connect" },
            { key: "Tab", action: "complete" },
          ],
          action: () => connectTempSsh(entryToHost(e)),
        }));

      const out: PaletteRow[] = [];
      // Fixed first row: live Connect → (content-synced) or Examples hint.
      if (host) {
        out.push({
          label: `Connect → ${tempHostLabel(host)}`,
          action: () => connectTempSsh(host),
        });
      } else {
        out.push({
          label: "Examples: pi@example.raspi.lan · root@lab.example.com:2222",
          action: () => {},
        });
      }
      out.push(...recent);
      return out;
    },
    submit: (value) => {
      const host = parseTempHost(value);
      if (!host) {
        showToast("Use user@host[:port]", "error");
        return;
      }
      connectTempSsh(host);
    },
  };
}

function newTabSshPage(): PalettePage {
  return {
    kind: "list",
    title: "SSH hosts",
    placeholder: "SSH host — type to filter",
    rows: () => {
      const h = _handlers;
      if (!h) return [];
      return h.listSshHosts().map((host) => ({
        label: host.name,
        detail: `${hostProp(host, "user")}@${hostProp(host, "hostname") || host.name}`,
        action: () => run(() => h.openSshTab(host)),
      }));
    },
  };
}

function newTabSerialPage(): PalettePage {
  return {
    kind: "list",
    title: "Serial ports",
    placeholder: "Serial port — type to filter",
    rows: async () => {
      const h = _handlers;
      if (!h) return [];
      const ports = await h.listSerialPorts();
      return ports.map((p) => ({
        label: p.name,
        detail: p.product || p.driver || undefined,
        action: () => run(() => h.openSerialTab(p)),
      }));
    },
  };
}

/** Embedded-SSH-only commands get the same honest refusal. Returns the
 *  tab id when usable, null after toasting otherwise. */
function activeEmbeddedSshTab(): string | null {
  const tab = _handlers?.getActiveTab();
  if (tab?.type !== "ssh" || tab.sshEmbedded !== true) {
    showToast("Active tab is not an embedded-SSH session", "error");
    return null;
  }
  return tab.id;
}

// -- Port forwards (in-overlay, design: 不另开窗) --

function parsePortField(value: string): number | null {
  const n = parseInt(value.trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function forwardTextPage(
  title: string,
  placeholder: string,
  validate: (value: string) => string | null,
  next: (value: string) => void,
): PalettePage {
  return {
    kind: "text",
    title,
    placeholder,
    submit: (value) => {
      const err = validate(value);
      if (err) {
        showToast(err, "error");
        return;
      }
      next(value.trim());
    },
  };
}

/** Two/three-step add flow: local and remote collect listen-port →
 *  target-host → target-port; dynamic just the listen port. */
function pushForwardForm(kind: "local" | "remote" | "dynamic"): void {
  const tabId = activeEmbeddedSshTab();
  if (!tabId) {
    close();
    return;
  }
  const finish = (f: NewForward): void => {
    close();
    void addForward(tabId, f);
  };
  const portValidator = (v: string) => (parsePortField(v) === null ? `Invalid port: ${v}` : null);
  const hostValidator = (v: string) => (v.trim() ? null : "Target host required");
  push(
    forwardTextPage(
      `Forward · listen port${kind === "remote" ? " (remote)" : ""}`,
      kind === "dynamic" ? "1080" : "8080",
      portValidator,
      (listenText) => {
        // Validated by portValidator upstream — always a number here.
        const listenPort = parsePortField(listenText) ?? 0;
        if (kind === "dynamic") {
          finish({
            kind,
            listenHost: "127.0.0.1",
            listenPort,
            targetHost: "",
            targetPort: 0,
          });
          return;
        }
        push(
          forwardTextPage("Forward · target host", "127.0.0.1", hostValidator, (targetHost) => {
            push(
              forwardTextPage("Forward · target port", "3000", portValidator, (targetText) => {
                finish({
                  kind,
                  listenHost: "127.0.0.1",
                  listenPort,
                  targetHost,
                  targetPort: parsePortField(targetText) ?? 0,
                });
              }),
            );
          }),
        );
      },
    ),
  );
}

const FORWARD_KIND_LABELS: Record<string, string> = {
  local: "Local (-L)",
  remote: "Remote (-R)",
  dynamic: "Dynamic (-D)",
};

function forwardRoute(f: ForwardInfo): string {
  const listen = `${f.listenHost}:${f.listenPort}`;
  return f.kind === "dynamic"
    ? `${listen} → any destination (SOCKS5)`
    : `${listen} → ${f.targetHost}:${f.targetPort}`;
}

function forwardsPage(): PalettePage {
  return {
    kind: "list",
    title: "SSH · Port Forwards",
    rows: async (): Promise<PaletteRow[]> => {
      const tabId = activeEmbeddedSshTab();
      if (!tabId) return [];
      const forwards = (await listForwards(tabId)) ?? [];
      const actions: PaletteRow[] = [
        { label: "Add Local Forward…", action: () => pushForwardForm("local") },
        { label: "Add Remote Forward…", action: () => pushForwardForm("remote") },
        { label: "Add Dynamic Forward…", action: () => pushForwardForm("dynamic") },
      ];
      if (forwards.length > 0) {
        actions.push({
          label: `Remove all forwards (${forwards.length})`,
          action: () => {
            void (async () => {
              for (const f of forwards) await removeForward(tabId, f.forwardId);
              await renderPage();
            })();
          },
        });
      }
      return [
        ...actions,
        ...forwards.map((f) => ({
          label: forwardRoute(f),
          detail: FORWARD_KIND_LABELS[f.kind] ?? f.kind,
          action: () => {
            void removeForward(tabId, f.forwardId).then(() => renderPage());
          },
        })),
      ];
    },
  };
}

/** Session commands operate on the active serial tab; anything else gets
 *  an explanation, not silence (UX-06). */
function withActiveSerialTab(fn: (id: string) => void): void {
  const tab = _handlers?.getActiveTab();
  if (tab?.type !== "serial") {
    showToast("Active tab is not a serial session", "error");
    return;
  }
  fn(tab.id);
}

function serialProfilePage(): PalettePage {
  return {
    kind: "list",
    title: "Serial profile",
    placeholder: "Serial profile — type to filter",
    rows: () =>
      allSerialProfiles().map((p) => ({
        label: p.name,
        detail: `${p.inputMode} · flow ${p.flowControl}`,
        action: () =>
          run(() => withActiveSerialTab((id) => _handlers?.setSerialProfile(id, p.name))),
      })),
  };
}

function serialBaudPage(): PalettePage {
  return {
    kind: "list",
    title: "Baud rate",
    placeholder: "Baud rate — type to filter",
    rows: () =>
      SERIAL_BAUD_RATES.map((b) => ({
        label: String(b),
        action: () => run(() => withActiveSerialTab((id) => _handlers?.setSerialBaud(id, b))),
      })),
  };
}

function serialFlowPage(): PalettePage {
  return {
    kind: "list",
    title: "Flow control",
    placeholder: "Flow control — type to filter",
    rows: () => [
      {
        label: "None",
        action: () => run(() => withActiveSerialTab((id) => _handlers?.setSerialFlow(id, "none"))),
      },
      {
        label: "Software (XON/XOFF)",
        action: () =>
          run(() => withActiveSerialTab((id) => _handlers?.setSerialFlow(id, "software"))),
      },
      {
        label: "Hardware (RTS/CTS)",
        action: () =>
          run(() => withActiveSerialTab((id) => _handlers?.setSerialFlow(id, "hardware"))),
      },
    ],
  };
}

function serialInputModePage(): PalettePage {
  return {
    kind: "list",
    title: "Input mode",
    placeholder: "Input mode — type to filter",
    rows: () =>
      (
        [
          ["normal", "Normal"],
          ["echo", "Echo"],
          ["line", "Line by Line"],
        ] as const
      ).map(([mode, label]) => ({
        label,
        action: () =>
          run(() => withActiveSerialTab((id) => _handlers?.setSerialInputMode(id, mode))),
      })),
  };
}

// ---- Overlay ----

function run(action: () => void): void {
  close();
  action();
}

async function renderPage(): Promise<void> {
  if (!listEl || !inputEl) return;
  const page = top();
  const gen = ++pageGen;
  syncPrefix();

  inputEl.placeholder =
    page.kind === "commands"
      ? "Type a command…"
      : page.kind === "text"
        ? page.placeholder
        : (page.placeholder ?? `${page.title} — type to filter`);
  inputEl.type = page.kind === "text" && page.password ? "password" : "text";

  let pageRows: PaletteRow[];
  if (page.kind === "commands") {
    pageRows = commandRows(inputQuery());
  } else if (page.kind === "text") {
    pageRows = page.rows?.(inputQuery()) ?? [];
  } else {
    listEl.textContent = "";
    listEl.appendChild(el("div", "pal-empty", "Loading…"));
    const resolved = await page.rows();
    if (gen !== pageGen) return; // stale page
    const q = inputQuery().trim().toLowerCase();
    pageRows = q
      ? resolved.filter(
          (r) => r.label.toLowerCase().includes(q) || (r.detail ?? "").toLowerCase().includes(q),
        )
      : resolved;
  }
  rows = pageRows;
  selected = Math.min(selected, Math.max(0, rows.length - 1));

  listEl.textContent = "";
  if (page.kind === "text" && !page.rows) {
    listEl.appendChild(
      el(
        "div",
        "pal-empty",
        page.password ? "Type password, then Enter" : "Enter user@host[:port]",
      ),
    );
    return;
  }
  if (rows.length === 0) {
    const empty =
      page.kind === "commands"
        ? "No matching commands"
        : page.kind === "text"
          ? page.password
            ? "Type password, then Enter"
            : "Enter user@host[:port]"
          : page.title === "Connection type"
            ? "No matching kinds"
            : page.title === "Local shells" ||
                page.title === "SSH hosts" ||
                page.title === "Serial ports"
              ? "No matching targets"
              : "No matching values";
    listEl.appendChild(el("div", "pal-empty", empty));
    return;
  }

  // Group headers: palette commands / text live-rows use KeyCommand.group /
  // PaletteRow.group; list pages use title.
  let lastGroup = "";
  rows.forEach((r, i) => {
    if ((page.kind === "commands" || page.kind === "text") && r.group && r.group !== lastGroup) {
      lastGroup = r.group;
      listEl?.appendChild(el("div", "pal-group", r.group));
    } else if (page.kind === "list" && i === 0 && page.title) {
      listEl?.appendChild(el("div", "pal-group", page.title));
    } else if (page.kind === "text" && i === 0 && page.group) {
      listEl?.appendChild(el("div", "pal-group", page.group));
    }
    const row = el("div", `pal-row${i === selected ? " selected" : ""}`);
    row.appendChild(el("span", "pal-label", r.label));
    if (r.kbd) row.appendChild(el("span", "pal-kbd", r.kbd));
    else if (r.detail) row.appendChild(el("span", "pal-meta", r.detail));
    if (r.selectHints?.length) {
      const hints = el("span", "pal-row-hints");
      for (const h of r.selectHints) {
        const item = el("span", "pal-hint");
        item.appendChild(el("span", "pal-kbd", h.key));
        item.appendChild(el("span", "pal-hint-action", h.action));
        item.title = `${h.key} — ${h.action}`;
        hints.appendChild(item);
      }
      row.appendChild(hints);
    }
    row.addEventListener("click", () => r.action());
    row.addEventListener("mousemove", () => {
      if (selected !== i) {
        selected = i;
        paintSelections();
      }
    });
    listEl?.appendChild(row);
  });
  listEl.querySelector(".pal-row.selected")?.scrollIntoView({ block: "nearest" });
}

/** Selection repaint without a full re-render (arrows / mousemove). */
function paintSelections(): void {
  const els = listEl?.querySelectorAll(".pal-row");
  if (!els) return;
  for (const [i, row] of els.entries()) {
    row.classList.toggle("selected", i === selected);
  }
}

function onKeydown(e: KeyboardEvent): void {
  const page = top();
  if (e.key === "Escape") {
    e.preventDefault();
    pop();
    return;
  }
  // Chrome ">": Backspace on an empty command-root field flips to quick open.
  if (
    e.key === "Backspace" &&
    page.kind === "commands" &&
    inputEl &&
    inputEl.value === "" &&
    inputEl.selectionStart === 0
  ) {
    e.preventDefault();
    const h = _handlers;
    close();
    h?.flipToQuickOpen("");
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (page.kind === "text") {
      const q = inputEl?.value ?? "";
      // Live rows (Recent / Connect →): Enter activates the selection.
      // Examples is a non-action hint — fall through to submit for the toast.
      const row = page.rows ? rows[selected] : undefined;
      if (row && !row.label.startsWith("Examples:")) {
        row.action();
        return;
      }
      page.submit(q);
      return;
    }
    rows[selected]?.action();
    return;
  }
  // Temporary Connect Recent: Tab completes into the input (edit port) — no connect.
  if (e.key === "Tab" && page.kind === "text" && page.rows) {
    const row = rows[selected];
    if (row?.complete != null && inputEl) {
      e.preventDefault();
      inputEl.value = row.complete;
      selected = 0;
      void renderPage();
      return;
    }
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (page.kind === "text" && !page.rows) return;
    e.preventDefault();
    const len = rows.length;
    selected = len === 0 ? 0 : (((selected + (e.key === "ArrowDown" ? 1 : -1)) % len) + len) % len;
    paintSelections();
    listEl?.querySelector(".pal-row.selected")?.scrollIntoView({ block: "nearest" });
  }
}

function onInput(): void {
  if (!inputEl) return;
  selected = 0;
  void renderPage();
}

/** Open the palette (if needed) and push a two-level flow page. Bound to
 *  the palette-first commands in wiring (New Local/SSH/Serial Tab,
 *  Temporary Connect…, Serial setters). */
export function openPaletteFlow(
  flow:
    | "newLocal"
    | "newSsh"
    | "newSerial"
    | "tempSsh"
    | "serialProfile"
    | "serialBaud"
    | "serialFlow"
    | "serialInputMode"
    | "forwards"
    | "forwardLocal"
    | "forwardRemote"
    | "forwardDynamic",
): void {
  openCommandPalette();
  switch (flow) {
    case "newLocal":
      push(newTabLocalPage());
      break;
    case "newSsh":
      push(newTabSshPage());
      break;
    case "newSerial":
      push(newTabSerialPage());
      break;
    case "forwards":
      if (activeEmbeddedSshTab()) push(forwardsPage());
      else close();
      break;
    case "forwardLocal":
      pushForwardForm("local");
      break;
    case "forwardRemote":
      pushForwardForm("remote");
      break;
    case "forwardDynamic":
      pushForwardForm("dynamic");
      break;
    case "tempSsh":
      // Same page the Tab command New SSH Temporary Tab opens.
      push(tempSshHostPage());
      break;
    case "serialProfile":
      push(serialProfilePage());
      break;
    case "serialBaud":
      push(serialBaudPage());
      break;
    case "serialFlow":
      push(serialFlowPage());
      break;
    case "serialInputMode":
      push(serialInputModePage());
      break;
  }
}

export function openCommandPalette(query = ""): void {
  if (!_handlers) return;
  close();
  stack = [{ kind: "commands" }];
  selected = 0;

  const shell = createPaletteShell({ kind: "commands" });
  overlay = shell.overlay;
  prefixEl = shell.prefix;
  inputEl = shell.input;
  listEl = shell.list;
  if (!inputEl || !listEl) return;
  inputEl.value = query;
  inputEl.setSelectionRange(query.length, query.length);
  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("keydown", onKeydown);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);
  void renderPage();
  inputEl.focus();
}

function close(): void {
  overlay?.remove();
  overlay = null;
  stack = [];
  rows = [];
  listEl = null;
  inputEl = null;
  prefixEl = null;
}
