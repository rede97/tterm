# TTerm UI design drafts — fact source

Preview HTML under `docs/*-preview.html` shares **one token sheet**:

| File | Role |
|------|------|
| [`tokens.css`](./tokens.css) | Canonical `--tt-*` skins (`cursor` / `vscode`) + feature aliases (`--set-*`, `--qp-*`, `--pal-*`, tab chrome) |
| [`scroll.css`](./scroll.css) | Shared thin scrollbar (`.tt-scroll`) — no arrows; **classic gutter on Chromium** (see parity-gap **Q8b**) |
| [`preview-chrome.css`](./preview-chrome.css) | Shared draft top nav |

## Rules

1. **Never hard-code skin hex in a preview** for colors that exist as `--tt-*`. Change `tokens.css` instead.
2. New preview CSS should use `--tt-*` directly when practical; legacy `--set-*` / `--qp-*` / `--pal-*` remain as aliases.
3. Tab bar chrome (`--tt-chrome`) is **fixed dark** — it does not follow terminal schemes.
4. **CONNECTED** = `--tt-ok` (`#22c55e`); **Share** = `--tt-share` (`#4ec9b0`). Do not merge these.
5. Load order in every preview `<head>`:

```html
<link rel="stylesheet" href="/docs/ui/tokens.css" />
<link rel="stylesheet" href="/docs/ui/scroll.css" />
<link rel="stylesheet" href="/docs/ui/preview-chrome.css" />
<style>/* page-local layout only */</style>
```

6. Scrollable surfaces use class **`tt-scroll`**. On Chromium, do **not** set `scrollbar-width` / `scrollbar-color` with webkit pseudos (arrows return). Setting `::-webkit-scrollbar` **width** forces a **classic** gutter — not true overlay (Quick panel **Q8b** still OPEN).
## Skins

- `body[data-skin="cursor"]` — near-black, white CTA, soft radius  
- `body[data-skin="vscode"]` — blue accent, tighter radius  
- `body.qp-glass` — frosted translucency for Quick panel only  

## Production status

Migrated (branch `feat/ui-redesign-migration`): `src/ui/tokens.css` is the
production copy of this sheet (skins only — the `--set-*` / `--qp-*` /
`--pal-*` alias layer stays preview-only; production CSS uses `--tt-*`
directly). Skin comes from `chromeSkin` config → `body[data-skin]`, glass
from `quickPanelGlass` → `body.qp-glass`. One intentional divergence:
`--term-bg` is NOT aliased to `--tt-term-bg` in production — the app's
`--term-bg` is JS-written per terminal scheme (terminal seam), while
`--tt-term-bg` stays fixed for chrome.

## Parity tracking

Draft ↔ app gap list: [`parity-gap.md`](./parity-gap.md). Confirm dialogs
(paste / close-window): [`../confirm-preview.html`](../confirm-preview.html).

**Settings rule (LOCKED):** layout and buttons are **strictly 1:1** with
`docs/settings-preview.html`. Visibility lists use **left checkboxes**;
toggles only for single feature on/off. Solid trailing CTAs and modal
footers share **148px** width (`--tt-btn-width`).
