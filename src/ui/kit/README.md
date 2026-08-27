# TTerm UI kit

Shared design-system controls for the **app** and **`drafts/*-preview.html`**.

HTML drafts live in [`drafts/`](../../../drafts/) (not mixed with markdown in `docs/`). Hub: [`drafts/index.html`](../../../drafts/index.html). Preview CSS (token re-export, aliases, chrome, thin scroll) is [`drafts/ui/`](../../../drafts/ui/). Production tokens stay [`../tokens.css`](../tokens.css).

Settings preview markup is still static HTML (not a shared lit view). Layout/button 1:1 still applies: 148px `--tt-btn-width`, `.row` wells, visibility = left checkbox `.check-row`, toggles only for a single on/off.

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

## Draft load order

```html
<link rel="stylesheet" href="/drafts/ui/tokens.css" />
<link rel="stylesheet" href="/drafts/ui/aliases.css" />
<link rel="stylesheet" href="/src/ui/kit/controls.css" />
<link rel="stylesheet" href="/src/ui/kit/palette.css" />
<link rel="stylesheet" href="/src/ui/kit/confirm.css" />
<link rel="stylesheet" href="/src/ui/kit/forwardtable.css" />
<link rel="stylesheet" href="/drafts/ui/scroll.css" />
<link rel="stylesheet" href="/drafts/ui/preview-chrome.css" />
<style>/* page-local layout only */</style>
```

1. Never hard-code skin hex in a preview for colors that exist as `--tt-*`.
2. Never redefine `.tt-select` / `.tt-btn*` / `.tt-switch` / `.stepper` / `.pal-*` in preview `<style>`.
3. Tab bar chrome (`--tt-tab-bar`) follows the chrome skin — not terminal schemes.
4. **CONNECTED** = `--tt-ok`; **Share** = `--tt-share`. Do not merge these.
5. Scrollable surfaces use class **`tt-scroll`**. Setting `::-webkit-scrollbar` **width** forces a classic gutter; app QP/Settings use `ui/overlay-scroll.ts` for a true overlay thumb.
6. Palette rows come from `KEY_COMMANDS`; palette/confirm chrome from `shell.ts`; QP DOM from `qpPanelView`.

App: [`index.html`](../../../index.html) loads tokens; [`styles.css`](../../styles.css) `@import`s this kit.

## Contract

- **Select:** `.tt-select` / `.tt-select-trigger` / `.tt-select-menu` / `.tt-option` / `.tt-optgroup`
  (`body.tt-glass` frosts the portaled menu via `--tt-glass-*`)
- **Toggle:** `.tt-switch` / `.tt-knob`
- **Buttons:** `.tt-btn` + `.tt-btn-primary|ghost|solid|danger|danger-fill|link`
- **Settings layout:** `.section` / `.section-title` / `.row` / …
- **Confirm:** `createConfirmPasteDialog` / `createConfirmMessageDialog`
- **Forward table:** `createForwardTable` + `.ft-*` — Settings host editor and
  quick panel share one compact layout (listen port \| target \| +)
- **Palette:** `createPaletteShell({ kind })` + `setPaletteFooter` (Cursor key row)
- **Quick panel:** `qpPanelView(model, actions)` — hardware flow greys RTS only (no hint prose)
- **Type:** only `--tt-fs-*`, `--tt-*-weight`, `--tt-ui` / `--tt-mono`

Do **not** redefine these rules or paste parallel product HTML inside preview markup.

## Skins

- `body[data-skin="cursor"]` — near-black, white CTA, soft radius
- `body[data-skin="vscode"]` — blue accent, tighter radius
- `body.tt-glass` — frosted translucency for menus, dropdowns, and the quick panel (`--tt-glass-*`)

`--term-bg` is NOT a `--tt-*` token — `applyTerminalBackground()` writes it from the terminal scheme (2px seam).
