# Design

## Source Of Truth

The approved visual references live under:

`tmp/interface-redesign-20260619/review/`

Canonical files:

- `Media2Text.dc.html` for desktop.
- `Media2Text Mobile.dc.html` for mobile.
- `Media2Text Foldable.dc.html` for foldable/master-detail behavior.
- `HANDOFF.md` for the implementation contract.

If this document conflicts with the `.dc.html` files, the `.dc.html` files win.

## Visual Direction

Media2Text uses a restrained, terminal-adjacent operator-console aesthetic:
flat surfaces, hairline borders, compact tables, IBM Plex Sans for UI copy, IBM
Plex Mono for IDs/data/badges/timestamps, and almost-square geometry.

## Tokens

Dark theme is default:

- `--bg`: `#0B0C0D`
- `--panel`: `#141518`
- `--panel2`: `#0F1012`
- `--border`: `#24262C`
- `--hair`: `#1B1D22`
- `--text`: `#E7E8EA`
- `--dim`: `#8B8E95`
- `--faint`: `#5C5F66`
- `--accent`: `#3FB950`
- `--accent-fg`: `#06140A`
- `--accent-bg`: `#15301D`
- `--accent-bd`: `#235C33`
- `--input`: `#08090A`
- `--warn`: `#E0884A`
- `--warn-bg`: `#2A1C0E`
- `--warn-bd`: `#5C3F1C`
- `--err`: `#E5675B`

Light theme mirrors the handoff tokens and is available through root CSS
variables.

## Components

- Radius: 3px for panels, cards, fields, and badges. Buttons and chips stay
  square.
- Borders: 1px solid token borders. No decorative shadows except overlays.
- Badges: mono, uppercase, compact, status-specific color.
- Tables: dense rows with mono headers and hairline separators.
- Navigation: desktop left sidebar; mobile bottom tab bar; foldable uses denser
  master-detail panels.

## Roadmap Visibility

Use these labels consistently:

- `LIVE`: backed by current API/runtime behavior.
- `PARCIAL`: backend exists but is incomplete for the visible promise.
- `ESTIMADO`: displayed number is derived or placeholder, not an authoritative
  backend metric.
- `TODAVIA NO IMPLEMENTADO`: visible future capability with no current backend
  contract.

Never show demo numbers without one of these labels when the data is not real.
