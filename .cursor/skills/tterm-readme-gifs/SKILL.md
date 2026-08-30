---
name: tterm-readme-gifs
description: >-
  Exports TTerm README demo GIFs from local OBS window-capture MP4s with ffmpeg
  palettegen/paletteuse. Use when re-encoding hero.gif, agent.gif, or share.gif,
  raising GIF resolution, updating docs/images demos, or following the
  demo-script cut/export pipeline.
---

# TTerm README GIF export

Re-cut local OBS MP4s into the three README GIFs. Do not invent scene content (no AT/SSID/IP). Do not change cut timestamps unless the user gives new ones.

## Paths (this machine)

| Role | Path | Git |
| --- | --- | --- |
| Source MP4s | `C:\Users\rede\Videos\tterm capture\{hero,agent,share}.mp4` | **local only** — not in the repo |
| Output GIFs | `docs/images/{hero,agent,share}.gif` | committed |

OBS window-capture of the 1234×900 app window is **1452×998 @ 30 fps** (chrome included). Encode closer to source, not the README HTML width.

## Cuts (do not change unless asked)

| GIF | Source | In–out | Duration |
| --- | --- | --- | --- |
| `hero.gif` | `hero.mp4` | **5s–18s** | 13s |
| `agent.gif` | `agent.mp4` | **2s–13s** | 11s |
| `share.gif` | `share.mp4` | **5s–28s** | 23s |

## Display vs encode

README HTML stays `width="880"` (hero) and `width="430"` (agent + share, side by side). Encode **wider** so GitHub/click-through look sharp.

Current encode: **scale width 1234** → **1234×848**, 12 fps. Budget **< 5 MB** each.

| GIF | README `width=` | Encode width | Last size |
| --- | --- | --- | --- |
| hero | 880 | 1234 | 3.04 MB |
| agent | 430 | 1234 | 3.61 MB |
| share | 430 | 1234 | 1.17 MB |

## Pipeline

- ffmpeg palette (`palettegen` + `paletteuse`). gifski Windows MSI is GUI-only — **do not require gifski CLI**.
- 12 fps, `lanczos`, `-an`.
- **`-ss` after `-i`** (frame-accurate on the output timeline). `-t` is duration, not end time.
- If a file exceeds 5 MB: **do not change cuts**. Drop width `1234 → 1200 → 880`, or `palettegen=max_colors=128`. Prefer dropping width first.

## Commands

```powershell
$cap = "C:\Users\rede\Videos\tterm capture"
$out = "d:\tterm\docs\images"
$vf1234 = "fps=12,scale=1234:-2:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"

ffmpeg -y -i "$cap\hero.mp4"  -ss 5 -t 13 -an -vf $vf1234 "$out\hero.gif"
ffmpeg -y -i "$cap\agent.mp4" -ss 2 -t 11 -an -vf $vf1234 "$out\agent.gif"
ffmpeg -y -i "$cap\share.mp4" -ss 5 -t 23 -an -vf $vf1234 "$out\share.gif"
```

Report new `ffprobe` width×height and file sizes. Leave README `<img width>` unchanged unless the user asks.

After a successful re-encode, keep `docs/demo-script.md` §6 and `drafts/demo/README.md` GIF sizes/commands in sync with this skill.
