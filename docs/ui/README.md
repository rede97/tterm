# TTerm UI design drafts — fact source

Preview HTML under `docs/*-preview.html` shares the **UI kit** with the app.

## Single source of truth

| Concern | Path | Rule |
|---------|------|------|
| Tokens | [`../../src/ui/tokens.css`](../../src/ui/tokens.css) | `--tt-*` production SSOT |
| Controls | [`../../src/ui/kit/controls.css`](../../src/ui/kit/controls.css) | Select / toggle / buttons / stepper |
| Palette surface | [`../../src/ui/kit/palette.css`](../../src/ui/kit/palette.css) | `.pal-*` chrome |
| Confirm surface | [`../../src/ui/kit/confirm.css`](../../src/ui/kit/confirm.css) | `.cf-*` chrome |
| Fixed chrome (HTML) | [`../../src/ui/kit/shell.ts`](../../src/ui/kit/shell.ts) | Palette + confirm DOM builders |
| Quick panel DOM | [`../../src/ui/kit/qp/view.ts`](../../src/ui/kit/qp/view.ts) | Pure lit `qpPanelView` (app + draft) |
| Command list | [`../../src/core/commands.ts`](../../src/core/commands.ts) | Titles / order / groups / defaults |
| DOM contracts | [`../../tests/ui-contracts/`](../../tests/ui-contracts/) | Invariants for app + view fixtures |

Previews **must** link or import these. Never redefine the lists, CSS, shell markup, or paste parallel `.qp-section` / dialog trees.

**Draft-only:** page chrome, fake **view-models**, demo action wiring, and overlay position overrides (absolute + `.open` inside `.app`).

## Files

| File | Role |
|------|------|
| [`../../src/ui/tokens.css`](../../src/ui/tokens.css) | Production `--tt-*` source of truth |
| [`tokens.css`](./tokens.css) | Re-exports src tokens + draft glass (`--tt-sidebar`) |
| [`aliases.css`](./aliases.css) | Preview-only `--set-*` / `--qp-*` / `--pal-*` |
| [`../../src/ui/kit/controls.css`](../../src/ui/kit/controls.css) | Select / toggle / buttons / stepper |
| [`../../src/ui/kit/palette.css`](../../src/ui/kit/palette.css) | Command palette / quick-open / MRU |
| [`../../src/ui/kit/confirm.css`](../../src/ui/kit/confirm.css) | Confirm dialogs |
| [`../../src/ui/kit/shell.ts`](../../src/ui/kit/shell.ts) | Fixed chrome builders (palette + confirm) |
| [`../../src/ui/kit/qp/view.ts`](../../src/ui/kit/qp/view.ts) | Quick panel lit view (shared with app) |
| [`kit/select-preview.js`](./kit/select-preview.js) | Thin portal select demo (legacy; prefer kit `ttSelect`) |
| [`scroll.css`](./scroll.css) | Shared thin scrollbar (`.tt-scroll`) |
| [`preview-chrome.css`](./preview-chrome.css) | Shared draft top nav |
| [`../../src/ui/kit/README.md`](../../src/ui/kit/README.md) | Control contract |

## Rules

1. **Never hard-code skin hex in a preview** for colors that exist as `--tt-*`. Change `src/ui/tokens.css` instead.
2. **Never redefine** `.tt-select` / `.tt-btn*` / `.tt-switch` / `.stepper` / `.pal-*` in preview `<style>` — link the kit.
3. Settings layout in drafts uses the same `.section` / `.row` vocabulary as the app.
4. New preview CSS should use `--tt-*` directly when practical; legacy `--set-*` / `--qp-*` / `--pal-*` remain as aliases.
5. Tab bar chrome (`--tt-tab-bar`) follows the chrome skin (same surface as Settings sidebar) — it does not follow terminal schemes.
6. **CONNECTED** = `--tt-ok` (`#22c55e`); **Share** = `--tt-share` (`#4ec9b0`). Do not merge these.
7. Load order in every preview `<head>`:

```html
<link rel="stylesheet" href="/docs/ui/tokens.css" />
<link rel="stylesheet" href="/docs/ui/aliases.css" />
<link rel="stylesheet" href="/src/ui/kit/controls.css" />
<link rel="stylesheet" href="/src/ui/kit/palette.css" />  <!-- palette draft -->
<link rel="stylesheet" href="/src/ui/kit/confirm.css" />  <!-- confirm draft -->
<link rel="stylesheet" href="/docs/ui/scroll.css" />
<link rel="stylesheet" href="/docs/ui/preview-chrome.css" />
<style>/* page-local layout only */</style>
```

8. Scrollable surfaces use class **`tt-scroll`**. On Chromium, do **not** set `scrollbar-width` / `scrollbar-color` with webkit pseudos (arrows return). Setting `::-webkit-scrollbar` **width** forces a **classic** gutter — not true overlay (app QP/Settings use `ui/overlay-scroll.ts` for true overlay).
9. Palette command rows come from `KEY_COMMANDS` in `src/core/commands.ts` — import in a `<script type="module">`, do not paste a parallel list.
10. Palette / confirm fixed chrome comes from `createPaletteShell` / `createConfirm*Dialog` in `src/ui/kit/shell.ts` — mount in the module script; do not paste parallel overlay HTML.
11. Quick panel product DOM comes from `qpPanelView` in `src/ui/kit/qp/view.ts` — preview mounts it with a fake model; do not paste `.qp-section` trees. New invariants go in `tests/ui-contracts/`.

## Skins

- `body[data-skin="cursor"]` — near-black, white CTA, soft radius  
- `body[data-skin="vscode"]` — blue accent, tighter radius  
- `body.qp-glass` — frosted translucency for Quick panel only  

## Production status

`src/ui/tokens.css` is the production source of truth. Docs re-export it;
aliases stay preview-only. Controls and palette live in `src/ui/kit/`. Select class is
**`.tt-select`** / **`.tt-switch`** / **`.tt-btn*`** (not `.qp-select` / `.qp-switch` /
`.set-select`). Skin comes from
`chromeSkin` → `body[data-skin]`, glass from `quickPanelGlass` →
`body.qp-glass`. One intentional divergence: `--term-bg` is NOT aliased to
`--tt-term-bg` in production — the app's `applyTerminalBackground()` writes
`--term-bg` from the terminal scheme (2px seam).

See [`parity-gap.md`](./parity-gap.md) for draft ↔ app parity (CLOSED + kit note).
