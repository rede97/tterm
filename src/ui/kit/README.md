# TTerm UI kit

Shared design-system controls for the **app** and **`docs/*-preview.html`**.

## Single source of truth

| Concern | Path | Rule |
|---------|------|------|
| Tokens | [`../tokens.css`](../tokens.css) | `--tt-*` only; change skins here |
| Controls | [`controls.css`](./controls.css) | Select / toggle / buttons / stepper |
| Palette surface | [`palette.css`](./palette.css) | `.pal-*` overlay / panel / rows |
| Command list | [`../../core/commands.ts`](../../core/commands.ts) | Palette + Settings keyboard titles / order / groups / defaults |

Previews **must** `<link>` / `import` these files. Never redefine `.pal-*`, `.tt-*` controls, or copy `KEY_COMMANDS` into draft HTML.

**Draft-only** (ok in preview `<style>` / script): page chrome, stage layout, notes, fake demo data, and action wiring for demos (`ACTION_BY_ID` hooks).

## Files

| Path | Role |
|------|------|
| [`../tokens.css`](../tokens.css) | `--tt-*` tokens (production source of truth) |
| [`controls.css`](./controls.css) | Select, toggle, buttons, stepper |
| [`palette.css`](./palette.css) | Command palette / tab quick-open / MRU chrome |
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
```

App: [`index.html`](../../../index.html) loads tokens; [`styles.css`](../../styles.css) `@import`s this kit.

## Contract

- **Select:** `.tt-select` / `.tt-select-trigger` / `.tt-select-menu` / `.tt-option` / `.tt-optgroup`
- **Toggle:** `.tt-switch` / `.tt-knob`
- **Buttons:** `.tt-btn` + `.tt-btn-primary|ghost|solid|danger|danger-fill|link` (optional `.tt-danger` on links)
- **Settings layout:** `.section` / `.section-title` / `.row` / `.row-info` / `.row-title` / `.row-desc` / `.row-control`
- **Confirm overlay:** `.cf-overlay` + `.cf-dialog` / footer uses `.tt-btn*`
- **Palette:** `.pal-overlay` / `.pal-panel` / `.pal-input-wrap` / `.pal-prefix` / `.pal-input` / `.pal-list` / `.pal-group` / `.pal-row` / `.pal-badge` / `.pal-label` / `.pal-meta` / `.pal-kbd` / `.pal-empty` / `.pal-mru-hint`
- **Type:** only `--tt-fs-*`, `--tt-*-weight`, `--tt-ui` / `--tt-mono`

Do **not** redefine these rules inside preview `<style>` blocks. No legacy aliases (`.qp-switch`, `.cf-btn`, `.settings-link-btn`, …).
