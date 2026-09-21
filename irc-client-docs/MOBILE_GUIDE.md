# IKA Mobile Guide

**The complete handbook for building the IKA React Native app** — the design
system it must wear, the mobile UI patterns it must imitate, and the API client
it already has. Everything a developer (or an AI assistant) needs is either in
this file or one hop away in a file this guide points to.

> **How this fits with the other docs:** `README.md` is the kit's elevator
> pitch, `PORTING.md` is the per-file edit list, `AI_PROMPT.md` is the prompt
> to paste into the RN project's assistant, and `docs/` holds the nine deep
> module guides. **This guide is the map that connects all of them** — and the
> only place the *design* contract (colors, themes, component specs) is written
> down for mobile.

The app: **IKA**, a scholarly social platform (posts, reels, stories, research
publishing, academic Q&A, chat/channels, live streaming with multi-guest
stages, calls) in four languages — English, Arabic, Kurdish (Sorani), Turkish —
with full RTL support. Backend: `https://irc-bakend-production.up.railway.app`,
REST under `/api/v1/`, JWT Bearer, SSE realtime.

## Contents

| Part | What's in it |
|---|---|
| **I — The Design System** | The Oxford palette, every token with hex, legacy-alias traps, typography, radii/shadows, dark mode, a ready-to-paste RN `theme.js` |
| **II — Mobile UI Patterns** | Concrete specs for the tab bar, pill tabs, headers, cards, buttons, compose sheet, auth, stories/reels/live, RTL rules |
| **III — Kit Architecture & Porting** | The six platform seams and shims, the two non-negotiable rules (MMKV, refresh token), per-file verdicts, dependencies, the 7-step porting order |
| **IV — The API Client** | The request() pipeline, error taxonomy, ids, adapters, the api namespace |
| **IV-A — Social & Content APIs** | auth · users · posts · reels · stories · research · qna |
| **IV-B — Discovery & Platform APIs** | search · tags · taxonomy · mentions · activity · sounds · media · admin |
| **IV-C — Realtime & Comms APIs** | chat · channels · realtime · notifications · settings · security · moderation — and the realtime model |
| **V — State Layer** | AuthContext / ChatContext / CallContext, the three hooks, all 25 lib modules, the complete shim inventory |
| **VI — Mock Mode** | The 4-language fixture, handler routing, `blockme`/`holdme`, RN requirements |
| **VII — Docs & Traps** | The 9 bundled guides catalogued, plus the 41-entry trap compendium |

## If you read only one page

1. **Look:** Oxford Blue `#002147` + Sky `#B9D6F2` on a white body; stone
   lines, slate words; serif for identity, sans for UI; tabs are pills;
   dark surfaces are blue-black. (Parts I–II)
2. **Storage:** MMKV, synchronous, non-negotiable. Store the refresh token and
   send it explicitly. (Part III)
3. **Wire:** Snowflake ids are strings; branch on error codes; deltas not
   absolutes on SSE; rebuild stream URLs every connect; 5-stream budget.
   (Parts IV, IV-C)
4. **Port, don't reinvent:** the API client, adapters, contexts and libs are
   finished code with the backend's quirks already encoded. (Parts III–V)

---
# Part I — The Design System (Oxford)

The app wears the **University of Oxford identity** (adopted 2026-07-30). One primary,
one secondary, white paper, stone lines, slate words. Layout, spacing and typography
predate the palette and were kept; only color moved. The web source of truth is
[`src/styles/warm/theme.css`](../src/styles/warm/theme.css) and the spec is
[`OXFORD_THEME.md`](../OXFORD_THEME.md) at the repo root — this chapter restates both
in mobile terms so you never need to reverse-engineer a CSS cascade.

**The one-paragraph version:** Oxford Blue `#002147` is the identity — buttons, own
bubbles, active nav, headings. Sky `#B9D6F2` is the secondary and owns *every* accent
that sits on a dark surface. The body is **white**, secondary surfaces are off-white
`#F2F0F0`, borders are stone `#D9D8D6`, text is cool slate (`#1C2330` / `#4D5768` /
`#616B7C`). Green means success only. Dark immersive surfaces (reels, stories,
lightbox) are Oxford *blue-blacks*, never warm or neutral blacks.

## 1. Core color tokens

### The `--ox-*` ramp (source of truth)

| Token | Hex | Role |
|---|---|---|
| `--ox-blue` | `#002147` | **Oxford Blue — the identity.** Primary buttons, own-message bubbles, active navigation, headings, scholar seals, dominant chrome |
| `--ox-blue-deep` | `#00172F` | Pressed / hover state of primary surfaces |
| `--ox-blue-mid` | `#163E66` | Emphasised accent **text** on white (9.5:1) |
| `--ox-blue-link` | `#1F4E7E` | Links, interactive icons, focus rings, standard verify seal (7.2:1 on white) |
| `--ox-blue-glow` | `#2E6094` | Focus glows, hover of link blue |
| `--ox-steel` | `#7FA8CE` | Muted accents, rings on dark surfaces, chart series 2 |
| `--ox-sky` | `#B9D6F2` | **Oxford Sky — the secondary.** Selected fills, and ALL on-dark accents (every role gold used to play on navy) |
| `--ox-sky-bright` | `#D6E7F8` | Brightest on-dark accent text |
| `--ox-sky-wash` | `#DCE9F6` | Accent washes, selected-state fills on light |
| `--ox-wash` | `#E7EFF8` | Quiet hover fills, quiet selected rows |
| `--ox-white` | `#FFFFFF` | Body background AND card surface |
| `--ox-off-white` | `#F2F0F0` | Secondary surfaces (rails, wells, insets); **text on Oxford Blue plates** |
| `--ox-stone` | `#D9D8D6` | Borders, dividers. **Never used for text** |
| `--ox-stone-soft` | `#E9E8E6` | Hairlines, skeleton shimmer |
| `--ox-stone-strong` | `#C2C1BF` | Pronounced borders, strong dividers |
| `--ox-green` | `#426A5A` | **Success states only** (6.0:1 on white) |
| `--ox-green-wash` | `#E4EDE9` | Success fills |
| `--ox-amber` | `#8A5A17` | Warnings (5.6:1 on white) |
| `--ox-amber-wash` | `#F5EAD7` | Warning fills |
| `--ox-red` | `#9C3A33` | Errors, destructive actions (6.3:1 on white) |
| `--ox-red-wash` | `#F6E4E2` | Error fills |

### On-dark CTA — Oxford Cerulean

The bright call-to-action **on dark plates only** (live stage, story viewer, call
controls). On white it is a 1.9:1 accessibility failure — never use it there.

| Token | Hex | Role |
|---|---|---|
| `--ox-cerulean` | `#49B6FF` | CTA plate on dark; carries **Oxford-Blue ink** (`#002147`, 8.6:1) |
| `--ox-cerulean-lift` | `#6EC6FF` | Hover — on dark surfaces hover always **brightens**, never darkens |
| `--ox-cerulean-deep` | `#2AA1F2` | Pressed |

### Text neutrals — cool slate, never stone

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#1C2330` | Body text (15.8:1 on white) |
| `--ink-2` | `#232B3A` | Long-form body copy |
| `--ink-soft` | `#4D5768` | Secondary text |
| `--muted` | `#616B7C` | Meta text — AA on both white (5.2:1) and off-white (4.5:1) |
| *(placeholder)* | `#98A1B0` | Input placeholders only — decorative, never carries required info |

> **Stone for lines, slate for words.** Border greys and text greys come from
> different families by design; mixing them is what makes a grey UI look muddy.

### Surfaces

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#FFFFFF` | The body. **The body is WHITE** — user-mandated |
| `--paper-2` | `#F7F6F5` | Rail half-step (sidebar) |
| `--card` | `#FFFFFF` | Cards |
| `--card-2` | `#F2F0F0` | Insets, wells, table headers, the search field |
| `--line` | `#D9D8D6` | 1px borders everywhere |
| `--line-soft` | `#E9E8E6` | Hairlines |

### Dark-by-design surfaces (both themes)

Reels, the story viewer/editor, the auth split-pane left half, the media lightbox and
the calls/live stage stay dark even in light mode. They use a fixed Oxford blue-black
ramp — **never warm blacks, never neutral grey-blacks**:

```
#080E16 → #0A111A → #0B131D → #0D1520 → #0F1926 → #101A28 → #16222F → #1A2836 → #2B3B4E
```

with `#FFFFFF` / `#F2F0F0` text and Sky `#B9D6F2` accents. Lightbox scrim:
`rgba(8,14,22,.93)`; modal overlay on light: `rgba(15,21,32,.55)`.

### Content categoricals (never re-themed)

Discipline spine: `--d-hadith #8A4A5B` · `--d-tafsir = --ox-blue` · `--d-aqidah #6B5B8A` ·
`--d-fiqh #4E6580` · `--d-science #2F6B72` · `--d-history #5B7A67`.

Chart series order: `#002147`, `#7FA8CE`, `#B9D6F2`, then muted categoricals
`#8A4A5B`, `#6B5B8A`, `#2F6B72`, `#5B7A67`, `#4E6580`. Grid lines `#E9E8E6`.

## 2. Legacy aliases — and the `--gold` trap

The web CSS still reads pre-Oxford token names; they were **re-pointed, not removed**.
The kit's older docs and class names mention emerald/brass/gold — mentally translate:

| Legacy token(s) | Now resolves to | Hex |
|---|---|---|
| `--rubric`, `--navy`, `--emerald` | `--ox-blue` | `#002147` |
| `--navy-deep`, `--emerald-deep` | `--ox-blue-deep` | `#00172F` |
| `--emerald-bright` | `--ox-blue-link` | `#1F4E7E` |
| `--emerald-glow` | `--ox-blue-glow` | `#2E6094` |
| **`--blue`, `--gold`, `--brass`** | **`--ox-blue-link`** | **`#1F4E7E` — all three are the SAME color** |
| `--gold-deep` | `--ox-blue-mid` | `#163E66` |
| `--brass-soft` | `--ox-sky` | `#B9D6F2` |
| `--gold-wash`, `--brass-tint` | `--ox-sky-wash` | `#DCE9F6` |
| `--wash`, `--blue-wash` | `--ox-wash` | `#E7EFF8` |
| `--good` / `--good-wash` | green family | `#426A5A` / `#E4EDE9` |
| `--warn` / `--warn-wash` | amber family | `#8A5A17` / `#F5EAD7` |
| `--danger` | `--ox-red` | `#9C3A33` |
| `--rose`, `--like` | *literal* | `#B3453E` — hearts keep their red |

> ### ⚠️ The `--gold` trap
> **`--gold` is a dark blue.** Any old rule shaped `background: var(--gold);
> color: var(--navy)` (once gold plate + navy ink) silently became dark-on-dark
> (1.87:1) the day the tokens were re-pointed. Never pair two tokens from the
> `--navy`/`--gold`/`--rubric`/`--emerald` families as background + ink — since the
> migration they **all** resolve to dark blues. Put **white** (`#F2F0F0`) on a dark
> plate.
>
> Corollary: because `--blue` and `--brass` are identical, the verify seals need
> distinct literals — standard `.verify` = `#1F4E7E`, `.verify.scholar` = `#002147`
> (darker = more senior). Keep them distinct in RN.

**RN rule: do not port the legacy names at all.** Your theme object should contain
only the `--ox-*` ramp plus ink/paper/surface names. The aliases exist purely to keep
old web CSS alive.

## 3. Typography

| Family | Stack (web) | RN equivalent |
|---|---|---|
| `--sans` — **all UI** | IBM Plex Sans → system | Bundle IBM Plex Sans 400/500/600/700 (+400 italic) |
| `--serif` — **display/identity** | Lora → Amiri → Georgia | Bundle Lora variable (ital 400–700) |
| `--arabic` — Quranic/Arabic content | Amiri → Noto Naskh Arabic | Bundle Amiri 400/700 (+italics) |
| `--mono` | IBM Plex Mono | Bundle if you render code blocks |

Usage split:

- **Sans = UI.** Every control, input, meta line, placeholder. Placeholders are
  forced non-italic sans.
- **Serif = identity.** The brand wordmark (serif 700, 19px, letter-spacing −0.2),
  page `h1` (serif 600, clamp 22–26px, letter-spacing −0.3, with an *italic* accent
  `<em>` in link-blue), empty-state titles (serif 18px/600), compose textarea
  (serif 18px).
- **Amiri = Arabic scripture.** `.ayah-block .ar`: 24px, line-height 1.8, RTL.

Control-size reference: chips/tabs 13.5px/600 · pills 11px + 0.4 letter-spacing ·
field height 42px · textarea 14.5px · topbar search 40px pill · field labels
12.5px/600 · kind-tags 10px/700 uppercase + 0.8 letter-spacing.

> **RTL trap:** drop caps (`::first-letter`) are force-disabled in RTL — detaching
> the first letter breaks connected Arabic/Sorani script. Never implement drop caps
> for ar/ku locales in RN.

## 4. Radii, shadows, spacing, motion

**Radii:** `--r-xs 8` · `--r-sm 10` · `--r 14` · `--r-lg 16` · `--r-xl 18`.
In practice: buttons 10, large buttons 12, fields 10, cards 14, chips/tabs/pills/toasts
**999 (full pill)**, popovers 12–14.

**Shadows** (cool slate-tinted, never pure black in light mode):

| Token | Value |
|---|---|
| `--shadow-sm` | `0 1px 2px rgba(23,31,45,.05), 0 2px 6px rgba(23,31,45,.04)` |
| `--shadow` | `0 4px 16px -6px rgba(23,31,45,.12), 0 1px 4px rgba(23,31,45,.05)` |
| `--shadow-lg` | `0 20px 60px -16px rgba(23,31,45,.28)` |
| primary button glow | `0 8px 18px -10px rgba(0,33,71,.55)` |

Cards are **flat by default** (no shadow) and lift on press/hover. Dark theme keeps
the same geometry on `rgba(0,0,0,.4/.55/.75)`.

**Spacing:** there is *no* spacing token scale in the web app — it's per-rule
(fields 42px tall / 13px inline padding; chips 7×16; pills 2×10; icon buttons 38px
circles). Extract your own 4-point scale for RN; the numbers in Part II are the
contract.

**Motion:** entrance = rise 0.4s `cubic-bezier(.22,1,.36,1)` with 0.02s stagger;
skeleton shimmer; pressed states scale(.97) (icon buttons .92). Respect
reduced-motion (RN: `AccessibilityInfo.isReduceMotionEnabled`).

## 5. Dark mode — the `[data-theme="dark"]` contract

Selected in Settings → Appearance: `LIGHT | DARK | SYSTEM` (SYSTEM tracks the OS
live). In RN, mirror with `useColorScheme()` + the same three-way preference stored
in prefs. The dark palette is a **complete token remap** (treat values as fixed):

| Token | Dark value |
|---|---|
| `--paper` (body) | `#0A121C` |
| `--paper-2` (rails) | `#0E1826` |
| `--card` / `--card-2` | `#101C2C` / `#162436` |
| `--line` / `--line-soft` | `#22344A` / `#1A2A3D` |
| `--ink` / `--ink-2` | `#E8EDF3` / `#DCE4EC` |
| `--ink-soft` / `--muted` | `#A9B8C8` / `#7F92A6` |
| headings (`--navy`, `--rubric`) | `#B9D6F2` — **headings become Sky** |
| links (`--blue`, `--gold`, `--brass`) | `#8FB8E0` (7:1 on body) |
| selected wash | `#152A42` |
| primary buttons (`--emerald`/`-deep`) | `#1F4E7E` / `#2E6094` — stay dark; **hover lightens** |
| success | `#7FBFA5` on `#12291F` |
| warning | `#D9A75A` on `#2C2210` |
| error / like | `#D98078` |
| form-control edge | `#55708F` (stone at 1.9:1 fails the 3:1 control floor) |
| dark red wash | `#2C1614` |
| translucent chrome veil | `rgba(10,18,28,.92)` |
| messages: hover / active / canvas | `#152A42` / `#1D3554` / `#0C1521` |
| presence dot | `#3D9A5F` (unchanged) |
| selection | `#1F4E7E` bg + white |
| overlay scrim | `rgba(3,7,12,.72)` |

**The two inversion traps** (why a naive token flip breaks):

1. `--navy`/`--rubric`/`--gold`/`--brass` become **light** blues on dark (they carry
   headings/links). Any rule that used one as a *filled plate* with white ink
   inverts to light-on-light. Fix by re-plating in the button blues, never re-inking.
2. Mirror image: the primary-button blues and the fixed `--ox-blue*` ramp stay
   **dark**; used as accent *text* they go dark-on-dark. Fix by lifting text to the
   heading/link tokens.

**What does NOT flip in dark mode:** the dark-by-design surfaces (already dark);
and the sacred content colors — rich-text highlights and text colors, the `--d-*`
discipline spine, chart categoricals, file-type colors, like-rose, presence green,
live red, per-channel tint, and the QR plate (must stay white with black modules or
scanners fail).

**Signature dark inversions to replicate:** switch ON = Sky track + Oxford-Blue knob;
progress fill = Sky; toast becomes a raised card plate (light mode: ink pill); own
chat bubble re-plates as a `#1F4E7E → #002147` vertical gradient; user highlight
backgrounds keep their color but ink is pinned to `#1C2330`.

## 6. Component color recipes

| Component | Recipe (light) |
|---|---|
| Top bar | White at 92% + blur(14) saturate(140%); search field `#F2F0F0` → white on focus with link-blue border |
| Bottom nav | White at 96%; active item Oxford Blue |
| Sidebar/rail | `#F7F6F5`; active row `#E1EBF6` fill + Oxford-Blue text/icon |
| Primary button | Oxford Blue bg, **`#F2F0F0` text** (off-white, not pure white), pressed `#00172F`, navy glow shadow |
| Secondary button | White bg, stone border, ink text; hover: link-blue border + Oxford-Blue text |
| Ghost/text button | Link-blue label; hover `--ox-wash` fill |
| Inputs | White field, stone border; focus link-blue border + `rgba(31,78,126,.12)` 3px ring; placeholder `#98A1B0` |
| Cards | White, stone hairline, radius 14; flat, lift on press |
| Row hover / selected | `#EDF3FA` / `#E1EBF6` + Oxford-Blue text |
| Pills (selected) | Oxford Blue fill + off-white text |
| Dialogs | White card on `rgba(15,21,32,.55)` scrim |
| Tooltips | Ink bg, `#F2F0F0` text |
| Toasts | Ink pill + off-white text; `.t-warn` amber-on-amber-wash; `.t-err` red-on-red-wash; icon glint Sky |
| Tables | Header `#F2F0F0`, stone row dividers, hover `--ox-wash` |
| Checkbox/radio/switch | Stone-strong border; checked = Oxford-Blue fill/track + white glyph/knob |
| Progress | Track `#E9E8E6`, fill Oxford Blue (Sky on dark) |
| Skeletons | `#F2F0F0` base, `#E9E8E6` shimmer |
| Text selection | `#CBDFF3` + ink |
| Verify seals | standard `#1F4E7E`; scholar `#002147` |
| Chat | Own bubbles Oxford Blue + `#F2F0F0` text + Sky accents (quotes, waveform played-layer); others white/stone; unread markers Sky family |
| Live ring | conic gradient `--live → Sky → link-blue → --live` |
| Story unseen ring (dark) | `#7FA8CE → #B9D6F2` gradient |

**States:** hover `#EDF3FA` or border→link-blue · selected `#E1EBF6` + blue text
(rows) or blue fill + off-white text (pills) · pressed `--ox-blue-deep` or
scale(.98) · disabled = 50% opacity, **never a color swap** · focus = 2px link-blue
outline, offset 2.

## 7. Sacred colors kept outside the palette

User-content colors are not UI chrome — never re-theme them:

- **Rich-text highlights:** `#FFF59D` yellow · `#A5D6A7` green · `#90CAF9` blue ·
  `#FFAB91` coral · `#CE93D8` pink · `#EEF3F9` cream · `#FFE0B2` orange.
- **Rich-text text colors** (`.tc-*`): ink `#1C2330`, soft `#4D5768`, muted `#8A93A3`,
  light `#C2C1BF`, rose `#B3453E`, brass `#1F4E7E`, emerald `#002147`, blue `#1F4E7E`,
  brown `#4E6580`, deep `#00172F`, bright `#2E6094`, white `#FFFFFF`.
- **File-type icons:** pdf `#B3453E` · doc gradient `#4B7FB0→#2D557D` · ppt gradient
  `#D98A4E→#A35A25` · xls `#2F6B72` · zip `#4E6580` · txt gradient `#848B98→#4D5768`.
- **Google brand glyph:** `#4285F4 / #34A853 / #FBBC05 / #EA4335`.
- **Presence green** `#3D9A5F` — the one sanctioned non-success green; dots only.
- **Live red** `#C2483D` (+ soft `rgba(194,72,61,.14)`).
- **Like rose** `#B3453E`.
- **QR plate** — white with black modules, both themes.

## 8. A ready-to-paste RN theme object

Drop this in as `src/theme.js` in the RN app (light + dark + fixed families). It is
the `--ox-*` contract translated 1:1 — no legacy aliases.

```js
export const light = {
  // identity
  blue: '#002147', blueDeep: '#00172F', blueMid: '#163E66',
  link: '#1F4E7E', glow: '#2E6094', steel: '#7FA8CE',
  sky: '#B9D6F2', skyBright: '#D6E7F8', skyWash: '#DCE9F6', wash: '#E7EFF8',
  // surfaces
  paper: '#FFFFFF', paper2: '#F7F6F5', card: '#FFFFFF', card2: '#F2F0F0',
  line: '#D9D8D6', lineSoft: '#E9E8E6', lineStrong: '#C2C1BF',
  // text
  ink: '#1C2330', ink2: '#232B3A', inkSoft: '#4D5768', muted: '#616B7C',
  placeholder: '#98A1B0', onBlue: '#F2F0F0',
  // status
  good: '#426A5A', goodWash: '#E4EDE9', warn: '#8A5A17', warnWash: '#F5EAD7',
  danger: '#9C3A33', dangerWash: '#F6E4E2',
  // interaction
  hover: '#EDF3FA', selected: '#E1EBF6', selection: '#CBDFF3',
  scrim: 'rgba(15,21,32,.55)',
}

export const dark = {
  blue: '#002147', blueDeep: '#00172F', blueMid: '#163E66',
  link: '#8FB8E0', glow: '#A9CBE8', steel: '#7FA8CE',
  sky: '#B9D6F2', skyBright: '#D6E7F8', skyWash: '#152A42', wash: '#152A42',
  paper: '#0A121C', paper2: '#0E1826', card: '#101C2C', card2: '#162436',
  line: '#22344A', lineSoft: '#1A2A3D', lineStrong: '#55708F',
  ink: '#E8EDF3', ink2: '#DCE4EC', inkSoft: '#A9B8C8', muted: '#7F92A6',
  placeholder: '#7F92A6', onBlue: '#F2F0F0',
  heading: '#B9D6F2',            // headings become Sky on dark
  btn: '#1F4E7E', btnLift: '#2E6094', // primary buttons stay dark; hover LIGHTENS
  good: '#7FBFA5', goodWash: '#12291F', warn: '#D9A75A', warnWash: '#2C2210',
  danger: '#D98078', dangerWash: '#2C1614',
  hover: '#152A42', selected: '#1D3554', selection: '#1F4E7E',
  scrim: 'rgba(3,7,12,.72)', veil: 'rgba(10,18,28,.92)',
}

// Fixed in BOTH themes — content colors and dark-by-design surfaces.
export const fixed = {
  cerulean: '#49B6FF', ceruleanLift: '#6EC6FF', ceruleanDeep: '#2AA1F2', // dark plates ONLY
  like: '#B3453E', live: '#C2483D', liveSoft: 'rgba(194,72,61,.14)',
  presence: '#3D9A5F',
  night: ['#080E16','#0A111A','#0B131D','#0D1520','#0F1926',
          '#101A28','#16222F','#1A2836','#2B3B4E'],   // immersive surface ramp
  verify: '#1F4E7E', verifyScholar: '#002147',
  spine: { hadith:'#8A4A5B', tafsir:'#002147', aqidah:'#6B5B8A',
           fiqh:'#4E6580', science:'#2F6B72', history:'#5B7A67' },
  charts: ['#002147','#7FA8CE','#B9D6F2','#8A4A5B','#6B5B8A','#2F6B72','#5B7A67','#4E6580'],
  highlights: { yellow:'#FFF59D', green:'#A5D6A7', blue:'#90CAF9', coral:'#FFAB91',
                pink:'#CE93D8', cream:'#EEF3F9', orange:'#FFE0B2' },
  google: ['#4285F4','#34A853','#FBBC05','#EA4335'],
}

export const radii = { xs: 8, sm: 10, md: 14, lg: 16, xl: 18, pill: 999 }
export const fonts = { sans: 'IBMPlexSans', serif: 'Lora', arabic: 'Amiri', mono: 'IBMPlexMono' }
```

## 9. The rules that keep it looking right

1. **Never introduce a raw hex in a component.** Read the theme object; if no token
   fits, the palette is missing a role — add it to the theme first.
2. **Backgrounds are white or off-white, full stop.** Tinted fills (`wash`,
   `skyWash`) mark *state*, not surface.
3. **Stone for lines, slate for words** — never stone-colored text.
4. **Green means success only** (presence dots are the one exception, and they are
   dots, not text).
5. **One accent per element.** Oxford Blue dominant, Sky secondary; if an element
   needs both plus green, it is over-designed.
6. **Dark surfaces are blue-black** — any new immersive surface starts from the
   night ramp, takes off-white text and Sky accents.
7. **Text on Oxford-Blue plates is off-white `#F2F0F0`**, not pure white, in chips,
   tabs and CTAs.
8. **User content colors are sacred** — highlights and file-type colors are not
   chrome; leave them alone in both themes.
# Part II — Mobile UI Pattern Specs (the m-* vocabulary)

These are the concrete component contracts the RN app must imitate. They come from
the web app's mobile breakpoint (≤720px), where the design already *is* a mobile
app — bottom tabs, full-screen sheets, safe-area padding. All numbers below are the
final computed values after the full CSS cascade, so you can build from this page
alone. Colors reference the Part I theme object.

**Signature rules at a glance:**

- **Tabs are pills, never underlines.** Active pill = filled Oxford Blue with
  off-white text.
- **The center compose button is a rounded rectangle (48×38, r13), not a circle.**
- **Stories are thumbnail cards (9:16), not round-avatar rings.**
- Modals become bottom sheets; compose becomes a full-screen sheet.
- Serif for identity (headlines, brand, post bodies); sans for controls.

## 1. Screen scaffold

- Page padding: 14px sides; bottom clearance `88 + safe-area-bottom` so content
  never sits under the tab bar. Toasts float at `96 + safe-area-bottom`.
- Breakpoint model (for reference): bottom-nav mode begins at ≤720; modals become
  sheets at ≤600; search leaves the top bar at ≤460; labels drop at ≤380.

## 2. Top app bar

| Property | Value |
|---|---|
| Height | 56 + status-bar inset (60 on desktop web) |
| Background | white at 92% + blur(14) saturate(140%) — a frosted bar |
| Border | 1px bottom, `line` |
| Brand mark | 30×30, radius 9, wordmark serif 19px |
| Icon buttons | 36px circles (34 on the smallest phones), icon inherits ink |
| Notification dot | 8px, `like` red `#B3453E`, 2px paper border, offset top 8 / end 9 |
| Search | dropped on small phones — search lives in the Explore tab |
| Compose | not in the top bar on phones — the FAB in the tab bar is the single compose entry |

A hamburger (38×38, r10) opens the **navigation drawer**: fixed left,
`min(82vw, 300px)` wide, full height, `paper2` background, slides in over a
`rgba(23,31,45,.5)` + blur scrim with a 0.28s `cubic-bezier(.2,.8,.3,1)` ease. The
drawer holds the full 12-entry nav list; **the bottom tab bar is a curated four and
stays that way** — everything else is reachable from the drawer.

## 3. Bottom tab bar

| Property | Value |
|---|---|
| Background | white at 96% + blur(16) saturate(140%), 1px top border `line` |
| Padding | 9 top, 8 sides, `10 + safe-area-bottom` bottom |
| Cells | **5**: Home `/` · Reels `/reels` · **[+]** · Chats `/chat` · You `/profile` |
| Cell layout | column, gap 3; icon 24×24; label 10px/600, letter-spacing 0.2 (hidden ≤380) |
| Active state | Oxford Blue icon + label (700), icon lifts `translateY(-1) scale(1.07)`, plus a 26×3 top-edge tick in Oxford Blue |
| **The [+] button** | **48×38 rounded rect, radius 13** — never a circle. Oxford Blue fill, off-white glyph (22px, stroke 2.4), glow `0 7px 18px -6px rgba(0,33,71,.62)` + inner top highlight. 44×36 on the smallest phones. Press scale(.92) |
| Chat badge | pill min-width 15, height 15, radius 999, blue gradient (`link` → `blueMid`) with white 9px/700 text; shows `9+` above 9; **remount on count change** so the pop-in animation replays |

**Trap:** inside an open chat thread the tab bar is hidden entirely and the message
composer owns the bottom edge (with safe-area padding). Replicate: hide the tab bar
on the thread screen.

## 4. Pill tabs — the two flavours

**Flavour A — segmented track** (`.seg` — feed's For-you/Following/Scholars, auth
tabs, view-mode switcher):

- Track: `paper2` fill, radius 12, padding 3, gap 3.
- Cells: equal flex, padding 9×6, font 13.5/600, `inkSoft` text.
- Active cell: **white card** + `0 1px 3px rgba(23,31,45,.14)` shadow, Oxford-Blue
  text; press scale(.97). (View-switcher variant uses Oxford-Blue fill + off-white
  text with pill radius.)
- The auth flavour animates a sliding white thumb (width `50% − 6`, inset 4); the
  thumb translation **flips in RTL**.

**Flavour B — scrollable pill chips** (filter rows, list toolbars, all former
underline tabs):

- Row: horizontal scroll, no scrollbar, gap 7, bleeds to the screen edge
  (margin −14 / padding 14) so chips glide off-screen.
- Chip: 1px `line` border, white fill, radius 999, padding 8×15, font 13/600,
  `inkSoft` text; press scale(.96).
- **Active chip: filled Oxford Blue `#002147`, off-white text** — never an ink-grey
  fill, never an underline.
- Tab rows under a page title are sticky beneath the top bar with a paper
  background.

The one sanctioned non-pill tab row is the compose sheet's type picker (§8) — an
uppercase micro-tab row inside the sheet.

## 5. Page headers

- h1: **serif 600**, fluid `clamp(23, 6vw, 32)` (down to clamp 20–24 on the
  smallest phones), letter-spacing −0.5, line-height 1.12, Oxford Blue.
- The accent word is an *italic* `em` in link-blue `#1F4E7E`, weight 500–600 —
  e.g. "Academic *Q&A*". This is the brand's signature headline move.
- Sub line: 13px, `inkSoft`, 3px below.
- Optional kicker above: 11px, letter-spacing 0.14em, uppercase.
- Header CTA button: height 38, padding 0×14, font 13.5 (full-width primary on
  small phones).

## 6. Cards

- Base card: white, 1px `line` border, radius 14, **flat** (no shadow); inner
  padding 16–18.
- Post card: radius 16, `shadow-sm`, denser mobile padding — head 13×14×8, body
  0×14×11 in **serif 14.5/1.55**, stats row 12px, action row buttons 13.5/600 with
  labels visible, padding 10.
- Card section titles: serif 18/600, Oxford Blue.
- Status pills: uppercase 10.5/700, letter-spacing 0.6, padding 3×10, radius 999.
  Tones: open = `card2`/muted · answered = `wash`/link · resolved = `#DCE9F6`/blueMid ·
  published = green/greenWash · archived = `#F2F0F0`. The dot variant carries a 6px
  leading dot in `currentColor`.
- Tag chips: 12.5/600, link-blue text on `rgba(31,78,126,.1)` with a
  `rgba(31,78,126,.22)` border, padding 5×12, radius 999. Inline `#tag` tokens
  render Oxford Blue; `@mention` tokens render Oxford Blue too.
- Metrics strip (research): 2-col grid on phones, 1px `lineSoft` gutters inside a
  1px `line` radius-14 frame, white cells padded 12×6, serif 18 numerals.
- Press physics: cards scale(.99) on press; buttons/chips/tabs scale(.96);
  **no hover effects on touch** — press states only.

## 7. Buttons

| Variant | Spec |
|---|---|
| `.btn` base | height 40, padding 0×18, radius 10, font 14/600 |
| Primary | Oxford Blue fill, off-white text, glow `0 8px 18px -10px rgba(0,33,71,.55)`; pressed `#00172F` + scale(.97) |
| Secondary | white fill, `line` border, ink text |
| Ghost | transparent, link-blue label |
| Large | height 48, padding 0×24, radius 12 (auth/social buttons min-height 46) |
| Small | height 32, padding 0×14, font 13, radius 8 (Q&A mobile variant: 38/r10) |
| On-dark CTA | cerulean `#49B6FF` plate + **Oxford-Blue ink** — dark surfaces only |
| Compose CTA | height 46, radius 12, navy fill + glow |

Minimum tap target on phones: 34–46px depending on control; inputs ≥16px font (iOS
zoom guard) and height 48 for large fields.

## 8. Compose — a full-screen sheet

On phones the compose modal is a **full-screen sheet**: 100% × full height, radius
0, slides up 0.3s `cubic-bezier(.2,.8,.3,1)`; the body scrolls between a fixed top
bar and footer.

- **Top bar:** `Cancel` (11/600, letter-spacing 1.5, uppercase, muted) · centered
  serif title with a tiny uppercase kicker (9.5/700, letter-spacing 2.2, Oxford
  Blue) · `Publish` pill (height 40, padding 0×20, font 14.5). Top padding includes
  the status-bar inset.
- **Type picker:** horizontally scrolling micro-tabs (10.5/600, letter-spacing 1.4,
  uppercase), active = Oxford-Blue text + bottom border; right edge fades out via a
  gradient mask; snap-to proximity. (The sanctioned non-pill tab row.)
- **Textarea:** **serif 18px**, line-height 1.55, min-height 150, italic serif
  placeholder `#A9B2C0`; auto text direction (`dir="auto"` equivalent).
  Q&A title field: serif 21.
- **Visibility pill:** uppercase 11.5, padding 7×13, min-height 34.
- **Footer:** attach-icon row (42px touch targets) + char count (12px,
  tabular-nums, right-aligned); bottom padding `12 + safe-area-bottom`.
- Drop zone: 2px dashed `line`, radius 14, padding 26×14. Voice pane: dark plate
  `#16222F` with `#2E4A68` border and a 64px round record button in Oxford Blue.

## 9. Auth screens

- Layout: hero on top, form below (single column on phones).
- **Hero panel:** Oxford navy gradient `linear-gradient(165deg, #00172F, #002147 55%, #163E66)`,
  bottom corners radius 28, padding `40+status-bar` top / 24 sides / 30 bottom, with
  two soft radial scrims (Sky at 14% top-right, link-blue at 28% bottom-left).
- Brand mark on hero: 44px, radius 12, `rgba(185,214,242,.14)` fill +
  `rgba(185,214,242,.4)` border.
- **Headline:** serif `clamp(24, 7vw, 30)`, line-height 1.18; accent `em` italic in
  **Sky `#B9D6F2`**; a 48×3 sky gradient flourish bar above.
- **Card:** full-width, padding 20×16×18, with a 3px top rule gradient
  `#002147 → #B9D6F2 50% → #002147`.
- **Auth tabs:** segmented track `#EDF3FA`, padding 4, gap 4, sliding white thumb
  (flips in RTL); tabs flex 1, padding 9×0, font 14/600.
- Inputs: height 48, font 16 (zoom guard); social buttons min-height 46.

## 10. Stories, reels, live

**Story tray — thumbnail CARDS, not rings** (a deliberate product decision; never
revert to round avatars):

- Tile: width 112, aspect **9:16**, radius 12, `card2` base, `shadow-sm`,
  scroll-snap start in a proximity-snap row with gap 8–10.
- Cover scrim: `rgba(6,12,20,0) → rgba(6,12,20,.72)` from 40% down — load-bearing
  for the white 12px/600 two-line name at the bottom (auto direction).
- Corner avatar ring (top-start 8): **unseen = 2px steel `#7FA8CE` ring** with a
  1.5px card gap (not Sky — Sky reads white on a photo). Count pill:
  `rgba(6,12,20,.6)` + blur.
- Create tile: photo top 70% / white foot 30%, with a 34px Oxford-Blue `+` circle
  straddling the seam (3px card border).
- Press scale(.95).

**Reels viewer:** full-height immersive on `#0B131D`; right action rail, meta and
seek bar all offset by `tab-bar (64) + safe-area-bottom`; caption clamps to 2 lines
at 14.5. An in-viewer **glass tab bar** overlays the bottom: gradient
`rgba(11,19,29,0) → rgba(11,19,29,.64)` + blur(14), 1px `rgba(255,255,255,.12)` top
border, 44px min touch targets, active tab = white + 20×2.5 top tick; its own [+]
is 44×36 r13 navy. Mute toggle: 42px circle `rgba(0,0,0,.42)` + blur; muted state
tints red `rgba(156,58,51,.4)`.

**Story viewer:** invisible left/right half-screen tap zones (no chevrons);
progress bars 3px, white on `rgba(255,255,255,.3)`, top `12 + status-bar`.

**Live:** header stacks vertically with a full-width Go-Live button; chat panel
becomes a static card `min(56vh, 460px)`; the video frame goes full-bleed (radius
0); composer pads by safe-area.

## 11. RTL (Arabic / Kurdish Sorani)

The web app does **not** set a global document direction — RTL is *per content
block*, and an RN port must reproduce that model:

- Every user-content element gets auto direction (the `dir="auto"` equivalent:
  detect the first strong character, or use `I18nManager`-independent per-view
  `writingDirection`). Authors can set per-paragraph direction in the rich-text
  editor.
- Layout uses logical start/end throughout (RN's default `start`/`end` styles map
  well) — badges, rings, counts all anchor to `end`, not `right`.
- Explicit flips to replicate: the voice-note waveform's played-clip inverts;
  segmented-tab thumbs translate the other way; directional icons (send, forward)
  mirror with scaleX(−1); toggle knobs flip.
- Arabic-script text bumps line-height to 1.8; scripture blocks use Amiri 24/1.8
  RTL.
- **Never implement drop caps in RTL** — a detached first letter breaks connected
  Arabic/Sorani script.
- Use word-level wrapping, never break-anywhere — mid-word breaks destroy RTL
  multi-line alignment.

## 12. Cross-cutting physics

- Press feedback everywhere (scale .92–.99 by size); no hover states on touch.
- Momentum scrolling with overscroll containment on internal scrollers (RN:
  `overScrollMode`/`bounces` defaults are fine; avoid scroll chaining in sheets).
- Modals ≤ phone width are bottom sheets: radius 20 top corners, max-height 92%,
  slide-up 0.3s, scrim `rgba(23,31,45,.55)`, grab bar 44×4 where drag-to-close.
- Long-form line-height 1.62 on phones; post bodies serif 14.5.
- Reduced-motion preference disables all entrance/stagger animation.
- Every focusable input ≥16px font (web zoom guard; keep for visual parity).
# Part III — Kit Architecture & Porting Rules

## 1. What mobile-kit is

Everything from the IKA web frontend that a React Native app can reuse, in one
folder — plus ready-written shims and porting instructions:

```
mobile-kit/
├── src/api/       28 files, 7,166 lines — the complete API client (verbatim web copy)
├── src/lib/       25 helper modules
├── src/context/   AuthContext · ChatContext · CallContext
├── src/hooks/     useRealtime · useCooldown · useReelAudio
├── src/mock/      1 MB fixture — the whole app with no backend, in en/ar/ku/tr
├── platform/      7 ready-written React Native shims
├── docs/          9 backend/frontend guides (see Part VII)
├── PORTING.md     per-file verdict for all 81 files, line numbers for every edit
├── AI_PROMPT.md   the prompt to paste into the RN project's AI assistant
└── README.md
```

Everything under `src/` is a **verbatim, unmodified copy** of the web source so it
stays diffable against the original. RN-side edits live in `platform/` replacements
— never in the copied files. Backend: `https://irc-bakend-production.up.railway.app`,
REST under `/api/v1/`, JWT Bearer auth, SSE for realtime.

Measured coupling: across 7,166 lines of API code, exactly **46 lines touch a
web-only API (0.6%)**; 20 of 28 API files have no web dependency at all.

## 2. The six seams and their shims

`src/api/` never imports UI, so platform coupling sits in exactly six places — each
with a finished replacement in `platform/`:

| # | Web thing | Shim | npm dependency |
|---|---|---|---|
| 1 | `localStorage` (sync) | `platform/storage.js` — MMKV, synchronous | `react-native-mmkv` |
| 2 | `import.meta.env` | `platform/env.js` — plain constants module | none |
| 3 | `EventSource` | `platform/sse.js` — drop-in class | `react-native-sse` |
| 4 | `window.dispatchEvent` | `platform/appEvents.js` — tiny emitter | none |
| 5 | `document.getElementById('toast')` | `platform/toast.js` — registered handler | none |
| 6 | `File` / `Blob` / canvas | `platform/files.js` — URI + expo-file-system | `expo-file-system`, `expo-crypto` |

Plus `platform/config.rn.js` — a **finished drop-in replacement** for
`src/api/config.js` (copy it over `api/config.js` in the RN project).

### storage.js
Exports `storage` (`getItem/setItem/removeItem/clear`, sync, backed by
`new MMKV({id:'ika'})`; `getItem` returns `null` on miss — localStorage parity) and
an in-memory `sessionStorage` (http.js parks the sign-out reason there; clearing on
app restart is exactly right on a phone). **Trap: Expo Go cannot load MMKV** —
you need a dev build.

### env.js
`import.meta.env` is a Vite compile-time substitution Metro doesn't perform — ten
call sites depend on it. Exports: `API_BASE_URL`, `USE_MOCK`, `MOCK_LANG`
(`en|ar|ku|tr`), `MOCK_DELAY_MS`, `APP_VERSION`, `APP_BUILD`, `ICE_SERVERS`,
`VAPID_PUBLIC_KEY`. Traps: **`API_BASE_URL` must always be absolute** (a native app
has no origin, so the web's "empty = relative" mode is gone); `VAPID_PUBLIC_KEY` is
web-only — native push is APNs/FCM via a **device token**, not a PushSubscription.

### sse.js
RN has no global `EventSource`. Five modules open streams (realtime, chat,
notifications, activity, stories) — all with
`new EventSource(url, {withCredentials:true})` + `addEventListener(NAME, fn)` for
named events; the shim keeps that exact surface, so those five files change **only
their import line**. Built on `react-native-sse` with `pollingInterval: 0` — callers
manage their own reconnects (realtime.js has a 60s heartbeat watchdog; chat.js
re-dials on close). Two native wins: you *can* send `Authorization: Bearer` headers
(the browser couldn't — hence the `?token=` query auth; verify the server accepts
the header form before switching), and there is no silent auto-reconnect (good —
a rotated token needs a rebuilt URL). Trap: the library only surfaces events it was
told to expect; the shim forwards late `addEventListener` registrations, but if a
future version regresses, pass names up front via `{events: [...]}`.

### appEvents.js
The DOM-as-event-bus replacement: `on(name, fn)` (returns unsubscribe), `off`,
`emit(name, detail)`; constants `AUTH_EXPIRED` (`'ika:auth-expired'` — how http.js
tells AuthContext the session died without importing UI; **load-bearing**),
`PREFS_EVENT`, `COMPOSE_EVENT`. `emit` fans over a snapshot so a handler may
unsubscribe itself and one throwing subscriber can't starve the rest.

### toast.js
`setToastHandler(fn)` + `flashToast(msg, tone)` where tone ∈ `'ok'|'warn'|'error'`
(mirrors the web `t-*` toast classes). With no handler registered the call is a
no-op, keeping api/ importable from tests.

### files.js
Translates the File/Blob model to URIs:

- `toUploadFile(asset, fallbackName)` → `{uri, name, type}` — normalizes
  expo-image-picker, react-native-image-picker and expo-document-picker shapes.
- `sizeOf(asset)` → bytes without reading the file (media.js refuses oversize
  uploads *before* hashing).
- `sha256Of(asset)` → hex or `null`. The digest is optional (enables the server's
  dedup shortcut); every failure returns null rather than throwing. It hashes the
  Base64 string via expo-crypto — media.js already skips hashing above 64 MB;
  keep that guard.
- `putBytes(url, asset, onProgress, signal)` — presigned PUT via
  `FileSystem.createUploadTask` (streams from disk — never buffer a 512 MB video
  into JS). **Traps:** the presigned URL is a foreign origin and is itself the auth
  — never send the app's Authorization header there; Content-Type must match the
  mime the upload-intent was issued for. Abort is signalled by an `Error` with
  `.name = 'AbortError'` (RN has no DOMException).

### config.rn.js
Keeps the exact export surface all 28 modules import: `API_BASE` (trailing slash
stripped), `assetUrl(u)` (passes through `https?:|data:|blob:|file:`, otherwise
prefixes `API_BASE` — **the backend returns relative media URLs**, and an
unprefixed URL simply cannot load in `<Image>`; Bearer-protected media needs
`{uri, headers}`), and `session` (MMKV keys `ika_token`, `ika_user`, plus the
mobile-only `ika_refresh` with `getRefresh()`/`setRefresh()`).

## 3. The two non-negotiable rules

### MMKV, not AsyncStorage
`session.getToken()` is called **synchronously** inside `request()` on every HTTP
call and every SSE reconnect. MMKV is synchronous (JSI) and drops in with zero
downstream edits. AsyncStorage is promise-based; adopting it forces `getToken`
async, which forces a `request()` restructuring that ripples through all 28
modules. The access token stays in MMKV even under a keychain threat model —
the getter must stay sync. (Refresh token: keychain/`expo-secure-store`, read only
inside the already-async `doRefresh()`.)

### Store the refresh token
The web app never stored it — the backend sets an **HttpOnly cookie** and the
browser replays it. RN's fetch ignores `credentials:'include'` and delegates
cookies to the native stack, which is not guaranteed to survive an app restart
(worst on Android). Symptom: the app signs the user out roughly every hour and it
*looks like a backend bug* — the single most likely bug in this whole port. Fix:

1. The login response returns tokens in the body too — store `res.refreshToken`
   via `session.setRefresh()` (slot already exists in `config.rn.js`).
2. Send it explicitly: `POST /auth/refresh {"refreshToken": "<stored>"}`.
3. **Verify the field name against the live server once** before building on it.

## 4. Porting verdicts (summary — PORTING.md has line numbers)

**API (28 files):** 19 are pure copy-and-go; `auth.js` is clean but needs the
refresh-token addition; 8 need edits — five of those are a one-line `EventSource`
import swap (`realtime.js` also drops its `window.__ikaRealtimePush` line):

| File | Edit |
|---|---|
| `http.js` (421 lines) | the only real work — eleven mechanical lines, see below |
| `config.js` | replace entirely with `platform/config.rn.js` |
| `realtime.js`, `notifications.js`, `stories.js`, `chat.js`, `activity.js` | swap the `EventSource` import |
| `media.js` | re-point `sha256Of` + `putBytes` at `platform/files.js`; pipeline unchanged |

False positives: `adapters.js` (912 lines — W=1 is the word "window" in a comment;
copy byte-for-byte) and `research.js` (`instanceof FormData` — RN has a global
`FormData`).

**The eleven lines in http.js:** `flashToast()` body → `platform/toast.js`;
`endSession()` → shim `sessionStorage` + `emit(AUTH_EXPIRED)`; `MOCK_BUILD` →
`USE_MOCK` from env.js; `withTierApplied()` degrades to pass-through on native
(re-point at expo-image-manipulator later); `saveBlob()` deleted (use
expo-file-system + expo-sharing); `credentials:'include'` is inert. **Everything
else stays verbatim:** the big-int-safe JSON parser, both error envelopes, 401
refresh-retry, 403 step-up replay, 429 handling, unhydrated-param guard.

**lib/ (25 files):**

- Copy as-is: `dialCodes`, `feedChannelViews`, `liveRows`, `moderation`,
  `reelOverlay`, `soundMix`, `stillClock`, `useImageRatio`, `userView`.
- Storage swap only: `useViewMode`, `pymkTimer`, `storySeen`.
- Small edits: `version` (env), `qrToken` (deep-link scheme instead of
  `window.location.origin`), `contactHash` (expo-crypto), `storyTray`
  (`document.hidden` → `AppState`), `openCompose` (appEvents).
- Rewrite, same logic: `mediaTier` (canvas → expo-image-manipulator), `archive`
  (expo-file-system), `prefs` + `chatPrefs` (CSS variables → theme context).
- Replace with a native library: `richtext` (keep the **BodyFormat PLAIN/MD/HTML
  contract**; render via react-native-render-html or a Markdown renderer),
  `chime` (expo-av), `desktopNotify` (Notifee/expo-notifications), `liveWebrtc`
  (react-native-webrtc — **signalling protocol unchanged**).

**Contexts/hooks:** `AuthContext` ports whole (swap the `ika:auth-expired`
listener to `on(AUTH_EXPIRED)`; router guards → navigator guards).
`ChatContext` (934 lines) nearly as-is — one web line (`window.location.pathname`
→ navigation state). `CallContext` (925 lines) is the heaviest — WebRTC + audio
devices; **do it last**. `useRealtime`/`useCooldown` copy as-is; `useReelAudio`
rewrites its two `new Audio()` sites to expo-av (crossfade logic stays).

## 5. Dependencies

| Package | Purpose |
|---|---|
| `react-native-mmkv` | storage (sync — **required**) |
| `react-native-sse` | SSE streams |
| `expo-file-system` | uploads, downloads |
| `expo-crypto` | sha256 for upload dedup, contact hashing |
| `expo-image-manipulator` | image downscale (replaces canvas) |
| `expo-av` | audio (reels, voice notes, chime) |
| `react-native-webrtc` | calls + live (last phase) |
| `expo-secure-store` | refresh token, if the threat model asks |

Bare-RN swaps: `react-native-blob-util`, `react-native-quick-crypto`. Optional:
`react-native-toast-message`, `react-native-keychain`, `react-native-render-html`,
Notifee/`expo-notifications`, `expo-sharing`, `react-native-config`/`expo-constants`.

## 6. The seven porting steps (stop after each for on-device testing)

1. Install deps + wire `platform/` → prove a single authenticated
   `GET /api/v1/users/me`.
2. `auth.js` + refresh-token fix + `AuthContext` → login, 2FA, session survives an
   app restart.
3. Copy the no-change API modules + `adapters.js` + `errors.js` → feeds, profiles,
   research, Q&A rendering.
4. SSE shim → realtime counters, notifications, chat stream.
5. `media.js` + `platform/files.js` → uploads.
6. Chat and channels.
7. Live streaming and calls (`CallContext`, `liveWebrtc`) — **last**; signalling
   unchanged, only peer-connection glue becomes react-native-webrtc.

Mock mode (`USE_MOCK = true` in `platform/env.js`) covers steps 3–4 when the
backend isn't reachable from the device.

## 7. Hard rules from AI_PROMPT.md

1. **Port, don't reinvent.** The kit is the code the mobile app should run.
2. **Do not rewrite `adapters.js`** — 912 lines, zero platform coupling, encodes
   every field-name quirk the backend has. Copy byte-for-byte.
3. **Keep Snowflake handling.** http.js quotes any 16+-digit integer before JSON
   parsing; ids.js compares ids as strings. Hermes loses the same precision
   browsers do — message ids are 18-digit longs; parsing as numbers silently
   corrupts them and the server answers 404.
4. **Branch on error codes, never message strings** — use the `errors.js`
   predicates.
5. **Preserve the http.js recovery flows verbatim** — 401 refresh-retry, 403
   step-up arm-and-replay, 429 handling. Port them; do not simplify them.
6. **Ask before changing an API contract** — apparent wrongness is far more likely
   a backend quirk the web app already learned to live with.
7. **Rebuild SSE URLs on every connect** (tokens rotate ~hourly) and never exceed
   **5 concurrent SSE connections per user** — realtime.js shares one connection
   per entity; keep that sharing.
8. **This is a native app, not a web port** — platform navigation and gestures;
   carry over the data layer, not the CSS. (Part I–II of this guide are the
   *visual* contract; the kit carries the *data* contract.)

## 8. Keeping the kit in sync with the web app

From the ika repo root:

```sh
cp src/api/*.js            mobile-kit/src/api/
cp src/lib/*.js            mobile-kit/src/lib/
cp src/context/*.jsx       mobile-kit/src/context/
cp src/hooks/*.js          mobile-kit/src/hooks/
cp src/mock/*.js src/mock/data.json mobile-kit/src/mock/
cp src/mock/handlers/*.js  mobile-kit/src/mock/handlers/
```

Then `git diff` in the mobile project shows exactly what changed upstream. This
works only because `src/` is verbatim — never edit the copies.

Known doc discrepancies (harmless, for the record): storage.js says "29 api
modules" (it's 28); storage.js references a `platform/session.js` that doesn't
exist (the refresh slot lives in `config.rn.js`); AI_PROMPT.md's step 3 counts "21
no-change modules" vs PORTING.md's 20.
# Part IV — The API Client

The API client is the heart of the kit: 28 modules, one transport funnel, one error
taxonomy, one adapter layer that already knows every quirk of the backend wire. This
part documents the core; Parts IV-A/B/C document every module's endpoints.

Base: `https://irc-bakend-production.up.railway.app` · REST under `/api/v1/` ·
JWT Bearer · SSE for realtime. Import surface: `import { api } from './api'`.

## 1. The request() pipeline (`api/http.js`)

Every REST call flows through `request(method, path, opts)` with
`opts = { body, query, headers, multipart, signal, keepalive, as }`. In order:

1. **Unhydrated-path guard** — a path containing the literal `undefined`/`null`
   segment logs a console error naming the bug before the request fires (the
   server would answer 400 `TYPE_MISMATCH` with `hint=frontend_path_param_unhydrated`).
2. **Mock hook** — `tryMock(method, path, opts)` consults `src/mock/` when mock
   mode is on; a miss falls through to the live network (partial fixtures degrade
   gracefully). See Part VI.
3. **Headers** — `Accept: application/json` (or `*/*` for blob), caller headers,
   then `Authorization: Bearer <token>` when a token exists.
   `session.getToken()` is **synchronous** — keep it sync (MMKV).
4. **Body** — `multipart: true` passes FormData raw (never set Content-Type on
   multipart — the runtime sets the boundary); otherwise JSON.
5. **URL build** — `API_BASE + path`; query params skip `undefined/null/''`;
   **arrays become repeated params** (`?type=A&type=B` — Spring multi-value;
   comma-joining would parse as one invalid enum).
6. **Deprecation header** — a `Deprecation: true` response logs a console warning
   with the `Link` successor.
7. **Success** — 204 → `null`; `as:'blob'` → `{blob, filename, type}` (RFC 5987
   filename parsing); otherwise big-int-safe JSON (below), with plain-string
   bodies tolerated.
8. **Errors** — parsed from **both** envelope dialects (below), then the recovery
   flows run in this order: 429 toast-and-throw → 403 step-up arm-and-replay →
   401 refresh-retry. Every failure logs exactly one structured line:
   `[api] <status> <CODE> trace=<traceId> <METHOD> <path>` — callers never add
   their own.

**Big-int-safe JSON.** Message ids are ~18-digit Snowflakes; `JSON.parse` rounds
them to a *different* integer and the server 404s. The exported `parseJson(text)`
pre-quotes any unsafe ≥16-digit integer (string literals are consumed first, so
digits inside strings are untouched). **SSE frames must be parsed with the same
`parseJson`** — import it from `./http.js` directly (it is not on the barrel).

**The three recovery flows (port verbatim, never simplify):**

- **401 → refresh-retry.** Only when a token existed, not yet retried, and the
  path isn't under `/api/v1/auth/`. `TOKEN_REVOKED` is immediately terminal (no
  refresh attempt). Concurrent 401s share one in-flight refresh promise.
  `doRefresh()` POSTs `/api/v1/auth/refresh` — on RN it must send
  `{"refreshToken": session.getRefresh()}` (the shipped web code sends `{}` and
  relies on the HttpOnly cookie — see Part III §3). Success adopts
  `data.accessToken` and replays once. Every `AUTH_REFRESH_TOKEN_*` failure code
  is terminal (`_EXPIRED/_INVALID/_MISSING/_NOT_FOUND/_REUSED`) → `endSession()`.
  `_REUSED` gets distinct copy ("signed out of all devices for security") — the
  server revoked ALL sessions after reuse detection; saying "expired" would hide
  a security event. `endSession()` clears the session, parks the reason in
  (shimmed, in-memory) `sessionStorage['ika:signed-out']` for the login screen,
  and emits `AUTH_EXPIRED` so AuthContext drops the user.
- **403 `STEP_UP_REQUIRED` → arm-and-replay.** Not a permission failure. A
  registered prompt (`setStepUpPrompt(fn)`, mounted by a StepUpHost component)
  collects password/TOTP, POSTs `/api/v1/security/step-up`, and on success the
  original request replays once. The server window (~5 min) covers a batch, so
  one prompt per run of sensitive actions. Cancel sets `err.stepUpCancelled = true`.
  With no host registered the 403 falls through unchanged.
- **429 → toast and throw. Never auto-retried.** Retry seconds resolve from
  top-level `retryAfterSeconds`, then `details.retryAfterSeconds` (Settings nests
  it), then the `Retry-After` header (bare proxy 429s carry only the header).
  UI contract: countdown on the submit button + kept draft (`useCooldown`).

**Verb map:** `http.get(path, query, opts)` · `http.post(path, body, opts)` ·
`http.patch` · `http.put` · `http.del` · `http.upload(path, formData, opts)` ·
`http.download(path, query, opts)` → `{blob, filename, type}`.

**Uploads:** `http.upload` runs images through `withTierApplied()` → the media-tier
compressor (DATA_SAVER 1080 / STANDARD 1440 / HIGH 1920 long-edge, JPEG q0.82,
never upscales, skips gif/svg/avif/heic and all video). It **fails open** —
compression must never block an upload. On RN the canvas pipeline no-ops (uploads
still work, tier is ignored) until re-pointed at expo-image-manipulator. There is
no fetch upload progress — RN gets progress only via the expo-file-system funnel
(`platform/files.js`).

**Authed downloads** (live recordings): must go through `http.download` — a plain
link sends no Bearer token and skips the 401 recovery.

## 2. Error taxonomy (`api/errors.js`)

Two envelope dialects, both parsed by http.js:

- Posts dialect: `{ errorCode, message, fieldErrors: [{field, message}], traceId, details? }`
- QnA/Research dialect: `{ error, message, path }` — `error` **is** the code

Three rules: branch on `err.code`, never message text · 4xx messages are complete
user-safe sentences — display them · keep the `traceId`.

`ApiError` fields: `status, code, payload, fieldErrors, traceId, details,
retryAfterSeconds, action, stepUpCancelled`.

| Predicate | Meaning / UI contract |
|---|---|
| `isNotFound(e)` | 404 or code ends `_NOT_FOUND` → quiet "no longer available", not a toast |
| `isDuplicate(e)` / `duplicateField(e)` | 409, code ends `_DUPLICATE` → inline field mark (`details.field`: username, email, …) |
| `isConflict(e)` | `OPTIMISTIC_LOCK_CONFLICT` / `RESOURCE_CONFLICT` / `DATA_INTEGRITY_VIOLATION` → re-fetch, then retry/review |
| `isRateLimited(e)` | status 429 — both `RATE_LIMITED` (burst) and `MEDIA_QUOTA_EXCEEDED` (daily) |
| `isStepUp(e)` | 403 + `STEP_UP_REQUIRED` — handled globally; most callers never see it |
| `isMfaCodeInvalid(e)` | `MFA_CODE_INVALID` — challenge **survives**; keep the code screen open (5 tries) |
| `isMfaChallengeDead(e)` | `MFA_CHALLENGE_INVALID` / `MFA_TOO_MANY_ATTEMPTS` — **terminal**; mfaToken is worthless, back to the password screen (retrying loops 401 forever) |
| `isTransient(e)` | 503 or `DATASTORE_UNAVAILABLE`/`STORAGE_UNAVAILABLE` — one delayed auto-retry OK, reads only |
| `isNetworkError(e)` | `status == null` and not AbortError — fetch itself failed |
| `isClientBug(e)` | `MALFORMED_JSON`/`MISSING_PARAMETER`/`MISSING_REQUEST_PART`/`TYPE_MISMATCH`/`ENDPOINT_NOT_FOUND` — our bug; generic apology |
| `isUnhydratedParam(e)` | `TYPE_MISMATCH` + `hint=frontend_path_param_unhydrated` |
| `needsLargeAudienceConfirm(e)` | `LARGE_AUDIENCE_CONFIRMATION_REQUIRED` → confirm dialog quoting `err.message`, resend the **identical** body + `confirmLargeAudience: true`; never set the flag by default |
| `cooldownSecondsFrom(e)` | 429 → seconds to disable submit (`retryAfterSeconds`, else `details.resetsAt` for media quota, else 5); 0 when not rate-limited |
| `fieldErrorMap(e, rename)` | `fieldErrors[]` → `{field: message}`; one Spring variant omits the array — fall back to the top-level message |
| `errorText(e, fallback)` | display policy: network → offline copy; 5xx + traceId → `msg (ref <trace8>)`; else the server message |
| `traceRef(e)` / `codeOf(e)` / `detailsOf(e)` / `logApiError(e, m, p)` | helpers |

**Retry summary:** retry-safe = `isTransient` (once, delayed, reads), `isConflict`
(after re-fetch), `isMfaCodeInvalid` (user retry). Never retry: 429 (countdown
only), `isMfaChallengeDead`, all `AUTH_REFRESH_TOKEN_*`, `TOKEN_REVOKED`, the
client-bug family.

## 3. Session & config

Web keys `ika_token` (JWT) + `ika_user` (JSON blob) in localStorage; RN adds
`ika_refresh` — all in MMKV via the shim, all synchronous. `assetUrl(u)` prefixes
the backend's **relative** media URLs (`/api/v1/media/…`) with `API_BASE`; on
native an unprefixed URL cannot load at all, and Bearer-protected media needs
`{uri, headers}` on `<Image>`/`<Video>`. See Part III §2 for the full
`config.rn.js` contract.

## 4. ids.js — Snowflakes are strings

Conversations are UUIDs; **messages are ~18-digit Snowflake longs** past
`Number.MAX_SAFE_INTEGER`. Hermes loses the same precision browsers do. Never
parse them as numbers; never subtract them.

| Export | Behaviour |
|---|---|
| `mid(v)` | DTO long → exact decimal string; **`0` is the backend's "nothing yet"** for lastRead/lastDelivered/lastMessage and folds to `null` |
| `newTmpId()` / `isTmpId(id)` | optimistic local ids `t<seq>` — never sent to the server |
| `cmpId(a, b)` | numeric-exact string compare; temp ids sort after every real id (pending bubble is newest); null/'' sort first |
| `maxId` / `gteId` / `gtId` | high-water marks for receipts — replaces every `a.id - b.id` / `Math.max` |

## 5. adapters.js — the wire-quirk encyclopedia (912 lines, copy byte-for-byte)

Every server DTO passes through an adapter that already fixes the backend's field
quirks. Highlights an RN developer must know (the file itself is the reference):

- `handleOf(username)` — email-like stored usernames are truncated at `@` so a
  private email never leaks as a public handle.
- `authorFrom(a)` — tolerates both `username`/`authorUsername` field spellings;
  deterministic avatar gradient from the hash over
  `['#002147','#4E6580','#4A6B8A','#8A4A5B','#5B7A67','#6B5B8A']`.
- `meFrom(u)` — `verified` is **derived** from `role ∈ {SCHOLAR, RESEARCHER}` or
  non-empty `badges[]` (the old `accountType`/`verificationTier` fields are dead).
  Specializations keep all three names (`nameEn/nameAr/nameCkb`) — Arabic/Kurdish
  UIs must not get flattened English. **`isFollowing` on followers/following list
  rows is always false — never drive a Follow button from it; read
  `GET /users/{id}/social-status` instead.**
- `userStatsFrom(s)` — `postCount` is non-reel posts only (backend splits them).
- `rawSuggestionFrom(dto)` — legacy suggestion `score` is **×10 fixed-point**
  (287 = 28.7); the adapter divides.
- `postFromFeedItem(dto)` — REEL: `videoUrl` = playable video, `mediaUrl` =
  cover/poster; a **still reel** (photo-as-reel) is told apart from a legacy
  video row by the file extension on the storage key; VOICE_POST: `mediaUrl` IS
  the audio. `status` is carried through (composer inserts PENDING_REVIEW rows).
- `channelPostFromFeedItem(dto)` — three traps: `author` is **null** (the channel
  signs); the row `id` is a synthetic UUID good only as a list key — the real id
  is `channelPostId` (Snowflake string); counters re-point (`shareCount` =
  forwards, `commentCount` = discussion-group comments; no likes/saves).
- `postFromResponse(dto)` — a reel's text/emoji/sticker overlay ships as a JSON
  doc typed OTHER, lifted out as `overlayUrl` (never send it to a media
  renderer); reel voiceover (typed AUDIO) lifted as `voiceoverUrl`.
- `questionFrom(dto)` — gate the answer composer on `acceptsNewAnswers`, not
  `status`.
- `researchDetailFrom(dto)` — `abstractSource` is the RAW abstract (HTML/MD) for
  lossless edit-prefill; `bodyFormat` ∈ PLAIN|MARKDOWN|HTML.
- `answerFrom(dto)` — `accepted` is the sole quality signal (voting removed).
- `searchHit(dto)` — canonical `contentType/contentId` first; ANSWER hits carry
  `parentId` (the owning question) — the only way to open one.
- `soundFrom(dto)` — `audioUrlRaw` is kept un-absolutised for the round trip
  (a post adopting a sound stores it verbatim; baking this client's host into a
  DB column would break other clients).
- `rankMeta` — `rankScore` on feed items is **debug-only; never re-sort on it**
  (it fights the server's diversity re-ranker and breaks pagination).
- `mediaFromUrls` — backend can send `mediaTypes: null` (defaults only catch
  `undefined`).

**RN note:** some adapters emit CSS `background` strings (`bg`, `cover`
gradients). Those are meaningless to RN — read the raw `url`/`poster` fields and
map the documented gradients (Part I §7) to RN gradient components.

## 6. The api namespace (`api/index.js`)

```
api.auth        api.users       api.posts      api.reels     api.stories
api.closeFriends  api.closeCircle  api.highlights  api.sounds
api.qna         api.research    api.search     api.tags      api.activity
api.mentions    api.notifications  api.chat    api.topics    api.madhhabs
api.admin       api.moderation  api.settings   api.security  api.media
api.channels    (same object as api.chat.channels — both names load-bearing)
```

Named re-exports on the barrel: `API_BASE, assetUrl, session` · `http, ApiError,
setStepUpPrompt` · the full errors.js surface · `openStream, applyPostDelta,
applyResearchDelta` (realtime) · chat/channel adapters (`convoFrom, msgFrom, …`,
`adminFrom, inviteFrom, …, RIGHT_KEYS, RIGHT_LABELS`) · taxonomy helpers ·
`SEARCH_TYPES, CURSOR_HEAD, hitHref` · the settings constant families
(`VISIBILITY_LEVELS, NOTIFICATION_CHANNELS, DND_DAYS, MEDIA_TIERS, …`) ·
`OTP_PURPOSES` · `MEDIA_STATUS_FAILED` · `REINDEX_CORPORA` · the moderation
constant families (`REQUIRES_STEP_UP`, `MODERATION_REDACTED`, …) · and
`adapters` as a namespace. **Not on the barrel:** `parseJson`, `saveBlob` —
import from `./http.js` directly.
# Part IV-A — Social & Content Modules

`auth` · `users`/`closeFriends` · `posts` · `reels` · `stories`/`closeCircle`/`highlights` ·
`research` · `qna`. All calls ride the `http` verb map from Part IV; adapters from
`adapters.js`.

## auth.js

| Function | Wire | Notes |
|---|---|---|
| `auth.login({identifier\|username\|email, password})` | `POST /auth/login` | If `res.mfaRequired`: returns `{mfaRequired:true, mfaToken, expiresIn≈300}` — **nothing stored**. Else stores token+user, returns `{token, user, expiresIn}` |
| `auth.loginTwoFactor({mfaToken, code})` | `POST /auth/login/2fa` | completes the second leg; stores session |
| `auth.register({fname, lname, username\|handle, email, password})` | `POST /auth/register` | stores session |
| `auth.refresh()` | `POST /auth/refresh` | body `{}` on web; RN must send `{refreshToken}` (Part III §3) |
| `auth.me()` | `GET /users/me` | `meFrom`; refreshes the stored user blob |
| `auth.logout()` / `auth.logoutAll()` | `POST /auth/logout` / `/auth/logout-all` | best-effort; **always** clears the local session |
| `auth.changePassword(current, next)` | `POST /auth/change-password` | rotates the stored token if the response carries one |

**Traps**

- **Two-leg 2FA:** on a 2FA account, login returns *only* `{mfaRequired, mfaToken,
  expiresIn}` — no session, no user. `mfaRequired` is **omitted entirely** on
  ordinary logins (never `false`) — *presence* is the branch.
- **`mfaToken` is memory-only** — never storage; it can't authenticate anything;
  single-use; burns after 5 attempts.
- All three 2FA errors arrive as **401**: `MFA_CODE_INVALID` (retryable — the
  challenge survives) vs `MFA_TOO_MANY_ATTEMPTS` / `MFA_CHALLENGE_INVALID`
  (terminal — back to the password screen). http.js never refresh-retries
  `/auth/` paths, so these surface intact.
- `code` accepts a 6-digit TOTP **or** a recovery code as typed — the server
  classifies; never pre-validate the format. TOTP codes are single-use.
- **Username ≠ email, but one login identifier:** whatever the user typed goes
  into the API's `username` field. Never coerce one into the other.

## users.js (+ closeFriends)

Identity/profile: `get(id)` · `getByUsername(un)` · `getByEmail(email)` ·
`updateIdentity(body)` `PATCH /users/me` · `deleteAccount()` ·
`profile(id)` · `meProfile()` · `updateProfile(body)` ·
`uploadAvatar(file)` / `uploadCover(file)` (multipart part **`image`**) +
`removeAvatar` / `removeCover` · `updateSpecializations(list)` /
`clearSpecializations()` · links CRUD (`addLink/editLink/removeLink`) · contacts
CRUD (`addContact/editContact/removeContact`).

Social graph: `follow(id)` `POST /users/{id}/follow` · `unfollow` ·
`block`/`unblock` · `restrict`/`unrestrict` ·
**`socialStatus(id)` `GET /users/{id}/social-status`** (the truth for Follow
buttons) · `followers(id)` / `following(id)` (page envelope) · `blocked()` /
`restricted()` · `suggestions({limit})` / `dismissSuggestion(candidateId)` /
`whoToFollow({limit})` · `stats(id)` `GET /users/{id}/stats` ·
`search(q, {page, size, eligibleContributor, signal})` / `searchList` ·
`users.contacts.sync(hashes)` / `users.contacts.clear()` (**deprecated** — use
`api.settings` contact sync) · email prefs (`emailPrefs`, `updateEmailPrefs`,
`testEmail`, `unsubscribeAll`) · `closeFriends.list/add/remove`
(`/users/me/close-friends` — the *management* list).

**Traps**

- **Never read `profile.followerCount`** — denormalized counters are not
  maintained; always `users.stats(id)`. On failure the client falls back to
  follower/following list `totalElements` and returns **null (not 0)** for the
  rest, so `stats?.posts ?? list.length` falls through.
- **`meProfile()` ≠ `profile(myId)`:** only the me-route populates
  `profileViews`, includes non-public links/contacts, and skips the 5-minute
  public-profile cache — use it right after a profile write.
- **Specializations are replace-all:** the body is the complete list; `[]`
  clears; array order = display order; one unknown topicId 404s the whole
  request.
- `users.search` is the dedicated people-picker (transactionally fresh, unlike
  global search `types=USER`); pass `signal` from live-typing pickers.
- `dismissSuggestion` is **permanent**.
- Two close-friends surfaces: this module's hydrated management list, vs the
  `closeCircle` enforcement list in stories.js that actually gates
  CLOSE_FRIENDS story visibility.
- List-row `isFollowing` is always false (Part IV §5) — use `socialStatus`.

## posts.js

| Function | Wire | Notes |
|---|---|---|
| `posts.feed({cursor, limit\|pageSize, ranked})` | `GET /posts/feed` | bare array of mixed `feedItemFrom` (POST/RESEARCH/QUESTION/CHANNEL_POST) |
| `posts.home({cursor, pageSize, ranked})` | `GET /posts/feed/home` | `{items, liveNow, nextCursor, ranked}` — the ranked home feed |
| `posts.liveNow()` | `GET /posts/feed/live-now` | followed hosts first, topped to 10 |
| `posts.byAuthor(authorId, {cursor, pageSize})` | `GET /posts/by-author/{id}` | |
| `posts.get(id)` / `create(cmd)` / `createMultipart(fd)` / `edit(id, cmd)` / `remove(id)` | `GET/POST/PATCH/DELETE /posts…` | create covers every postType incl. REEL and VOICE_POST |
| `posts.toggleReaction(id)` / `unreact(id)` / `reactedByMe(id)` | `POST/DELETE/GET /posts/{id}/reactions…` | empty-body toggle returning `{liked}` |
| `posts.reactionHistory(userId, pageSize)` | `GET /posts/users/{id}/reactions` | light tuples — hydrate via `get` |
| `posts.comments(postId, {cursor, pageSize})` / `addComment(postId, {text, mediaUrl, mediaType})` | `GET/POST /posts/{id}/comments` | body field is **`text`** |
| `posts.replies(commentId)` / `addReply(commentId, {text, mediaUrl})` | `GET/POST /posts/comments/{id}/replies` | |
| `posts.editComment(commentId, text)` / `deleteComment(commentId)` | `PATCH/DELETE /posts/comments/{id}` | |
| `posts.toggleCommentReaction(postId, commentId)` / `unreactComment` | `POST/DELETE /posts/{postId}/comments/{commentId}/reactions` | |
| `posts.toggleSave(id, collection)` / `unsave(id)` / `savedByMe(id)` / `savedPosts(userId)` | `/posts/{id}/saves…` | `collection` rides as a query param |
| `posts.share(id, caption)` / `sharesList(id)` | `POST/GET /posts/{id}/shares` | |
| `posts.shareLink(id)` | `GET /posts/{id}/share-link` | preview — **no count bump** |
| `posts.recordShare(id, caption)` | `POST /posts/{id}/share` | bumps count + ledger + notifies author |
| `posts.recordView(id)` | `POST /posts/{id}/views` | |
| `posts.suggestionsDetailed({limit})` | `GET /posts/suggestions/detailed` | **canonical** — hydrated identity, true double score |
| `posts.suggestions({limit})` | `GET /posts/suggestions` | legacy raw rows (score ×10 fixed-point); debug only |
| `posts.dismissSuggestion(candidateId)` | `POST /posts/suggestions/{id}/dismiss` | permanent |
| `posts.recomputeSuggestions()` | `POST /posts/suggestions/recompute` | 202 async — re-read after a beat |

**Traps**

- **`limit` beats `pageSize` on `/feed`:** the server resolves
  `limit > 0 ? limit : pageSize` with `limit` defaulting to 20, so `pageSize`
  is *never read* there — the client always sends the size as `limit`.
  `/feed/home` takes only `pageSize`, and that one is real.
- **`nextCursor` is authoritative on `home()`** — ranked order ≠ chronological;
  never re-derive the cursor from item order; `null` = end.
- `ranked` defaults true server-side — only put it on the wire when explicitly
  set; pass `false` for a "Latest" tab.
- `home()` is viewer-bound (anonymous → empty); `liveNow` and channel/explore
  injections are **first-page only**.
- Two share POSTs exist: `/shares` (the older social share) and `/share`
  (record + bump). Use `shareLink` + `recordShare` for the share sheet.

## reels.js

| Function | Wire | Notes |
|---|---|---|
| `reels.forYou({pageSize})` | `GET /posts/reels/for-you` | ranked; anonymous = global ranking |
| `reels.following({cursor, pageSize})` | `GET /posts/reels/following` | auth required |
| `reels.byAuthor(authorId, {cursor, pageSize})` | `GET /posts/reels/by-author/{id}` | profile Reels tab |
| `reels.feed({day, pageSize})` | `GET /posts/reels` | `day = 'YYYY-MM-DD'` UTC; legacy discover |
| `reels.recordWatch(postId, watchedSeconds)` | `POST /posts/{id}/reels/view` | watch **session**, not deduped |
| `reels.watched({page, size})` | `GET /users/me/reels/watched` | watch history |
| `reels.deleteWatched(reelViewId)` / `clearWatched()` | `DELETE …/watched/{id}` / `…/watched` | key is the **reelViewId**, not the post id |

**Traps**

- **A reel IS a post (`postType=REEL`) — creation lives in posts.js**
  (`createMultipart`), including the overlay.json (typed OTHER) and voiceover
  audio parts. This module is feeds + watch history only.
- `recordWatch` does **not** bump the view count — call `posts.recordView(id)`
  separately after the dwell threshold.
- Don't client-filter the mixed by-author feed for a Reels tab — use
  `reels.byAuthor` plus `reelCount` from `users.stats` so count and list agree.

## stories.js (+ closeCircle, highlights)

| Function | Wire | Notes |
|---|---|---|
| `stories.byAuthor(authorId)` | `GET /stories/by-author/{id}` | the tray fans out over `following` with this — **there is no tray list endpoint** |
| `stories.create(req)` / `createMultipart(fd)` / `remove(storyId)` | `POST/DELETE /stories…` | |
| `stories.recordView(storyId)` / `viewers(storyId, pageSize=50)` | `POST/GET /stories/{id}/views` | |
| `stories.getPoll(storyId)` / `attachPoll(storyId, req)` | `GET/POST /stories/{id}/poll` | poll sticker |
| `stories.vote(pollId, choice)` / `myVote(pollId)` / `results(pollId)` / `voters(pollId, choice)` | `/polls/{pollId}/…` | polls are top-level; `voters` is author-only |
| `stories.trayStream(handlers)` | SSE `GET /stories/tray/stream?token=` | `NEW_STORY` (light ring) · `STORY_REMOVED` (grey ring) · `POLL_VOTE_CAST` (author live tally); returns unsubscribe |
| `stories.storyStream(storyId, handlers)` | SSE `GET /stories/{id}/stream?token=` | page-scoped; open on screen, close on advance; 5-min server timeout |
| `closeCircle.list()` / `add(friendId)` / `remove(friendId)` / `isMember(candidateId)` | `/close-friends…` | **the enforced list** for CLOSE_FRIENDS visibility; add/remove pass `friendId` as a *query param* |
| `highlights.byAuthor(authorId)` / `create(req)` / `stories(highlightId)` / `addStory(hlId, storyId, requesterId)` / `removeStory(hlId, storyId, createdAt)` / `reorder(orderIds)` | `/highlights…` | `removeStory` needs the snapshot's `createdAt` clustering key; `reorder` skips foreign/missing ids |

**Traps**

- **`TRAY_PATH` (`/api/v1/stories/tray/stream`) is unconfirmed** against backend
  docs — if the server route differs, change that one constant.
- The SSE hardening contract (reimplement on RN): register **both**
  `lower_snake` and `UPPER_SNAKE` event names + route bare `message` frames by
  `data.eventType`; 60s silence watchdog (server beats ~25s) → close + fresh
  socket; on `readyState === CLOSED` re-dial after 3s **with a rebuilt URL**
  (token rotates hourly — reconnecting with the captured URL 401s forever).
- **Poll tallies are a delta-model exception:** tray `POLL_VOTE_CAST` carries
  `{pollId, voteA, voteB, voteTotal}`; per-story `STORY_POLL_VOTED` carries
  absolute counts (and no pollId) — **apply the values, don't ±1**.
- The per-story stream currently emits only connected/heartbeat (broadcasts not
  wired server-side); the tray stream covers removals.
- In mock mode SSE bypasses `request()` — streams report `onError({mock:true})`
  and stay silent (see Part VI).

## research.js (base `/api/v1/researches` — plural)

Feeds: `feed({page, size})` · `following` · `byResearcher(researcherId)` ·
`byTags(tags)` · `myDrafts` · `myAll` — all Spring offset pages → `researchFrom[]`.
Detail: `get(id)` / `bySlug(slug)` / `byShareToken(tok)` — **raw** ResearchResponse
(detail maps inline; feeds are adapted — mixed levels in one module).

Lifecycle: `create(formData)` (multipart `data` + files — the backend accepts
several file field names) · `update(id, req)` · `publish` / `unpublish` /
`archive` / `retract` / `unretract` (RETRACTED → PUBLISHED) · `remove`.

Media: `uploadCover(id, fileOrForm)` — part name exactly **`image`**, role-gated
to SCHOLAR/RESEARCHER/ADMIN (plain USER gets 403) · `removeCover` ·
`uploadVideoPromo` / `removeVideoPromo` · `addMedia` / `editMedia` / `deleteMedia`.

Scholarly graph: `sources(id)` (public, displayOrder asc) · `editSource` ·
`uploadSourceFile(id, sourceId, fd)` · `contributors(id)` · `addContributor` ·
`replaceContributors(id, list)` (the module's only **PUT**; body is the bare
list) · `editContributor` / `deleteContributor`.

Engagement: `react(id)` (body `{reactionType:'LIKE'}`) / `unreact` /
`reactionBreakdown` · `save(id, collection)` / `unsave` / `mySaved` /
`mySavedCollection(name)` / `savedCollections` / `renameCollection(old, new)` ·
comments (`comments`, `addComment(id, content, parentId)`, `addCommentUpload`,
`editComment`, `deleteComment`, `hideComment`/`unhideComment`,
`reactComment`/`unreactComment`) · `recordView(id)` (**singular `/view`**) ·
`download(id, mediaId)` · `shareLink` / `recordShare` · `cite(id)`.

**Traps:** comment body field is **`content`** (posts use `text`, Q&A uses
`body`) · view endpoint is singular `/view` · reactions carry an explicit
`{reactionType:'LIKE'}` body · trending research tags moved to
`api.tags.trending({scope:'RESEARCH'})`.

## qna.js (base `/api/v1/questions`)

| Function | Wire | Notes |
|---|---|---|
| `qna.feed({cursor, limit})` | `GET /questions/feed/cursor` | **real cursor envelope** `{items, nextCursor, hasMore}` |
| `qna.list({page, size})` / `following` / `mine` | offset pages | `questionFrom[]` |
| `qna.get(id)` / `create(req)` / `edit(id, req)` / `remove(id)` | `/questions…` | create: `{title, body, tags?, keywords?, answersLocked?, maxAnswers?}` |
| `qna.lockAnswers(id)` / `unlockAnswers(id)` | `POST/DELETE /questions/{id}/lock-answers` | |
| `qna.answerLimit(id, maxAnswers)` | `PATCH /questions/{id}/answer-limit` | `maxAnswers` as a **query param**, empty body |
| `qna.answers(qId, {page, size})` / `postAnswer(qId, req)` / `postAnswerUpload(qId, fd)` | `/questions/{id}/answers…` | |
| `qna.reanswers(qId, aId, {page, size=50})` / `postReanswer` / `postReanswerUpload` | `…/answers/{aId}/reanswers…` | note default size **50** |
| `qna.editAnswer(qId, aId, body)` / `deleteAnswer` | `PATCH/DELETE …/answers/{aId}` | text field is **`{body}`** |
| `qna.react(qId, aId)` / `unreact` | `POST/DELETE …/answers/{aId}/react` | **singular `/react`**, body `{reactionType:'LIKE'}` |
| `qna.accept(qId, aId)` / `unaccept` | `POST/DELETE …/answers/{aId}/accept` | author-only; **accept is the sole quality signal** (voting removed) |
| attachments: `listAttachments` / `addAttachment` / `editAttachment` / `deleteAttachment` | `…/answers/{aId}/attachments…` | |
| sources: `listSources` / `addSource` / `editSource` / `uploadSourceFile` / `deleteSource` | `…/answers/{aId}/sources…` | MEDIA_FILE is a **two-step**: POST the source row, then upload part **`file`** |
| saves: `save(qId, collection)` / `unsave` / `mySaved` / `mySavedCollection` / `savedCollections` / `renameCollection` | `/questions/{id}/save…` | singular `/save` |
| `qna.shareLink(qId)` / `recordShare(qId)` | share pattern | |

**Traps:** every answer-scoped route needs BOTH ids in the path · gate the
answer composer on `acceptsNewAnswers`, not `status` · **Q&A SSE echoes your own
actions — dedupe adds by id** when layering realtime on these calls.

## Cross-module invariants (memorize these)

- **"The text field" differs per module:** posts `text` · research `content` ·
  Q&A `body`.
- **Record-view spelling differs:** posts/stories `/views` · research `/view` ·
  reels `/reels/view` (a watch session, not a view bump).
- **Reaction dialects:** posts = empty-body toggle on `/reactions` → `{liked}` ·
  research = `{reactionType:'LIKE'}` on `/reactions` · Q&A = same body on
  `/react`.
- **Save dialects:** posts `/saves` · research & Q&A `/save`; all take
  `collection` as a query param.
- **Share pattern is uniform:** GET `share-link` previews (no bump); POST
  `/share` records (bump + ledger + notification).
- **Three pagination shapes:** Spring offset envelope
  (`content/totalElements/last`) · cursor envelope (`items/nextCursor`) for
  `posts.home` and `qna.feed` · bare arrays for legacy feeds. An RN list layer
  needs all three.
- **Multipart part names that matter:** `image` (avatar, cover, research cover) ·
  `file` (Q&A source file) · `data` + flexible file names (research create).
# Part IV-B — Discovery & Platform Modules

`search` · `tags` · `taxonomy` (topics/madhhabs) · `mentions` · `activity` ·
`sounds` · `media` · `admin`.

## search.js — the one cross-entity search

Constants: `SEARCH_TYPES = ['POST','REEL','QUESTION','ANSWER','RESEARCH','USER','CHANNEL','SOUND']` ·
`CURSOR_HEAD = 'head'` · `hitHref(hit)` maps a hit to a route (POST/REEL →
`/posts/{id}`, QUESTION → `/qna/{id}`, ANSWER → `/qna/{parentId}#answer-{id}`,
RESEARCH → `/research/{id}`, USER → `/u/{id}`, CHANNEL → `/channels/{id}`,
SOUND → `/explore?sound={id}`).

| Function | Wire | Notes |
|---|---|---|
| `search.stream(q, {types, cursor, size, expand, signal})` | `GET /search` | **auto-substitutes `CURSOR_HEAD`** when no cursor given, so cursor mode always opens; envelope `{query, types, page, size, degraded, nextCursor, results}` |
| `search.page(q, {types, page, size, …})` | `GET /search` | offset mode — `nextCursor` absent by design |
| `search.query(q, opts)` | `GET /search` | raw endpoint behavior verbatim |

**Traps**

- **Cursor mode is *entered* with a cursor, not after one.** A request with no
  `cursor` runs offset mode and the response omits `nextCursor` entirely — a
  naive "page 0 then follow nextCursor" loop re-appends page 0 forever. Enter
  with `cursor=head`, trust **only** `nextCursor` (`''` = no further page).
  Use `search.stream()`.
- Public endpoint — enforces public visibility for everyone (owners can't find
  their own private content).
- `degraded: true` = Elasticsearch is down, results are a soft fallback — **no
  error toast**.
- Blank `q` short-circuits client-side (no network call). Unknown `types` tokens
  are silently skipped; if none remain the server searches all types.
- Live-typing must pass `signal` and abort the previous call.
- ANSWER hits open via `parentId` (the owning question) — an answer has no page.
- The old per-module `/posts/search`, `/questions/search`, `/researches/search`
  are gone — this is the only full-text entry point (`users.search` is the
  separate people-picker).

## tags.js (all reads public)

`normalizeTag(t)` (lowercase, trim, strip `#`, cap 100) · `normalizeTags(list)`
(dedup, cap 30) · `tags.trending({scope, limit})` `GET /tags/trending` (scope ∈
ALL|QUESTION|RESEARCH|POST|REEL) · `tags.content(tag, {cursor, pageSize})`
`GET /tags/{tag}/content` → `{tag, items, nextCursor, pageSize}` (newest-first,
all entity kinds mixed) · `tags.usage(tag, {scope})` — `scope:'*'` returns the
full per-scope breakdown in one call · `tags.search({prefix, scope, limit})` —
prefix autocomplete over the whole catalogue (blank prefix → `[]`, no call).

**Traps:** the content cursor is opaque — pass `nextCursor` straight back ·
autocomplete must use `tags.search` (`trending` only knows the top-N) ·
Arabic ↔ Latin tags stay distinct — never transliterate.

## taxonomy.js — topics & madhhabs (public reads, session-cached)

`topics.list({q})` / `madhhabs.list({q})` `GET /topics` / `GET /madhhabs` ·
`topics.all()` / `.search(q)` / `.byId(id)` / `.forget()` (same for madhhabs) —
`all()` reads once per session; `search()` filters the warm cache in memory (no
round-trip per keystroke); `byId` renders stored ids in the reader's language.
Helpers: `taxonomyRowFrom` (`{id, nameEn, nameAr, nameCkb}` — accepts
`id|topicId|madhhabId`), `taxonomyName(row, lang)`, `taxonomyDir(row, lang)`
(AR/KU → rtl), `taxonomyFilter(rows, q)`, `specializationsTo(list)` (builds the
replace-all PATCH body; position = displayOrder).

**Traps:** **the dev DB has ZERO rows and there is no write API** — rows are
operator-managed in Postgres; curl before debugging an "empty picker" · the
Central Kurdish column is `nameCkb` while the app language code is `KU` ·
profile responses carry only the English name — use `byId` for AR/KU rendering.

## mentions.js

| Function | Wire | Notes |
|---|---|---|
| `mentions.suggest(q, limit=6)` | `GET /mentions/suggest` | ranked, block-aware, excludes deleted/locked/self — **the** autocomplete source (not user search) |
| `mentions.click(query, targetUserId)` | `POST /mentions/click` | fire-and-forget lock-in signal; notifications fire on *save*, never on click |
| `mentions.parse(text)` | `POST /mentions/parse` | server-grammar token extraction with offsets (incl. `@followers`) |
| `mentions.me({limit, cursor})` | `GET /mentions/me` | everywhere I was directly mentioned; keyset cursor = last row's `mentionedAt` |

**Traps:** chat mentions are deliberately absent from `/mentions/me`
(deletable/disappearing messages) — they surface only as `MESSAGE_MENTION`
notifications · **deepLink rewrite required**: API paths ≠ client routes
(`/researches/`→`/research/`, `/questions/`→`/qna/`, `/users/`→`/u/`) — the same
rewrite the notifications inbox applies.

## activity.js (owner-scoped: "my activity")

`activity.list({types, from, to, page, size})` `GET /users/me/activity` (labels,
subtitles and dates are **server-rendered**; envelope-tolerant) ·
`activity.remove(id)` · `activity.clear(type?)` ·
`activity.stream({onActivity, onError})` — SSE `GET /users/me/activity/stream?token=`.

Deep links: post → `/reels/{id}` when `postType==='REEL'` else `/posts/{id}`;
question → `/qna/{id}`; research → `/research/{id}`; user → `/u/{id}`;
`HASHTAG_SEARCH` → `/tags/{tag}`; bare query → `/explore?q=`.

**Traps:** the stream has **no server timeout** — without the 60s watchdog a
wedged socket stays dead forever · the token is re-read on every dial ·
`connected`/`heartbeat` frames carry no rows but reset the watchdog · in mock
mode the stream reports `onError({mock:true})` once and stays silent.

## sounds.js

`sounds.get(id)` · `sounds.search(q, {category, limit})` `GET /sounds/search`
(ES BM25 over title/artist, typeahead, popularity breaks ties) ·
`sounds.byCategory(category, {cursor, pageSize})` (Cassandra browse — a
different engine, not interchangeable) · `sounds.posts(id, pageSize)` ·
`sounds.usage(id)` · `sounds.upload(req)` (JSON; `autoApprove:false` for
regular users).

**Traps:** blank `q` → `[]` is the endpoint's contract (use the category
browser to list) · if ES is down `search` returns `[]`, not a 5xx — the picker
must fall back to `byCategory` · only APPROVED sounds surface.

## media.js — the upload pipeline

Constants: `MEDIA_STATUS_FAILED = {FAILED_VALIDATION, FAILED_MODERATION,
FAILED_PROCESSING}` · `MEDIA_LIMITS = IMAGE/AUDIO 25 MB, VIDEO/FILM/VIDEO_CLIP
512 MB` (courtesy pre-check; server is the authority) · digest skipped above
64 MB.

Pipeline: `media.upload(file, {type, tier, onProgress, signal, pollMs=1200,
maxPolls=150})` = `uploadIntent({mime, sizeBytes, sha256?, type}, tier)`
(`POST /media/upload-intent`, header `X-Media-Tier`) → presigned **PUT** of the
bytes → `complete(id)` (`POST /media/{id}/complete`, 202 empty) → poll
`status(id)` (`GET /media/{id}`) until READY or FAILED_* (~3 min budget).
`media.remove(id)` is a hard delete (second call 404s).

**Traps**

- **sha256 dedup:** a hit answers `presignedPutUrl: null` + `deduped: true` +
  READY — nothing to upload; `upload()` jumps straight to done.
- The presigned PUT is a **foreign origin** — the URL is the auth; never send
  the app's Authorization header; Content-Type must match the intent's mime.
- Size cap is enforced **before** hashing (never buffer a 512 MB file just to
  learn it's too large). Files > 64 MB upload fine but skip dedup.
- Any garbage tier resolves to HIGH server-side.
- RN: `file.arrayBuffer()`, `crypto.subtle`, XHR progress and `DOMException`
  all need the `platform/files.js` equivalents (Part III §2).

## admin.js (ROLE_ADMIN only)

`REINDEX_CORPORA` — 7 rebuildable search projections (posts, questions,
answers, research, users, channels, sounds) · `admin.reindex(corpus,
{drop=true})` `POST /admin/search/{corpus}/reindex?drop=` — **synchronous**;
the response carries final counts.

**Traps:** `drop=true` (default) is the repair for the dynamic-mapping trap —
an index auto-created by its first write maps lifecycle keywords (`visibility`,
`status`, `postType`) as analysed `text`, and exact `term` filters silently
stop filtering · there is deliberately no chat-messages corpus (self-heals per
message) · everything else under `/api/v1/admin/**` lives in the separate
admin-dashboard repo, not this app.

## Paging vocabularies in this part (do not conflate)

`/search`: `size` + `cursor`/`page` · `/tags/{tag}/content`,
`/sounds/by-category`: `pageSize` + `cursor` · `/users/me/activity`: Spring
`page` + `size` + `sort` · `/mentions/me`: `limit` + keyset `cursor`
(timestamp). Public/no-token endpoints: `/search`, `/tags/*`, `/topics`,
`/madhhabs`.
# Part IV-C — Realtime & Comms Modules

`chat` · `channels` · `realtime` · `notifications` · `settings` · `security` ·
`moderation`. This is where the SSE architecture lives — read §8 (the realtime
model) even if you skip the rest.

## chat.js (1,478 lines) — messaging, calls, live streams

One module covers conversations, messages, drafts, scheduled sends, chat
settings, calls, live streams (with stage/gifts), members, message requests,
presence, typing — and the single per-user SSE stream that multiplexes all of it.

**Adapters exported** (each fixes a wire quirk): `msgFrom` (Snowflake `messageId`
→ string; `views/forwards/comments` are `null` outside channels — test `!= null`,
never truthiness) · `convoFrom` (`muted` is derived — `mutedUntil` is an
*instant*, not a flag; `peerLastRead…` null = read-receipts privacy;
`slowModeSeconds` exempts owner/admins) · `pollFrom` (quiz answers withheld until
vote/close — `null` = "not revealed") · `memberFrom`, `requestFrom`,
`participantFrom`, `settingsFrom` (absent row = every switch ON), `scheduledFrom`,
`draftFrom`, `channelFrom` (`id` IS the conversationId; three subscribe states),
`channelSettingsFrom`/`channelSettingsTo` (**send the complete settings object —
a partial PATCH silently resets omitted knobs**), `callFrom`, `callSignalFrom`
(payload = opaque SDP/ICE, never parsed), `liveStreamFrom` (`ingestUrl`/`whipUrl`
host-only; `recordingDownloadUrl` is an **authed path** — fetch via
`http.download`, never a plain link), `recordingInfoFrom`, `liveChatFrom`
(ephemeral — never persisted), `stageMemberFrom` (`whipUrl`+`publishKey` secret,
only on YOUR member; `avatarUrl` absent on every frame today — always initials
fallback), `stageStateFrom`, `streamReactionFrom`, `streamGiftFrom`
(`senderTotalCoins` = new running total — fold, don't re-fetch), `giftEntryFrom`,
`giftSupporterFrom`.

**Surface map** (`chat.*`):

- **conversations** — `list/archived({page, size})` · `create` /
  `createDirect(recipientId)` / `createGroup({title, memberIds, …})` · `get` ·
  `update` · `remove` (**on a channel id: owner = delete-for-everyone, others =
  leave**) · `read(id, lastReadMessageId)` · `unread(id)` (personal force-dot) ·
  `mute(id, mutedUntil)` (`null` = unmute) · `pin` · `archive` ·
  `disappearing(id, seconds)` (0 = off; TTL applies only to messages sent after).
- **messages** — `page(convId, {cursor, limit=40})` ·
  `sync(convId, afterId)` (ascending gap-sync after reconnect) ·
  `search(convId, q)` · `send(convId, {clientNonce, type, body, replyToId,
  media, silent, poll, location, contact})` (typed payload only under its own
  type — mismatch is a 400) · `sendFiles(convId, {files, durationMs, waveform,
  …})` (multipart `/messages/upload`; **backend currently drops
  durationMs/waveform** — the echo carries neither) · `get/edit/remove(messageId,
  scope='everyone'|'me')` · `forward` · `delivered` · `react(messageId, emoji)` /
  `unreact` / `reactions` · `pin/unpin/pinned` · `star/unstar/starred` (starred
  returns a **bare list**, not a Spring page) · `seenBy` (empty = receipts
  privacy, a normal answer) · `media(convId, {kind, before})` ·
  `byTag(convId, tag)` · `vote(messageId, optionIndexes)` · `retractVote`
  (**400s on a quiz by design**) · `closePoll`.
- **drafts** — server-side per conversation: `get` (**404 = "no draft" → null**,
  not a failure) · `save` (sending clears server-side — don't re-save after
  send) · `discard`.
- **scheduled** — `create(convId, {scheduledAt, …})` (fires ~every 15s;
  permission re-checked at fire time → FAILED if blocked/removed) · `list` ·
  `cancel(scheduledId)`.
- **settings** — `get()` / `update(patch)` — PUT but **partial-safe here**
  (the one exception); read receipts + last-seen are reciprocal, typing is
  one-way.
- **calls** — `start(convId, type)` (starts OR joins; one live call per
  conversation) · `get` · `accept` · `decline` · `end` ·
  `signal(callId, {toUserId, kind, payload})` — the server is a blind relay;
  media is P2P WebRTC.
- **streams** (live) — `start({title, description, record})` · `live()` /
  `followingLive()` · `get` · `end` · `join` (returns playbackUrl) ·
  `leave(id, {beacon})` (**beacon on exit or phantom viewers inflate the
  count**) · `chat(id, text)` (ephemeral, 20/10s) · `mine()` (**the only route
  to an ended stream/recording**) · `update` · `remove` ·
  `startRecording/stopRecording` (recorded in takes) · `recording(id)`
  (manifest, owner-only) · `downloadRecording(id, {part})` /
  `saveWholeRecording(id)` (**part-less download 400s when >1 part; multi-part
  is routine** — MediaMTX restarts on track-set change) · `react(id, type)`
  (cap 30/10s, broadcast-only).
- **streams.stage** (multi-guest) — `get` (public roster) · `requestUp` ·
  `requests` (host) · `approve/deny(userId)` (**credentials go to the guest via
  the `stream.stage.grant` SSE frame — the approve response is public view
  only**) · `invite` · `accept` (response = YOUR member WITH whipUrl/publishKey)
  · `decline` · `leave({beacon})` · `remove(userId)` · `mute/unmute(userId)`
  (authoritative flag).
- **streams.gifts** — `catalog` · `send(id, giftId)` (**the `stream.gift`
  broadcast echoes to the sender — animate from the frame, not the response, or
  the sender sees it twice**) · `top`.
- **members** — `list` · `add(convId, userIds)` · `remove` ·
  `setRole(ADMIN|MEMBER)` · `restrict` · `leave` · `transferOwner` ·
  `createInvite/revokeInvite` · `join(token)` → `{status, pending,
  conversation}` — **`conversation` is NULL under `PENDING_APPROVAL`; that's a
  success, branch on `pending`**.
- **requests** (message requests) — `list({status})` · `count` ·
  `accept/decline/block(id)`; strangers get 3 pre-acceptance messages.
- top-level — `presence(userIds)` (empty input short-circuits — never send
  `userIds=`) · `typing(convId, isTyping, activity)` (activity ∈ TYPING ·
  RECORDING_VOICE · SENDING_PHOTO/VIDEO/VOICE/FILE) · `unreadCount()` ·
  `searchAll(q)` · `newNonce()` · `stream(handlers)`.

**The chat SSE stream** — `GET /api/v1/messaging/stream?token=`. ONE per-user
socket; channels, calls, live streams, stage, reactions and gifts are all
multiplexed onto it. Handler map: `message.new/edited/deleted/reaction/comment`,
`receipt.read/delivered`, `typing`, `presence`, `conversation.updated`,
`member.changed`, `request.new`, `poll.updated`, `channel.join_request`, all
`call.*`, all `stream.*` — plus `onAny` and `onError(readyState)`.

**Chat traps:**

- **Voice-note normalization:** `AUDIO`, or `FILE` with an `audio/*` mime or an
  audio-extension filename (`.webm` only when named `voice-<ts>.webm`) → kind
  `VOICE`. Legacy rows depend on this.
- **Counter deltas:** unread/reaction counts are deliberately absent from SSE
  payloads — apply ±1 locally.
- **`poll.updated` is viewer-neutral** (no `myVotes`) — keep local votes, take
  only counts. **`message.comment` carries the post's id**, not the comment's —
  ±1 that post's counter.
- **`stream.viewer/.updated/.ended` omit host identity** — patch into the
  existing card (`lib/liveRows.js`), never assign over it, or the avatar
  vanishes on the first viewer. **`stream.stage` is the whole panel — replace,
  never merge.**
- `message.deleted` is the only place the deleter is knowable; the REST row has
  no actor — keep bubble copy impersonal when null.
- Unlisted SSE event names are dropped silently — every name is enumerated, in
  both `dot.case` and `UPPER_SNAKE`, plus bare `message` frames routed by
  payload discriminator.
- Frames are parsed with `parseJson` (Snowflake quoting), never `JSON.parse`.

## channels.js (441 lines)

Rights model: `RIGHT_KEYS` (9 gates: canPostMessages, canEditMessages,
canDeleteMessages, canPinMessages, canInviteUsers, canApproveJoinRequests,
canChangeInfo, canAddAdmins, canManageLive) · `rightsFrom` (**a null rights
object = full rights** — legacy admins + owner) · `rightsTo` (writes every flag
explicit) · `can(member, key)` (OWNER always true; ADMIN checks
`rights[key] !== false`; MEMBER false).

Surface: `create({title, handle, publicChannel, category, settings})` · `get` /
`byHandle` · `discover(q, {category})` · `update(id, patch)` (**`settings` is a
whole-object replacement**) · `subscribe`/`unsubscribe` (unsubscribe = leave;
OWNER cannot leave → 403) · `remove` (owner-only, deletes for everyone,
broadcasts `conversation.updated` + `memberChange:"DELETED"`) · `photo`/`cover`
upload (part `file`) + removes · `setVerified` (platform admin only) ·
`admins.list/set/promote/demote` (**bare PUT `{}` grants FULL rights** — the
documented shortcut; an unchecked box must transmit `false`) ·
`invites.create/list/revoke/redeem` (**the plaintext token is returned exactly
once on create** — `list` can never recover it; redeem →
`{status, pending, conversation}` with the PENDING_APPROVAL null-conversation
arm) · `requests.list/approve/reject` · `markViews(id, messageIds)` (≤100 ids;
HyperLogLog — re-reporting is free) · `stats` (exact Postgres block + best-effort
Redis block — label the second) · `discussion.link/unlink/add/list` (first
comment auto-joins you to the discussion group; **returned messages belong to
the group — never merge into the channel timeline**).

**Traps:** channel stories & highlights are **removed from the backend** — every
such route 404s · channel reads are membership-floored · two id families:
conversations/channels/users are UUIDs, post ids are Snowflakes via `mid()` ·
the chat.js↔channels.js circular import is safe only because shared adapters
are hoisted `function` declarations — **don't convert them to arrow consts in
the port**.

## realtime.js — per-entity SSE (posts / questions / researches)

`openStream(domain, id, handlers) → unsubscribe` — SSE
`GET /{posts|questions|researches}/{id}/stream?token=` ·
`applyPostDelta(post, evt)` · `applyResearchDelta(metrics, evt)` ·
`pushMockEvent(domain, id, evt)` (mock driver).

- **Manager pattern:** ONE shared EventSource per `(domain, id)` — dial on first
  subscriber, close on last; late joiners get a cached `connected`. This is what
  keeps you under the **5-SSE-per-user cap**.
- **Actor-skip is server-side:** your own action never echoes, so optimistic
  ±1 is safe and never double-counts.
- **Post events carry no counts → local ±1.** Exceptions:
  `SAVE_COUNT_UPDATED` fires for save AND unsave with no direction —
  deliberately a no-op (debounce-re-read the truth); `SHARE_COUNT_UPDATED`
  carries the absolute — set, don't add.
- **Research counters:** granular events ±1; `*_COUNT_UPDATED` absolutes are
  folded via `max(local, absolute)` (straight-set would revert an in-flight
  optimistic +1); REACTION/COMMENT `_COUNT_UPDATED` deliberately unhandled (one
  action must never count twice).
- Heartbeat ~25s; watchdog >60s silence → close-then-reconnect; token re-read
  and URL rebuilt on every connect.

## notifications.js

`list({category, type, unread, page, size})` (filters AND-compose; `type`
accepts arrays as repeated params) · `unreadList` · `unreadCount(category?)`
(without category: exact O(1); with: approximate scan-window) · `markAllRead` ·
`markRead(id)` · `markReadBulk(ids ≤200)` · `markCategoryRead(c)` · `remove(id)`
· `deleteRead()` (purge; its SSE echo `deleted` with EMPTY ids + `allRead:true`
means "drop every read row") · `subscribe(handlers)` → SSE
`GET /notifications/stream?token=` with `onConnected, onNotification,
onFeedNewPost, onUnreadCount, onRead, onDeleted` ·
`moderationKindOf(n)` — classifies the three moderation SYSTEM_MESSAGE titles
(removed / review / live) — the one documented copy-matching exception.

**Traps:**

- **The scan window:** filtering, category counts and bulk marking operate over
  the newest **200 rows** — deeper pages come back empty even when older
  matches exist; empty next page = "the end", never an error.
- **Aggregation keeps the id:** "and N others" re-delivery rides SSE with the
  SAME id reset to unread — **upsert by id and float to top, never append**.
  The badge is only ever SET from the `unread-count` event / count endpoint —
  never hand-tallied.
- **`FEED_NEW_POST` is a named SSE event, not an inbox row** — route to
  `onFeedNewPost` only; fanning it to `onNotification` double-counts and
  double-chimes.
- **Deep-link rewrite:** `/users/`→`/u/`, `/questions/`→`/qna/`,
  `/researches/`→`/research/`; `/comments/…` and `/answers/…` are unroutable
  (render un-clickable); moderation system messages →
  `/settings/safety#moderation`; `TRENDING_DIGEST` ships `deepLink: null` by
  design → `/explore`.
- Watchdog is **45s** here (chat/realtime use 60s); on a hard close it runs
  `auth.refresh()` then re-dials (one heal per 8s window). `onConnected` fires
  on every (re)connect — treat it as the "reconcile via REST" signal.

## settings.js — the server-enforced settings surface

Constant families (exact backend strings): `VISIBILITY_LEVELS` (EVERYONE,
FOLLOWERS, FRIENDS, CLOSE_FRIENDS, CUSTOM, ONLY_ME) · `PRIVACY_GROUPS` (23 field
keys) · `PRESENCE_POLICIES` · `NOTIFICATION_CHANNELS` (PUSH, IN_APP, EMAIL, SMS,
DESKTOP) · `NOTIFICATION_GROUPS` (42 types in 8 groups; a few deliberately
ungrouped — render under "Other") · `LOCKED_NOTIFICATION_TYPES`
(`ACCOUNT_WARNING` — always delivered, render locked-on) · `DND_DAYS` (bitmask
Mon=1…Sun=64; 0 = every day) · `REPORT_TARGET_TYPES` / `REPORT_REASONS` /
`REPORT_OUTCOME_LABELS` · `MEDIA_TIERS` (DATA_SAVER/STANDARD/HIGH) ·
`POLICY_KEYS`.

Surface: `all()` / `section(s)` / **`patchSection(s, patch)`** (JSON Merge Patch
— the only safe partial write) / `replaceSection(s, block)` ·
`privacy.map/setField` (responds with the full refreshed map — use it) ·
`privacy.lists.*` (members are **bare UUID arrays**) · `privacy.muted.*`
(**bare UUIDs** — hydrate via `mutedUsers()`) · `privacy.keywords.*` ·
`presence.get/update` · `discovery.get/update/qr/rotateQr/resolveQr` ·
`consent.record/history/state` · `contactsSync.sync(hashes, appVersion)`
(**never the deprecated `/users/contacts/sync` alias**; 3/24h limit; `skipped` ≠
`matched:0`) / `contactsSync.clear()` · `blocks.list/block/unblock` ·
`notifications.matrix/setPref/dnd/updateDnd/prefs/invalidatePrefs` ·
`notifications.pushTokens/registerPushToken({provider, token, platform, sid})/
deletePushToken` — **the key surface for RN push (APNs/FCM device tokens)** ·
`storage.usage` · `data.requestExport/exportStatus/downloadExport` (1 per 30
days) · `data.clearHistory('search'|'watch')` · `data.requestDeletion`
(**instantly soft-deletes + revokes all refresh tokens — treat success as a
logout**) / `cancelDeletion` · `safety.report/myReports/appeal/strikes/score` ·
`app.config` (`{minSupportedVersion, forceUpdate, latestVersion}` — **the RN
force-update gate**, permitAll) / `app.policy/acceptPolicy/accepted`.

**Traps:** **PUT nulls cosmetics — always PATCH for partial writes** · the DND
PUT re-derives `enabled` from the window if omitted — always send it
explicitly · Jackson NON_NULL: absent key === null, parse defensively ·
timestamps are zoneless LocalDateTime with a literal bolted-on `Z` — don't
trust it for timezone math.

## security.js

`sessions.list` (**only `createdAt` + `trusted` are actually populated — never
key rows on `sid`**; hide sid-addressed actions when missing) /
`sessions.revoke(sid)` / `sessions.trust(sid, days)` ·
`twofa.setup()` (**step-up required** — a stolen session must not enrol its own
device; returns `{provisioningUri, secret}` shown once) / `twofa.verify(code)`
(returns the 10 recovery codes on first enable) / `twofa.disable()` (step-up) /
`twofa.status()` / `regenerateRecovery()` (step-up; invalidates the previous
set) · `loginHistory()` (`method` ∈ PASSWORD, PASSWORD+TOTP, PASSWORD+RECOVERY
— surface RECOVERY loudly) · `stepUp({password}|{code})` (**bad code/empty body
→ a BARE 400 with no envelope**) · `withStepUp(action, challenge)` — try → on
403 STEP_UP_REQUIRED → challenge → arm → retry once; honors
`err.stepUpCancelled` so the user is never double-prompted ·
`phone.request/verify` (**409 PHONE_ALREADY_BOUND** — one number, one account) ·
`email.request/verify` (no destination in the request by design; email code
lives 15 min, phone 5) · `otp.request/verify` (enumeration-safe: **always 202**,
even when rate-limited).

**Traps:** the step-up dance is a *global* concern — http.js handles it via the
StepUpHost prompt; anything outside that shell wraps in `withStepUp` · phone
binding is write-only for reads (no GET exposes the number — panels show only
what they verified this session); email verification IS readable back via
`users/me.isEmailVerified`.

## moderation.js (754 lines) — the staff console client

The author-facing half (held states, codes, copy) lives in `lib/moderation.js`;
this module is the ADMIN/MODERATOR console under `/api/v1/admin/moderation/**`
+ `/api/v1/admin/content/blocklist`. Namespaces: `review`
(list/get/decide/bulk/rescore/metrics) · `settings` (thresholds, hold-durations,
dry-run, raw overrides, reset) · `model` (training examples, golden cases,
versions, retrain/promote/shadow/rollback, score-probe) · `queue` (legacy
reactive inbox) · `blocklist` (list/add/update/remove/test).

Load-bearing traps if you build any of this UI:

- `REQUIRES_STEP_UP` lists the 11 writes that must be wrapped in
  `security.withStepUp` — the module never arms step-up itself.
- **entityType casing:** request params accept case-insensitively but NOT
  hyphens (`chat-message` = 400); responses are mixed (QueueRow UPPERCASE,
  thresholds/metrics keys lowercase) — convert on both sides or the queue
  silently reads empty.
- Review-list filters are not composable (`slaBreached` wins; `counts` is
  global); a missing case is **400 MODERATION_CASE_NOT_FOUND, never 404**.
- Chat/live-chat bodies are redacted with an exact placeholder string
  (`MODERATION_REDACTED`); `teachModel` silently no-ops for those types.
- Bare arrays with no totals on several lists; `?page=&pageSize=` everywhere,
  no cursors; timestamps carry the fake `Z`.
- The wider admin dashboard lives in a separate repo (`ikh-admin`) — this
  module is only the in-app console.

## The realtime model (memorize this page)

1. **Budget: 5 SSE connections per user, server-enforced with LRU eviction.**
   In practice the app holds three: the chat stream, the notifications stream,
   and one shared per-entity realtime stream. Never open one per component.
2. **Auth:** `?token=<jwt>` on the URL (headers impossible in browser
   EventSource; on RN you *may* switch to `Authorization: Bearer` after
   verifying the server accepts it). **Re-read the token and rebuild the URL on
   every connect** — it rotates ~hourly; a captured URL re-dials with a dead
   token forever.
3. **Heartbeats ~25s. Watchdogs:** chat + realtime 60s, notifications 45s, all
   ticking at 15s; on breach: **close, then** open one fresh socket.
4. **Hard close (readyState 2)** = expired token: refresh, then re-dial (the
   notifications module shows the pattern).
5. **Deltas, not absolutes:** frames carry no counters — apply ±1 locally;
   the server skips the actor so optimistic UI never double-counts.
   Exceptions: share counts and story-poll tallies are absolutes (set, don't
   add); research `*_COUNT_UPDATED` folds via max().
6. **Event names:** register every expected name (both `dot.case` and
   `UPPER_SNAKE`) plus the bare `message` fallback; unlisted names drop
   silently.
7. **Parse frames with `parseJson`** (Snowflake-safe), never `JSON.parse`.
8. **Mock mode cannot intercept EventSource** — every stream constructor needs
   the `mockEnabled()` guard (report `{mock:true}` and stay silent, or use the
   scripted replay).
# Part V — State Layer: Contexts, Hooks, Libraries

> **⚠️ Top-level trap:** `mobile-kit/src` has **no `components/` directory**, yet
> the contexts import from it: ChatContext and CallContext need
> `showToast(text)` (`../components/ui.jsx`), `chatError(err, fallback)`
> (`../components/chat/chatErrors.js`) and `openCallLog`/`recordCall`
> (`../components/chat/callLog.js`). Supply these three tiny shims or the
> contexts won't even resolve. AuthContext additionally imports
> `react-router-dom` — `RequireAuth`/`RequireRole` become navigator guards.

## AuthContext (127 lines)

Owns `user` (seeded **synchronously** from `session.getUser()` — hence the MMKV
rule) and `ready`. API via `useAuth()`: `{user, ready, signedIn, login,
completeTwoFactor, register, logout, logoutEverywhere, refreshUser, setUser}`.

- `login(fields)` returns the 2FA challenge (`mfaToken`) **without a session**
  when `mfaRequired` — `signedIn` stays false until
  `completeTwoFactor({mfaToken, code})`.
- **Proactive refresh:** schedules `api.auth.refresh()` at
  `max(30, expiresIn − 60)` seconds, re-scheduling from each response's own
  `expiresIn`; the reactive 401 flow in http.js is the safety net.
- Listens for `AUTH_EXPIRED` (`ika:auth-expired`) → clears the timer, nulls
  `user`.
- Exports `hasRole(user, …roles)` (case-insensitive), `isPlatformAdmin(user)`,
  `PLATFORM_ADMIN_ROLES = ['ADMIN','SUPER_ADMIN']`, `RequireAuth`, `RequireRole`
  (renders refusal in place — no redirect).

## ChatContext (934 lines)

Owns **the one per-user chat SSE socket** for the whole app (mounted above the
navigator) plus the inbox: `conversations`, `archived`, `requests`,
`totalUnread`, `requestCount`, `chatSettings`, connection state. High-churn
typing/presence/user-directory data lives in refs with tick counters.

`useChat()` (throws outside the provider) exposes the full inbox API:
`refreshInbox, loadArchived, loadRequests, loadMoreInbox/Archived, getConvo,
upsertConvo, patchConvo, removeConvo, openDirect(userId), createGroup,
markRead/markUnread, setPinned/setMuted/setArchived/setDisappearing,
deleteConvo, updateChatSettings, accept/decline/blockRequest,
sendTyping(convId, isTyping, activity), typingIn(convId), presenceOf(userId),
watchPresence(ids), watchUsers(ids), userOf(id), enrichAuthor,
subscribe(handler)` (the SSE firehose), `setActiveConversation(id),
takeStageInvite(streamId)`.

**The delta model in practice:** SSE frames carry no counters; the context
applies ±1 locally and **re-seeds the absolute from
`GET /messaging/unread-count` on mount and on every (re)connect** — a
delta-only badge drifts across a disconnect.

Traps an RN port must keep:

- **"Active" = open AND visible** — the web checks `document.visibilityState`;
  map to `AppState`. Counting a backgrounded app as active drops messages from
  the badge and leaves them unread server-side.
- Delivered receipts fire for new messages in **closed** conversations only.
- Chime plays only for someone else's message in a non-active, non-muted
  conversation.
- **Groups >256 members:** `unreadCount` stays 0, `hasUnread` carries the
  signal — `markRead` must re-seed from the server instead of subtracting.
- Disappearing messages: the server substitutes `'👻 Disappearing message'`
  into previews — locally derived previews must do the same.
- Typing throttle: ≤1 start-ping / 3s / conversation, but a *changed* activity
  goes out immediately; stops are never throttled; suppressed entirely when
  typing indicators are off.
- **Chat DTOs carry no avatars** — the built-in user directory resolves
  profiles one `users.profile(id)` at a time (coalesced 40ms, failures cached
  as null). There is no batch-by-ids endpoint.
- On hard SSE close: `api.auth.refresh()` then reopen (8s healing guard).
- Stage invites are consumed on read and die after 10 minutes.

## CallContext (925 lines) — port LAST

Voice/video calls over the same chat socket; the server owns call lifecycle and
blind-relays WebRTC signalling. Mesh topology: one RTCPeerConnection per remote
peer. `useCall()` is safe outside the provider (null-object).

Mechanics that must survive the port to react-native-webrtc:

- **Offer tie-break: `myId < peerId` (string compare) → I offer.** Do not
  replace with "caller offers" — that breaks group calls.
- **startCall on an in-progress call:** the start endpoint returns the ongoing
  call *without joining you* — if `ongoing` and not JOINED, call `accept()`
  or the UI goes active with no audio.
- Glare-free renegotiation (only from `signalingState === 'stable'`, only for
  peers you own); `replaceTrack` for same-kind swaps; ICE candidates arriving
  before remote SDP are queued per-peer; `restartIce()` on failure from the
  offering side.
- One AudioContext for the whole call (per-stream contexts exhaust the ~6
  limit); RMS meters at 12Hz, speaking threshold 0.12.
- Link quality from `getStats()` every 3s — **packet loss is a delta between
  samples** (a cumulative read shows "poor" forever); poor = loss>0.08 or
  rtt>0.6s.
- Every exit path funnels through one `teardown(outcome)` — stops tracks
  (camera light!), commits the call log exactly once.
- Terminal status copy: MISSED → caller "No answer" / callee "Missed call";
  CANCELLED → callee "Missed call", caller silent.
- ICE config from env (`ICE_SERVERS`), fallback Google STUN — ship TURN
  per-deployment.

## Hooks

- **`useRealtime(domain, id, handlers)`** — wraps `openStream`; `id = null`
  means don't subscribe; handlers read through a ref so identity changes don't
  resubscribe. Copies as-is.
- **`useCooldown()`** — the 429 countdown primitive:
  `const [left, start] = useCooldown()`; `start(err)` reads
  `cooldownSecondsFrom` (no-op for non-429) or takes a number. Disable submit
  while `left > 0`, keep the draft, never auto-retry. Pure JS.
- **`useReelAudio({videoRef, trackUrl, voiceUrl, srcKey, muted, onBlocked,
  authored})`** — the three-track reel transport (original in the video, music
  bed, voiceover). **The video is the clock**; music aligns modulo its duration
  (loops as a bed), voiceover aligns absolutely (silent past its end); drift
  correction at 0.3s. Levels come from the author's `#mix=` URL fragment; the
  viewer's only control is master mute — a level of 0 is authored, not a mute.
  RN: rewrite the two `new Audio()` elements on expo-av; keep the clock logic.

## lib/ modules (25)

| Module | What it is | RN note |
|---|---|---|
| `archive.js` | dependency-free ZIP/TAR.GZ builders for exports (RAR impossible client-side) | swap `saveBlob` DOM download for expo-file-system/sharing |
| `chatPrefs.js` | chat cosmetics (theme tint, font scale, wallpaper); presets PORCELAIN `#F2F0F2`-family, SKY, SAGE, PARCHMENT; tint applies to **incoming bubbles only** | rebuild as a theme object; keep `resolveChatPrefs` verbatim; cache key `ika_chat_prefs_cache` |
| `chime.js` | synthesized chime (no asset): notification = G5→C6 bell, message = single E5 tap; 1.2s global throttle | replace WebAudio with a bundled sound via expo-av; keep pref key `ika.notifsound` + throttle |
| `contactHash.js` | contact-matching hashes: email = sha256(lowercase(trim)), phone = sha256(E.164 digits, no `+`); dedup then cap 5000 | expo-crypto; **keep normalization byte-identical** or matching silently fails |
| `desktopNotify.js` | the DESKTOP notification channel (client-delivered); quiet-hours evaluator; `wallClockIn` must emit `…T…​.000Z` (bare 19-char strings 400) | replace with local notifications; **keep `wallClockIn`/`inQuietHours` exactly** |
| `dialCodes.js` | country dial codes (`IQ`/964 default) | pure data, as-is |
| `feedChannelViews.js` | batched channel-post view markers (900ms debounce, ≤100 ids, grouped by channel) | IntersectionObserver → FlatList `onViewableItemsChanged`; keep dedupe/flush |
| `liveRows.js` | the reducer folding `stream.*` frames into live-card lists; **frames patch, never replace; `stream.viewer` never inserts** | pure, as-is |
| `liveWebrtc.js` | WHIP/WHEP publish/watch against MediaMTX (non-trickle ICE ≤1.2s). Traps: pull a decoded video frame **before offering** or the session registers audio-only; stall detection re-acquires the camera via `replaceTrack` so the track set never changes (a changed set splits the recording); H264 preferred; 2.5Mbps/30fps caps | react-native-webrtc; keep every threshold; wake lock → keep-awake |
| `mediaTier.js` | image pre-compression to the upload tier (1080/1440/1920 long edge, JPEG 0.82, EXIF rotation baked, fails open) | canvas → expo-image-manipulator; EXIF baking is load-bearing for phone photos |
| `moderation.js` | author-facing moderation contract: blocked 400 `CONTENT_REJECTED` (keep draft, no retry) vs held (normal 2xx, hidden). Held markers: posts/reels `status:"PENDING_REVIEW"`, stories `moderationStatus`, research publish → 200 with `status:"DRAFT"`; comments/Q&A/chat expose **no marker — never fake a badge**. No realtime moderation event — held items self-re-fetch on the `recheckDelays` schedule | pure, as-is. Note: multipart post-create swallows blocks into `500 {"error":"post_create_failed"}` — the one sanctioned text sniff |
| `openCompose.js` | fire the compose modal from anywhere | appEvents shim |
| `prefs.js` | appearance/accessibility: theme (LIGHT/DARK/SYSTEM live-tracked), density, contrast, reduced motion, font scale (0.92–1.18 × interface scale 0.8–1.4), accent | `Appearance` API + theme context; cache key `ika_prefs_cache`; absent `hapticFeedback` = ON (NON_NULL) |
| `pymkTimer.js` | 3h cooldown for the in-feed "People you may know" strip; backwards clock = due; fails open | storage swap only; key `ika:pymk-shown-at` |
| `qrToken.js` | profile-QR parse/build (`https://<origin>/qr/<token>`, `irc://u/<token>`) | inject the canonical web origin; optionally register `irc://` natively |
| `reelOverlay.js` | reel text/emoji/sticker overlay: part `overlay.json` typed OTHER; coords are fractions of the **media rect** (centre-anchored); closed tables (8 colors, 8 motions, 16 stickers); malformed → drop the whole overlay | re-implement motions with Reanimated; keep ids/limits/`mediaRect` verbatim |
| `richtext.js` | BodyFormat renderer (PLAIN/MD/HTML): marked + DOMPurify with the backend's whitelist; per-block auto-dir | swap to a native HTML renderer + sanitizer; **keep `detectFormat` identical**; prefer the server-rendered `*Html` field |
| `soundMix.js` | reel audio balance rides the URL **fragment** `#mix=orig,music[,voice]` — never reaches the server | pure, as-is |
| `stillClock.js` | photo-reel transport shaped like an HTMLMediaElement (default 30s, loops, ~10 ticks/s) so the whole viewer works unchanged | EventTarget/rAF — verify Hermes, else a tiny emitter |
| `storySeen.js` | per-device ring state: others' rings by newest-frame timestamp (a boolean would darken forever); own ring by `{at, views}` ack — **`views == null` is not zero, never lights the ring** | storage swap; keys `ika:story-seen`, `ika:my-story-ack` |
| `storyTray.js` | assembles the tray client-side — **no backend tray list endpoint**: one page of `following` (≤24 authors) → parallel `byAuthor` reads, fail-open, 60s TTL, coalesced; SSE fold on top | `document.hidden` → AppState; own posts call `invalidateTray()` |
| `useImageRatio.js` | intrinsic image ratio for cover plates | `Image.getSize` |
| `useViewMode.js` | persisted list layout (`feed/grid/compact/grouped`), allowlist-validated | key `ika:view:<page>`; sync read needs boot hydration |
| `userView.js` | author-resolution helpers + the `'Member'` fallback author | pure, as-is |
| `version.js` | `CLIENT_VERSION` for the min-version kill-switch + consent events | wire a real version (device-info / app.json) **or the force-update gate is dead** |

## The complete shim inventory

**Storage keys** (all sync): `ika_token`, `ika_user`, `ika_refresh` (RN),
`ika_prefs_cache`, `ika_chat_prefs_cache`, `ika_media_tier`, `ika.notifsound`,
`ika:pymk-shown-at`, `ika:story-seen`, `ika:my-story-ack`, `ika:view:<page>`,
`ika_mock`.

**App events** (the emitter bus): `ika:auth-expired` · `ika:prefs-changed` ·
`ika:navigate` · `ika:compose`.

**Visibility** (`document.visibilityState` → `AppState`): unread-badge
"active" test, notification gate, story-view polling, wake-lock retake.

**Web APIs used, by module:** WebAudio (chime, call ringer/meters) · WebRTC
(CallContext, liveWebrtc) · canvas/createImageBitmap (mediaTier) · DOM
sanitizing (richtext) · CompressionStream/Blob (archive) · crypto.subtle
(contactHash) · IntersectionObserver (feedChannelViews). Everything else in
lib/ is pure JS and ports verbatim.
# Part VI — Mock Mode

The whole app runs from a ~1 MB fixture (`src/mock/data.json`) with no backend,
in **four languages (en/ar/ku/tr)**. Mock intercepts at `request()` in http.js,
so responses travel the *real* path — same adapters, same error envelopes, same
step-up dance. It is a rehearsal stage, not a diorama.

## Switches

| Thing | Name | Values |
|---|---|---|
| Build flag | `VITE_USE_MOCK` (→ `USE_MOCK` in `platform/env.js`) | `'true'` = default-on; the literal `'never'` strips mock code from the bundle |
| Runtime switch | storage key `ika_mock` | `'on'/'true'` / `'off'/'false'` — **storage wins over the build flag** |
| Language | storage `ika_mock_lang` → env `VITE_MOCK_LANG` → `'en'` | `en · ar · ku · tr`; collapsed **once at load** — changing language needs a reload |
| Fake latency | `VITE_MOCK_DELAY_MS` | default 220ms, so skeletons stay visible |

`mockEnabled()` and `mockLang()` live in `src/mock/flag.js`. **`mockEnabled()`
must stay synchronous** — it's called inline in every SSE guard.

## How it hooks

1. **Boot:** the app entry imports *only* `mock/flag-boot.js` and calls
   `preloadMocks()` — when the flag is off, that's the only mock code that ever
   loads. Never statically import `mock/index.js` or `data.json` from app code;
   the fixture stays out of the critical bundle via two dynamic imports.
2. **Requests:** `tryMock(method, path, opts)` inside `request()` — a route
   match returns the fixture value after the fake delay; **a miss falls through
   to the live network** (a half-built fixture degrades to the real API, not a
   blank screen). A handler throw carrying `__mockStatus`/`__mockBody` is
   rebuilt as a real `ApiError` — including replaying 403 `STEP_UP_REQUIRED`
   through the real step-up prompt.
3. **SSE cannot be intercepted** (EventSource bypasses `request()`), so **every
   EventSource open must start with an `if (mockEnabled())` branch**:
   notifications → scripted replay (3 rows at 4s/13s/22s); chat → cycles the
   fixture's live-chat rows as `stream.chat` frames every 4s (the only source
   of live-chat rows — the real backend never persists them); stories +
   activity → `onError({mock:true})` once, then silent; realtime → silent
   channel + `pushMockEvent(domain, id, evt)` for injecting synthetic events.
   Presigned media PUTs are also not mocked.

## Handlers

`handlers/index.js` composes the route table:
`users → posts → moderation → reels → qna → research → chat → platform → live →
extra`. **First match wins — no fall-through.** Order is load-bearing:
`moderation` sits above `reels` so story creates get screened for markers
before the write; `extra` is last so it can never shadow a domain. posts.js
patterns carry negative lookaheads (`(?!r-\d)` etc.) so reel ids (`r-*`,
`rc-*`, `rr-*`) fall through to reels.js. **Do not renumber the table.**

Coverage: `users.js` (users/social/topics/madhhabs/tags) · `posts.js` (posts,
comments, home feed) · `moderation.js` (marker screening + the whole admin
console; admin fixture lives in-module on `db._moderation`) · `reels.js`
(reels/stories/highlights/sounds/polls) · `qna.js` · `research.js` · `chat.js`
(chat + channels; messages page by cursor, Snowflake ids as strings,
channel-only counters stay `null` outside channels; seed viewer `u-amina`) ·
`platform.js` (notifications/search/activity/settings/security/safety/app) ·
`live.js` (streams/stage/gifts/recording) · `extra.js` (email prefs, last).

Helpers in `util.js`: `page()` (Spring Page shape) · `paging()` (reads
`size ?? limit ?? pageSize`) · `cursorPage()` (`cursor==='head'` = start) ·
`NO_CONTENT` · `mockError(status, code, message)` · `seeded(str)`
(deterministic counts) · `agoIso(minutes)` (the backend's literal-Z timestamp)
· `localize()` (a node is a locale bundle only when *every* key is one of the
four codes). Handlers must return **wire shapes (Java DTOs), never UI shapes**.

## data.json

47 top-level keys — users, follows, posts, feed, reels, stories, highlights,
questions/answers, research (+comments/sources/media), conversations/messages,
channels (+posts), notifications, search, activity, settings, security,
storage, safety, consent, appConfig, policies, live (streams/stages/gifts/
chat), topics/madhhabs/tags, sounds… Every human string is `{en, ar, ku, tr}`;
ids/enums/URLs/timestamps are plain scalars. Handlers mutate `db` in memory —
writes stick until reload. Dev escape hatches: `window.__ikaMockDb`,
`window.__ikaRealtimePush`.

## The magic markers

Type these into any composer wired to a mocked create path
(`handlers/moderation.js`; word-bounded, BLOCK outranks HOLD):

- **`blockme`** → 400 `CONTENT_REJECTED`, nothing saved. **Exception:** the
  *multipart* post path answers `500 {"error":"post_create_failed"}` — the mock
  reproduces the backend's quirk on purpose; it's the only rehearsal for the
  one sanctioned message-sniff in `lib/moderation.js`.
- **`holdme`** → 2xx, content held (author-only visible). Per-surface marker:
  posts/reels `status:'PENDING_REVIEW'` · stories `moderationStatus:'PENDING'`
  (**not** `status`) · research publish → 200 with the row still `DRAFT`,
  self-settling to PUBLISHED after the fake hold · Q&A answers: deliberately
  nothing observable (held answers are byte-identical on the wire).

## RN-port requirements

1. Keep the flag-boot split and the two dynamic imports.
2. `mockEnabled()` stays synchronous → MMKV-backed read; keep keys
   `ika_mock` / `ika_mock_lang`.
3. Map the three `VITE_*` vars through `platform/env.js`; preserve the
   `!== 'never'` build semantics.
4. Metro bundles JSON imports statically — the lazy-load benefit needs dynamic
   require/async asset; budget the ~1 MB parse (that's what `preloadMocks`
   hides).
5. Keep the SSE guard rule verbatim, including the chat live-chat cycling
   replay reaching `onAny` (the live rail depends on it).
6. **FormData sniff:** handlers detect multipart via
   `typeof body.get === 'function'`; RN's FormData has `.getParts()` — polyfill
   or adapt, or every multipart mock path (story create, message upload,
   avatar) silently reads `undefined` and the markers stop firing.
7. Keep date parsing tolerant of the literal-Z `agoIso` shape.
# Part VII — The Bundled Docs & The Trap Compendium

## The 9 guides in mobile-kit/docs/ (3,746 lines)

| Doc | Lines | What it is · when to read it |
|---|---:|---|
| **CHAT_FRONTEND.md** | 1,939 | **The authoritative chat module guide.** Architecture, full endpoint table, 16 numbered invariants ("do not undo these"). Read the invariants section before touching anything chat-shaped. Cites names, not line numbers — grep the name. |
| **MODERATION_FRONTEND.md** | 244 | The client half of the moderation contract. **Explicitly authoritative: where it disagrees with the backend docs, this file is right.** Read before building any composer, badge, or error toast. |
| **ERROR_HANDLING_FRONTEND.md** | 93 | The error-contract implementation map. §6's point: most codes need **nothing** — `errorText` displays the server's message; add client code only for new *flows*. Copy stays server-side. |
| **BACKEND_NOTES.md** | 343 | Cross-module backend defect ledger (P0→P2) with `_workaround:_` markers. Read before trusting Posts/media/feed docs — and never delete a client workaround until its backend item resolves. |
| **BACKEND_LIVE_FINDINGS.md** | 519 | The measured truth for live streaming + MediaMTX (and the Redis record-cache incident). Everything reproduced end-to-end; in practice it outranks the live spec docs where they disagree. |
| **QNA_BACKEND_NOTES.md** | 220 | Q&A backend notes — **all items resolved 2026-05-28; read as the as-built contract** (flat SSE with embedded DTOs + absolute counters + actor suppression; `acceptsNewAnswers` gates the composer). |
| **RESEARCH_BACKEND_NOTES.md** | 176 | Research backend notes — **all resolved; as-built contract** (comment SSE embeds full DTOs; `*_COUNT_UPDATED` are absolutes; `RESEARCH_UPDATED/PUBLISHED/DELETED` are defined but never emitted). |
| **NOTIFICATIONS_BACKEND_NOTES.md** | 77 | Short and glowing: notifications are the platform's reference realtime model (embedded DTOs, absolute `unread-count`, actor suppression, multi-tab fan-out). |
| **EMAIL_VERIFICATION_BACKEND.md** | 135 | A *prescriptive* build plan (mirrors the phone-OTP flow) — verify against the live server before relying on it. |

Facts from these docs a mobile developer hits early:

- **`/api/v1/media/**` ignores HTTP Range** (200 whole-file, no `Accept-Ranges`)
  — the root cause of reel/voice stutter; an RN video player that *requires*
  206 will break. The media endpoint also emits two `Access-Control-Allow-Origin`
  headers.
- **`stream.ended` / `stream.viewer` do not fan out to followers** — a
  follower's live rail can never learn a stream ended; the client runs a 60s
  reconcile. `hostAvatarUrl` is never populated.
- Every recording part has ~1.2s undecodable lead-in and ~2.8s audio-only
  tail; keyframes every 2s — don't build loss-repair. `replaceTrack` on the
  same transceiver does NOT restart the recorder (safe camera repair
  mid-broadcast).
- Live-recording pause = `PATCH {"record": false}` — a path-delete drops the
  broadcast. The recording CHECK-constraint widening was hand-run on the local
  DB only; other environments need the SQL run by hand.
- A held post is invisible to its own author in every list — only
  `GET /posts/{id}` returns it; publish flows navigate to the detail page and
  feeds accept the created post optimistically.
- Some privileged actions are frontend-gated only (best-answer endorse, poll
  voters, `sounds` `autoApprove`) — the RN UI must gate them too.
- `soundId` alone never attaches audio to a post — the composer must also send
  `audioTrackUrl` + `audioTrackName`.

## The trap compendium (the whole guide on one page)

**Identity & auth**

1. Username ≠ email; login sends whatever the user typed as one identifier.
2. 2FA is two-leg: `mfaRequired` *presence* is the branch; `mfaToken` is
   memory-only; `MFA_CODE_INVALID` retryable, the other two terminal.
3. Store the refresh token on RN and send it explicitly — the cookie flow
   dies within the hour and masquerades as a backend bug.
4. `TOKEN_REVOKED` and all `AUTH_REFRESH_TOKEN_*` codes are terminal;
   `_REUSED` gets the "signed out of all devices" copy.

**Wire discipline**

5. Snowflake ids are exact decimal strings — `parseJson` everywhere (SSE
   frames included), `cmpId` for order, never arithmetic.
6. Branch on `err.code`, never message text (exceptions: the multipart-500
   sniff in `isBlocked()`, the three moderation SYSTEM_MESSAGE titles).
7. Arrays go on the wire as repeated params, never comma-joined.
8. Never auto-retry 429 — countdown + kept draft (`useCooldown`).
9. Backend media URLs are relative — `assetUrl()` everything; Bearer media
   needs `{uri, headers}` on native.
10. Timestamps carry a literal bolted-on `Z` on zoneless LocalDateTime.
11. Jackson NON_NULL: absent key === null — parse defensively everywhere.

**Per-module dialects**

12. "The text field": posts `text` · research `content` · Q&A `body`.
13. Views: posts/stories `/views` · research `/view` · reels `/reels/view`
    (session only — bump views via `posts.recordView`).
14. Reactions: posts empty-body toggle `/reactions` · research
    `{reactionType}` `/reactions` · Q&A `{reactionType}` `/react`.
15. On `/posts/feed`, `limit` beats `pageSize` (pageSize is never read);
    `/feed/home` takes only `pageSize`.
16. Search cursor mode is *entered* with `cursor=head`; trust only
    `nextCursor` — or "load more" re-appends page 0.
17. Never re-sort on `rankScore`; never read Follow state from list rows —
    `socialStatus` is the truth.
18. Specializations and channel `settings` are replace-all writes; admin
    rights `{}` = full rights — send every flag explicit.
19. Cosmetic settings: PATCH, never PUT (PUT nulls omissions); DND PUT needs
    explicit `enabled`; muted/privacy-list reads are bare UUID arrays.
20. `DELETE /conversations/{id}` is four operations behind one call — use
    intent helpers; on a channel, owner = destroy-for-everyone.
21. Invite plaintext tokens appear exactly once (on create); join responses
    with `PENDING_APPROVAL` carry a null conversation — that's success.
22. Channel stories/highlights are removed — those routes 404.
23. Taxonomy dev DB has zero rows and no write API — curl before debugging.

**Realtime**

24. 5 SSE connections per user (LRU-evicted) — share sockets; rebuild URLs
    on every connect; watchdogs 60s/60s/45s; close before reconnect.
25. Deltas not absolutes (chat/posts) vs embedded-DTO absolutes
    (QnA/research/notifications) — know which model each stream uses.
26. Actor-skip is server-side — optimistic ±1 is safe.
27. `FEED_NEW_POST` is a named event, not an inbox row; notification badge is
    only ever SET from `unread-count`.
28. Story poll tallies are absolutes (the delta-model exception); the tray
    stream path constant is unconfirmed.
29. Every EventSource needs the `mockEnabled()` guard.
30. Q&A SSE echoes your own actions — dedupe adds by id.

**Media & content**

31. The presigned PUT is foreign-origin: no Authorization header; matching
    Content-Type; stream from disk.
32. sha256 is optional (dedup only); size-check before hashing; >64 MB skips
    the digest.
33. Reels are posts (`postType=REEL`); overlay = `overlay.json` typed OTHER;
    mix rides the URL fragment; still reels are 30s by convention.
34. Voice notes: AUDIO/FILE→VOICE normalization; backend drops
    durationMs/waveform today.
35. Research cover part name is exactly `image` and role-gated (403 for
    USER); Q&A MEDIA_FILE sources are a two-step create-then-upload.
36. Held-content markers differ per surface (posts `PENDING_REVIEW`, stories
    `moderationStatus`, research 200-but-DRAFT) and several surfaces have
    none — never fake a badge; no realtime moderation event exists.

**Design**

37. `--gold` is a dark blue — never pair legacy navy/gold/rubric/emerald
    tokens as bg+ink; port only `--ox-*`.
38. Tabs are pills (active = navy fill + off-white text); the compose [+] is
    a rounded rect; stories are thumbnail cards.
39. Text on Oxford-Blue plates is `#F2F0F0`, not pure white; cerulean CTAs
    are dark-surface-only.
40. Dark mode: headings become Sky, buttons stay dark, hover lightens; the
    sacred content colors never flip.
41. RTL is per-content-block (no global flip); no drop caps in RTL; wrap
    words, never break-anywhere.
