// Editable port-forward table — grouped by direction: Local / Remote /
// Dynamic. The group IS the direction indicator (no per-row arrows).
// Columns and validation rules are declared once as data; the engine
// renders rows, enforces rules on commit, and manages add/edit/delete.
// Used by the SSH host editor (Settings → SSH) and the quick panel.
//
// Rows are ForwardEditorValue (ui/forwardeditor.ts). The listen host is
// pinned to 127.0.0.1 by design: only its port is editable. Dynamic
// forwards are SOCKS5 listeners and have no target endpoint.
//
// Renders through lit-html (docs/frontend-governance.md P3): commits diff
// the table instead of rebuilding it, so a half-typed add-row in one group
// survives a commit in another — the innerHTML rebuild this replaced used
// to wipe pending input across ALL groups on every change.

import { el } from "./dom";
import type { ForwardEditorValue, ForwardKind } from "./forwardeditor";
import { html, render, repeat, type TemplateResult } from "./lit";
import { showToast } from "./toast";

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

// Target host is optional: empty defaults to 127.0.0.1 on commit (the
// listen side's own loopback — the most common target). Spaces are the
// only hard error.
const hostRule: Rule = {
  check(raw) {
    if (/\s/.test(raw.trim())) return "Host must not contain spaces";
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
  {
    kind: "local",
    title: "Local (-L)",
    desc: "Listen here, reach a target through the server",
    hasTarget: true,
    accent: "ft-g-local",
    targetHostPh: "127.0.0.1 (Remote)",
  },
  {
    kind: "remote",
    title: "Remote (-R)",
    desc: "Listen on the server, reach a target from here",
    hasTarget: true,
    accent: "ft-g-remote",
    targetHostPh: "127.0.0.1 (Local)",
  },
  {
    kind: "dynamic",
    title: "Dynamic (-D)",
    desc: "SOCKS5 proxy listening here, any destination",
    hasTarget: false,
    accent: "ft-g-dynamic",
    targetHostPh: "",
  },
];

// -- Row model ------------------------------------------------------------

interface Draft {
  kind: ForwardKind;
  listenPort: string;
  targetHost: string;
  targetPort: string;
}

function toRow(d: Draft): ForwardEditorValue {
  // Target fields exist only for local/remote groups; a blank target host
  // there means "the listen side's own loopback".
  const hasTarget = d.targetPort.trim() !== "";
  return {
    kind: d.kind,
    listenHost: "127.0.0.1",
    listenPort: parseInt(d.listenPort, 10),
    targetHost: hasTarget ? d.targetHost.trim() || "127.0.0.1" : "",
    targetPort: hasTarget ? parseInt(d.targetPort, 10) : 0,
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
    return {
      kind,
      listenHost: m[1],
      listenPort: parseInt(m[2], 10),
      targetHost: "",
      targetPort: 0,
    };
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

// Lucide-style inline icons (same stroke style as the GitHub icon in
// settings/general.ts) — crisper than text glyphs at small sizes. Inline
// templates, not innerHTML strings: lit stamps them per render.
const iconX = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const iconPlus = html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;

function blankDraft(kind: ForwardKind): Draft {
  return { kind, listenPort: "", targetHost: "", targetPort: "" };
}

interface EditState {
  row: ForwardEditorValue;
  draft: Draft;
}

export function createForwardTable(
  initial: ForwardEditorValue[] = [],
  opts: ForwardTableOptions = {},
): ForwardTable {
  const data: ForwardEditorValue[] = initial.map((r) => ({ ...r }));
  const root = el("div", opts.compact ? "ft ft-compact" : "ft");

  // Pending add-row input per group — this is the state the old rebuild
  // destroyed on every commit anywhere in the table.
  const addDrafts: Record<ForwardKind, Draft> = {
    local: blankDraft("local"),
    remote: blankDraft("remote"),
    dynamic: blankDraft("dynamic"),
  };
  let editing: EditState | null = null;

  function rerender(): void {
    render(tableTemplate(), root);
  }

  /** Validate an edit/add row's inputs against the rules, reading the
   *  live DOM (tests and users can set .value without firing input).
   *  Returns the inputs in commit order, or null after flagging the
   *  first offending field. */
  function validateRow(rowEl: HTMLElement, hasTarget: boolean) {
    const listenPort = rowEl.querySelector<HTMLInputElement>('input[aria-label="Listen port"]')!;
    const fields: { input: HTMLInputElement; rule: Rule }[] = [
      { input: listenPort, rule: portRule },
    ];
    if (hasTarget) {
      fields.push(
        {
          input: rowEl.querySelector<HTMLInputElement>('input[aria-label="Target host"]')!,
          rule: hostRule,
        },
        {
          input: rowEl.querySelector<HTMLInputElement>('input[aria-label="Target port"]')!,
          rule: portRule,
        },
      );
    }
    for (const f of fields) {
      const err = f.rule.check(f.input.value);
      if (err) {
        showToast(err, "error");
        f.input.classList.add("ft-invalid");
        f.input.focus();
        return null;
      }
    }
    return fields;
  }

  /** Edit-mode row inside a group: pinned listen host + port, target
   *  fields when the group has one, then commit/cancel. `rowClass` is
   *  "ft-row ft-editing" for row edits and "ft-row ft-add-row" for the
   *  per-group add-row (CSS and tests key off both). */
  function editRowTemplate(
    group: GroupDef,
    draft: Draft,
    commitLabel: string,
    rowClass: string,
    onCommit: (fields: { input: HTMLInputElement; rule: Rule }[]) => void,
    onCancel: (() => void) | null,
  ): TemplateResult {
    return html`<div class=${rowClass}>
      <span class="ft-cell ft-listen">
        ${opts.compact ? "" : html`<span class="ft-pin">127.0.0.1 :</span>`}
        <input
          class="ft-port"
          type="text"
          spellcheck="false"
          placeholder="Port"
          aria-label="Listen port"
          .value=${draft.listenPort}
          @input=${(e: Event) => liveCheck(e, portRule, (v) => (draft.listenPort = v))}
        />
      </span>
      ${
        group.hasTarget
          ? html`<span class="ft-cell ft-target">
            <input
              class="ft-host"
              type="text"
              spellcheck="false"
              placeholder=${group.targetHostPh}
              aria-label="Target host"
              .value=${draft.targetHost}
              @input=${(e: Event) => liveCheck(e, hostRule, (v) => (draft.targetHost = v))}
            />
            <span class="ft-pin">:</span>
            <input
              class="ft-port"
              type="text"
              spellcheck="false"
              placeholder="Port"
              aria-label="Target port"
              .value=${draft.targetPort}
              @input=${(e: Event) => liveCheck(e, portRule, (v) => (draft.targetPort = v))}
            />
          </span>`
          : html`<span class="ft-cell ft-target ft-socks">any destination (SOCKS5)</span>`
      }
      <span class="ft-cell ft-actions">
        <button
          type="button"
          class="ft-btn ft-ok${commitLabel === "Add" ? " ft-add" : ""}"
          title=${commitLabel === "Add" ? `Add ${group.kind} forward` : "Apply"}
          @click=${(e: MouseEvent) => {
            const rowEl = (e.currentTarget as HTMLElement).closest(".ft-row") as HTMLElement;
            const fields = validateRow(rowEl, group.hasTarget);
            if (fields) onCommit(fields);
          }}
        >
          ${opts.compact && commitLabel === "Add" ? iconPlus : commitLabel}
        </button>
        ${
          onCancel
            ? html`<button
              type="button"
              class="ft-btn ft-cancel"
              title="Cancel"
              @click=${onCancel}
            >
              ${iconX}
            </button>`
            : ""
        }
      </span>
    </div>`;
  }

  /** Live validation on input: flag the field and mirror the value into
   *  the draft (commit re-reads the DOM anyway; the draft is the
   *  re-render survival kit). */
  function liveCheck(e: Event, rule: Rule, apply: (v: string) => void): void {
    const input = e.target as HTMLInputElement;
    apply(input.value);
    const err = rule.check(input.value);
    input.classList.toggle("ft-invalid", err !== null);
    input.title = err ?? "";
  }

  /** A committed row in display mode. */
  function displayRowTemplate(r: ForwardEditorValue): TemplateResult {
    return html`<div class="ft-row">
      <span class="ft-cell ft-listen" title="${r.listenHost}:${r.listenPort}"
        >${opts.compact ? String(r.listenPort) : `${r.listenHost}:${r.listenPort}`}</span
      >
      <span class="ft-cell ft-target${r.kind === "dynamic" ? " ft-socks" : ""}"
        >${r.kind === "dynamic" ? "any destination (SOCKS5)" : `${r.targetHost}:${r.targetPort}`}</span
      >
      <span class="ft-cell ft-actions">
        ${
          opts.editable !== false
            ? html`<button
              type="button"
              class="ft-btn ft-edit"
              title="Edit forward"
              @click=${() => {
                editing = { row: r, draft: fromRow(r) };
                rerender();
              }}
            >
              ✎
            </button>`
            : ""
        }
        <button
          type="button"
          class="ft-btn ft-del"
          title="Delete forward"
          @click=${(e: MouseEvent) => {
            const idx = data.indexOf(r);
            if (!opts.onRemove) {
              if (idx >= 0) data.splice(idx, 1);
              rerender();
              return;
            }
            const del = e.currentTarget as HTMLButtonElement;
            del.disabled = true;
            opts.onRemove(r).then((ok) => {
              if (!ok) {
                del.disabled = false;
                return;
              }
              if (idx >= 0) data.splice(idx, 1);
              rerender();
            });
          }}
        >
          ${iconX}
        </button>
      </span>
    </div>`;
  }

  function groupTemplate(group: GroupDef): TemplateResult {
    const rows = data.filter((r) => r.kind === group.kind);
    return html`<div class="ft-group">
      <div class="ft-group-head">
        <span class="ft-group-title ${group.accent}">${group.title}</span>
        <span class="ft-group-desc">${group.desc}</span>
      </div>
      ${repeat(
        rows,
        (r) => r,
        (r) => {
          if (editing?.row !== r) return displayRowTemplate(r);
          // Capture in a local: TS can't narrow the module-level `editing`
          // through the repeat callback boundary.
          const edit = editing;
          return editRowTemplate(
            group,
            edit.draft,
            "✓",
            "ft-row ft-editing",
            (fields) => {
              edit.draft.listenPort = fields[0].input.value;
              if (group.hasTarget) {
                edit.draft.targetHost = fields[1].input.value;
                edit.draft.targetPort = fields[2].input.value;
              }
              const idx = data.indexOf(edit.row);
              if (idx >= 0) data[idx] = toRow(edit.draft);
              editing = null;
              rerender();
            },
            () => {
              editing = null;
              rerender();
            },
          );
        },
      )}
      ${addRowTemplate(group)}
    </div>`;
  }

  function addRowTemplate(group: GroupDef): TemplateResult {
    const draft = addDrafts[group.kind];
    return editRowTemplate(
      group,
      draft,
      "Add",
      "ft-row ft-add-row",
      (fields) => {
        draft.listenPort = fields[0].input.value;
        if (group.hasTarget) {
          draft.targetHost = fields[1].input.value;
          draft.targetPort = fields[2].input.value;
        }
        const row = toRow(draft);
        if (!opts.onAdd) {
          data.push(row);
          addDrafts[group.kind] = blankDraft(group.kind);
          rerender();
          return;
        }
        opts.onAdd(row).then((ok) => {
          if (!ok) return; // inputs stay, the caller toasts why
          data.push(row);
          addDrafts[group.kind] = blankDraft(group.kind);
          rerender();
        });
      },
      null,
    );
  }

  function tableTemplate(): TemplateResult {
    return html`${GROUPS.map(groupTemplate)}`;
  }

  rerender();
  return { el: root, rows: () => data.map((r) => ({ ...r })) };
}
