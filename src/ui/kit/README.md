# TTerm UI kit

Shared design-system controls for the **app** and **`docs/*-preview.html`**.

## Single source of truth

| Concern | Path | Rule |
|---------|------|------|
| Tokens | [`../tokens.css`](../tokens.css) | `--tt-*` only; change skins here |
| Controls | [`controls.css`](./controls.css) | Select / toggle / buttons / stepper |
| Palette surface | [`palette.css`](./palette.css) | `.pal-*` overlay / panel / rows |
| Confirm surface | [`confirm.css`](./confirm.css) | `.cf-*` overlay / dialog |
| Forward table | [`forwardtable.css`](./forwardtable.css) | `.ft-*` port-forward groups / rows / + |
| Fixed chrome (HTML) | [`shell.ts`](./shell.ts) | `createPaletteShell` / `createConfirm*Dialog` |
| Quick panel DOM | [`qp/view.ts`](./qp/view.ts) | Pure lit `qpPanelView(model, actions)` |
| Command list | [`../../core/commands.ts`](../../core/commands.ts) | Palette + Settings keyboard titles / order / groups / defaults |
| Modal behavior | [`../modal.ts`](../modal.ts) | Escape / backdrop / singleton — empty overlay only |
| DOM invariants | [`../../../tests/ui-contracts/`](../../../tests/ui-contracts/) | Assert against app + view fixtures |

Previews **must** `<link>` / `import` these files. Never redefine `.pal-*`, `.cf-*`, `.ft-*`, `.tt-*`, or paste parallel product markup (`.qp-section` trees, confirm dialogs, palette shells, `.ft` tables).

**Draft-only** (ok in preview `<style>` / script): page chrome, stage layout, notes, fake **view-models**, action wiring, and positioning overrides (e.g. `.app .pal-overlay { position: absolute; display: none }` + `.open`).

## One render path

Stateful product chrome uses **one lit view** (or shell builder) for both app and draft:

```html
<script type="module">
  import { render } from "/src/ui/lit.ts";
  import { qpPanelView } from "/src/ui/kit/qp/view.ts";
  render(qpPanelView(fakeModel, demoActions), panelEl);
</script>
```

App maps live tab/store → the same model. New DOM invariant → add/update a function in `tests/ui-contracts/` in the **same PR**.

## Files

| Path | Role |
|------|------|
| [`../tokens.css`](../tokens.css) | `--tt-*` tokens (production source of truth) |
| [`controls.css`](./controls.css) | Select, toggle, buttons, stepper |
| [`palette.css`](./palette.css) | Command palette / tab quick-open / MRU chrome |
| [`confirm.css`](./confirm.css) | Confirm dialog chrome |
| [`forwardtable.css`](./forwardtable.css) | Port-forward table (Settings + QP) |
| [`shell.ts`](./shell.ts) | Fixed DOM structure for palette + confirm |
| [`qp/view.ts`](./qp/view.ts) | Quick panel lit view (header + sections) |
| [`../select.ts`](../select.ts) | `ttSelect` behavior (portal + fixed menu) |
| [`../modal.ts`](../modal.ts) | Modals; `close()` always clears open selects |
| [`../stepper.ts`](../stepper.ts) | Number stepper |
| [`../lit.ts`](../lit.ts) | lit-html + Settings vocabulary (`.section` / `.row`) |

Drafts link:

```html
<link rel="stylesheet" href="/docs/ui/tokens.css" />
<link rel="stylesheet" href="/docs/ui/aliases.css" />
<link rel="stylesheet" href="/src/ui/kit/controls.css" />
<link rel="stylesheet" href="/src/ui/kit/palette.css" />
<link rel="stylesheet" href="/src/ui/kit/confirm.css" />
<link rel="stylesheet" href="/src/ui/kit/forwardtable.css" />
```

App: [`index.html`](../../../index.html) loads tokens; [`styles.css`](../../styles.css) `@import`s this kit.

## Contract

- **Select:** `.tt-select` / `.tt-select-trigger` / `.tt-select-menu` / `.tt-option` / `.tt-optgroup`
- **Toggle:** `.tt-switch` / `.tt-knob`
- **Buttons:** `.tt-btn` + `.tt-btn-primary|ghost|solid|danger|danger-fill|link`
- **Settings layout:** `.section` / `.section-title` / `.row` / …
- **Confirm:** `createConfirmPasteDialog` / `createConfirmMessageDialog`
- **Forward table:** `createForwardTable` + `.ft-*` — Settings host editor and
  quick panel share one compact layout (listen port \| target \| +)
- **Palette:** `createPaletteShell({ kind })`
- **Quick panel:** `qpPanelView(model, actions)` — hardware flow greys RTS only (no hint prose)
- **Type:** only `--tt-fs-*`, `--tt-*-weight`, `--tt-ui` / `--tt-mono`

Do **not** redefine these rules or paste parallel product HTML inside preview markup.
