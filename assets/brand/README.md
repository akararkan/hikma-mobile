# Brand assets

The masters, and the one command that turns them into everything else.

| File | What it is |
|---|---|
| `hand-sign-logo.svg` | the mark in navy `#13233d` — for light grounds |
| `hand-sign-logo-white.svg` | the same path in white — for dark grounds |
| `icon-on-navy.png` | the reverse lockup, 1024, if you ever prefer a navy app icon |

## Regenerating

```sh
python3 scripts/brand-assets.py
```

Everything below is DERIVED — never edit these by hand, they will be
overwritten:

| Output | Ground | Mark |
|---|---|---|
| `assets/images/icon.png` 1024 | **Oxford navy `#002147`** | white, 62% of the height |
| `assets/images/android-icon-foreground.png` 1024 | transparent (navy set in app.json) | white, 44% — well inside the launcher's 66% safe zone |
| `assets/images/android-icon-monochrome.png` 1024 | transparent | black; Android recolours it for themed icons |
| `assets/images/splash-icon.png` 1024 | transparent | white — the splash ground is Oxford navy |
| `assets/images/favicon.png` 256 | Oxford navy | white |

The web copies live at `~/Documents/ika/public/` (`ika-logo.png`,
`favicon.svg`, and both masters under `public/brand/`). Their filenames are
deliberately unchanged: `index.html`, the share card and any saved link
already point at them.

## The wordmark does not use any of this

`ui/Wordmark` draws the glyph as a **vector**, with the path inlined from
`hand-sign-logo.svg`. At masthead size the mark is ten points wide — a raster
there is a downscaler's guess at every curve — and an asset added while Metro
is running is not in its registry, which is how the letter went missing from
the lockup once already. If the logo is ever redrawn, update the `MARK_PATH`
constant in that file alongside the SVGs here.

## Why the composition is scripted rather than exported

The glyph is tall and narrow (ink 207 × 458 in a 390 × 530 viewBox), so every
canvas has to place it by its INK box, not its document box, or it sits
visibly off-centre. The script measures the ink once and centres from that.
