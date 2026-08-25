# TTerm UI design drafts — fact source

Preview HTML under `docs/*-preview.html` shares **one token sheet**:

| File | Role |
|------|------|
| [`tokens.css`](./tokens.css) | Canonical `--tt-*` skins (`cursor` / `vscode`) + feature aliases (`--set-*`, `--qp-*`, `--pal-*`, tab chrome) |
| [`preview-chrome.css`](./preview-chrome.css) | Shared draft top nav |

## Rules

1. **Never hard-code skin hex in a preview** for colors that exist as `--tt-*`. Change `tokens.css` instead.
2. New preview CSS should use `--tt-*` directly when practical; legacy `--set-*` / `--qp-*` / `--pal-*` remain as aliases.
3. Tab bar chrome (`--tt-chrome`) is **fixed dark** — it does not follow terminal schemes.
4. **CONNECTED** = `--tt-ok` (`#22c55e`); **Share** = `--tt-share` (`#4ec9b0`). Do not merge these.
5. Load order in every preview `<head>`:

```html
<link rel="stylesheet" href="/docs/ui/tokens.css" />
<link rel="stylesheet" href="/docs/ui/preview-chrome.css" />
<style>/* page-local layout only */</style>
```

## Skins

- `body[data-skin="cursor"]` — near-black, white CTA, soft radius  
- `body[data-skin="vscode"]` — blue accent, tighter radius  
- `body.qp-glass` — frosted translucency for Quick panel only  

## Out of scope

Production `src/styles.css` is not yet driven by this sheet. Porting app chrome to `--tt-*` is a separate change after the drafts settle.
