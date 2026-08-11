// Editable port-forward table — grouped by direction: Local / Remote /
// Dynamic. The group IS the direction indicator (no per-row arrows).
// Columns and validation rules are declared once as data; the engine
// renders rows, enforces rules on commit, and manages add/edit/delete.
// Used by the SSH host editor (Settings → SSH).
//
// Rows are ForwardEditorValue (ui/forwardeditor.ts). The listen host is
// pinned to 127.0.0.1 by design: only its port is editable. Dynamic
// forwards are SOCKS5 listeners and have no target endpoint.

import { showToast } from "./toast";
import type { ForwardEditorValue, ForwardKind } from "./forwardeditor";

export interface ForwardTableOptions {
  // Narrow containers (quick panel): rows stack listen/target on two lines.
  compact?: boolean;
  // Show the ✎ inline-edit button (host-config use). Runtime session
  // forwards can't be edited — delete and re-add — so they pass false.
  editable?: boolean;
  // External commit hooks (runtime session forwards): return false to
  // reject the change (the caller toasts). Without hooks the table keeps
  // its own list (host-config use).
  onAdd?: (r: ForwardEditorValue) => Promise<boolean>;
  onRemove?: (r: ForwardEditorValue) => Promise<boolean>;
}

export interface ForwardTable {
  el: HTMLElement;
  /** Current rows, grouped Local → Remote → Dynamic. */
  rows(): ForwardEditorValue[];
}

// -- Declarative rules ------------------------------------------------
// Each rule takes the raw input text; null = valid, string = the error.

interface Rule {
  check(raw: string): string | null;
}

const portRule: Rule = {
  check(raw) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 && n <= 65535 ? null : "Port must be 1-65535";
  },
};

const hostRule: Rule = {
  check(raw) {
    const v = raw.trim();
    if (!v) return "Host is required";
    if (/\s/.test(v)) return "Host must not contain spaces";
    return null;
  },
};

// -- Group schema -------------------------------------------------------

interface GroupDef {
  kind: ForwardKind;
  title: string;
  desc: string;
  hasTarget: boolean;
  accent: string; // css class for the title accent
  targetHostPh: string; // placeholder locating the target host's side
}

const GROUPS: GroupDef[] = [
  { kind: "local", title: "Local (-L)", desc: "Listen here, reach a target through the server", hasTarget: true, accent: "ft-g-local", targetHostPh: "Host (Remote)" },
  { kind: "remote", title: "Remote (-R)", desc: "Listen on the server, reach a target from here", hasTarget: true, accent: "ft-g-remote", targetHostPh: "Host (Local)" },
  { kind: "dynamic", title: "Dynamic (-D)", desc: "SOCKS5 proxy listening here, any destination", hasTarget: false, accent: "ft-g-dynamic", targetHostPh: "" },
];

// -- Row model ------------------------------------------------------------

interface Draft {
  kind: ForwardKind;
  listenPort: string;
  targetHost: string;
  targetPort: string;
}

function toRow(d: Draft): ForwardEditorValue {
  return {
    kind: d.kind,
    listenHost: "127.0.0.1",
    listenPort: parseInt(d.listenPort, 10),
    targetHost: d.targetHost.trim(),
    targetPort: d.targetHost ? parseInt(d.targetPort, 10) : 0,
  };
}

function fromRow(r: ForwardEditorValue): Draft {
  return {
    kind: r.kind,
    listenPort: String(r.listenPort),
    targetHost: r.targetHost,
    targetPort: r.targetPort > 0 ? String(r.targetPort) : "",
  };
}

/** ssh_config directive value: "127.0.0.1:8080 db.internal:5432" (dynamic:
 * just "127.0.0.1:1080"). */
export function forwardConfigLine(f: ForwardEditorValue): string {
  if (f.kind === "dynamic") return `${f.listenHost}:${f.listenPort}`;
  return `${f.listenHost}:${f.listenPort} ${f.targetHost}:${f.targetPort}`;
}

/** Parse one directive line back into a row; null when malformed. Dynamic
 * lines carry a single endpoint. */
export function parseForwardLine(line: string, kind: ForwardKind): ForwardEditorValue | null {
  if (kind === "dynamic") {
    const m = line.trim().match(/^(\S+):(\d+)$/);
    if (!m) return null;
    return { kind, listenHost: m[1], listenPort: parseInt(m[2], 10), targetHost: "", targetPort: 0 };
  }
  const m = line.trim().match(/^(\S+):(\d+)\s+(\S+):(\d+)$/);
  if (!m) return null;
  return {
    kind,
    listenHost: m[1],
    listenPort: parseInt(m[2], 10),
    targetHost: m[3],
    targetPort: parseInt(m[4], 10),
  };
}

// -- Engine --------------------------------------------------------------

function el(tag: string, className: string, text = ""): HTMLElement {
  const d = document.createElement(tag);
  d.className = className;
  if (text) d.textContent = text;
  return d;
}

function mkBtn(className: string, text: string, title: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  b.title = title;
  return b;
}

function mkInput(aria: string, placeholder: string, port: boolean, value: string, rule: Rule): HTMLInputElement {
  const input = document.createElement("input");
  input.className = port ? "ft-port" : "ft-host";
  input.type = "text";
  input.spellcheck = false;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", aria);
  input.value = value;
  input.addEventListener("input", () => {
    const err = rule.check(input.value);
    input.classList.toggle("ft-invalid", err !== null);
    input.title = err ?? "";
  });
  return input;
}

export function createForwardTable(
  initial: ForwardEditorValue[] = [],
  opts: ForwardTableOptions = {},
): ForwardTable {
  const data: ForwardEditorValue[] = initial.map(r => ({ ...r }));
  const root = el("div", opts.compact ? "ft ft-compact" : "ft");

  /** Edit-mode row inside a group: pinned listen host + port, target
   *  fields when the group has one, then commit/cancel. */
  function editRow(
    group: GroupDef,
    draft: Draft,
    commit: (d: Draft) => void,
    cancel: (() => void) | null,
    commitLabel: string,
  ): HTMLElement {
    const row = el("div", "ft-row ft-editing");

    const listen = el("span", "ft-cell ft-listen");
    listen.appendChild(el("span", "ft-pin", "127.0.0.1 :"));
    const listenPort = mkInput("Listen port", "Port", true, draft.listenPort, portRule);
    listen.appendChild(listenPort);
    row.appendChild(listen);

    const inputs: { input: HTMLInputElement; rule: Rule; apply(): void }[] = [
      { input: listenPort, rule: portRule, apply: () => { draft.listenPort = listenPort.value; } },
    ];

    if (group.hasTarget) {
      const target = el("span", "ft-cell ft-target");
      const host = mkInput("Target host", group.targetHostPh, false, draft.targetHost, hostRule);
      const port = mkInput("Target port", "Port", true, draft.targetPort, portRule);
      target.appendChild(host);
      target.appendChild(el("span", "ft-pin", ":"));
      target.appendChild(port);
      row.appendChild(target);
      inputs.push(
        { input: host, rule: hostRule, apply: () => { draft.targetHost = host.value; } },
        { input: port, rule: portRule, apply: () => { draft.targetPort = port.value; } },
      );
    } else {
      row.appendChild(el("span", "ft-cell ft-target ft-socks", "any destination (SOCKS5)"));
    }

    const actions = el("span", "ft-cell ft-actions");
    const ok = mkBtn(`ft-btn ft-ok${commitLabel === "Add" ? " ft-add" : ""}`, commitLabel,
      commitLabel === "Add" ? `Add ${group.kind} forward` : "Apply");
    ok.addEventListener("click", () => {
      for (const f of inputs) {
        const err = f.rule.check(f.input.value);
        if (err) {
          showToast(err, "error");
          f.input.classList.add("ft-invalid");
          f.input.focus();
          return;
        }
      }
      for (const f of inputs) f.apply();
      commit(draft);
    });
    actions.appendChild(ok);
    if (cancel) {
      const no = mkBtn("ft-btn ft-cancel", "✕", "Cancel");
      no.addEventListener("click", cancel);
      actions.appendChild(no);
    }
    row.appendChild(actions);
    return row;
  }

  /** A committed row in display mode. */
  function displayRow(r: ForwardEditorValue, render: () => void): HTMLElement {
    const row = el("div", "ft-row");
    row.appendChild(el("span", "ft-cell ft-listen", `${r.listenHost}:${r.listenPort}`));
    row.appendChild(el("span", `ft-cell ft-target${r.kind === "dynamic" ? " ft-socks" : ""}`,
      r.kind === "dynamic" ? "any destination (SOCKS5)" : `${r.targetHost}:${r.targetPort}`));
    const actions = el("span", "ft-cell ft-actions");
    if (opts.editable !== false) {
      const edit = mkBtn("ft-btn ft-edit", "✎", "Edit forward");
      edit.addEventListener("click", () => {
        const group = GROUPS.find(g => g.kind === r.kind)!;
        const editor = editRow(group, fromRow(r), (d) => {
          const idx = data.indexOf(r);
          if (idx >= 0) data[idx] = toRow(d);
          render();
        }, render, "✓");
        row.replaceWith(editor);
      });
      actions.appendChild(edit);
    }
    const del = mkBtn("ft-btn ft-del", "✕", "Delete forward");
    del.addEventListener("click", () => {
      if (opts.onRemove) {
        del.disabled = true;
        opts.onRemove(r).then((ok) => {
          if (!ok) { del.disabled = false; return; }
          const idx = data.indexOf(r);
          if (idx >= 0) data.splice(idx, 1);
          render();
        });
        return;
      }
      const idx = data.indexOf(r);
      if (idx >= 0) data.splice(idx, 1);
      render();
    });
    actions.appendChild(del);
    row.appendChild(actions);
    return row;
  }

  function render(): void {
    root.innerHTML = "";
    for (const group of GROUPS) {
      const rows = data.filter(r => r.kind === group.kind);
      // Empty groups with nothing to show collapse to just their add-row.
      const sec = el("div", "ft-group");
      const head = el("div", "ft-group-head");
      head.appendChild(el("span", `ft-group-title ${group.accent}`, group.title));
      head.appendChild(el("span", "ft-group-desc", group.desc));
      sec.appendChild(head);
      for (const r of rows) sec.appendChild(displayRow(r, render));
      const draft: Draft = { kind: group.kind, listenPort: "", targetHost: "", targetPort: "" };
      const addRow = editRow(group, draft, (d) => {
        const row = toRow(d);
        if (opts.onAdd) {
          opts.onAdd(row).then((ok) => {
            if (!ok) return;
            data.push(row);
            render();
          });
          return;
        }
        data.push(row);
        render();
      }, null, "Add");
      addRow.classList.add("ft-add-row");
      addRow.classList.remove("ft-editing");
      sec.appendChild(addRow);
      root.appendChild(sec);
    }
  }

  render();
  return { el: root, rows: () => data.map(r => ({ ...r })) };
}
