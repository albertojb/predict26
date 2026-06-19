# Predict26 UX Fixes — Deployment Summary
**Date:** 2026-06-19 (rev. 2)
**Status:** Deployed to https://sail.zo.space/predict26

## Round 1 (earlier today) — what failed

First attempt tried to keep the card-grid bracket and add a "→ M045" flow indicator at the bottom of each card. User feedback: "the knockout is still just a collection of boxes" — the textual flow hints were not enough, the card metaphor itself was the problem. Also, the LogRow grid switch to `minmax(120px, 1fr)` made the inner grid wider than the outer card at the 300px breakpoint, so team names overflowed into adjacent cards (see screenshot evidence).

## Round 2 — what shipped

### Bracket: card grid → tree
**Verdict:** Replaced the metaphor entirely.

- Horizontal tree, R32 on the left, Final on the right
- 16 R32 matches stacked vertically; each subsequent round halves the row count, with each card positioned at the y-midpoint of its two feeders
- SVG connectors draw orthogonal feeder→successor lines, never crossing (R32 ordering is derived by recursing from the Final, so adjacency is correct by construction)
- Wrapped in `overflow: auto` with `maxHeight: 75vh` — pans horizontally and vertically
- Zoom controls (30%–200% in 10% steps, plus 1× and Fit) via `transform: scale()` with `transformOrigin: top left`; outer wrapper width/height scaled to match so scrollbars track the visible content
- Round headers ("Round of 32", "Round of 16", "Quarter-final", "Semi-final", "Final") sit above each column
- Third-place play-off is shown separately below the main tree (it doesn't belong on the winners' tree)
- Match cards are compact (200×64): M-number + date in a tiny mono header, two slot rows below with team name + ELO-projected champ% (when sim has been run)
- Team-name ellipsis with `title` attribute fallback so the full name is one hover away

### LogRow: stop the overflow
- Inner grid: `minmax(0, 1fr) 52px auto 52px minmax(0, 1fr)` — the `0` floor lets columns shrink as far as needed, and `text-overflow: ellipsis` handles long names cleanly instead of letting them spill out of the card
- Card itself: `overflow: hidden; minWidth: 0` so children stay contained
- Team-name cells get `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` plus `title` attribute for hover-disclosure of the full name
- Outer card grid widened from `minmax(300px, 1fr)` to `minmax(340px, 1fr)` for more breathing room

## Files touched

- `web/routes/page-predict26.tsx`
  - `LogRow` (lines ~1134–1245): grid + ellipsis + `title` attributes
  - `LogTab` outer grid: `minmax(340px, 1fr)`
  - `BracketTab` (lines ~1357–1568): completely rewritten as tree view with zoom/scroll
  - New helpers: `BracketMatchCard`, `BracketSlot`, `zoomBtnStyle`, plus `BRACKET_STAGES`/`CARD_W`/`CARD_H`/`ROW_GAP`/`COL_GAP`/`BRACKET_PAD` constants
  - Removed: `SlotRow` (replaced by `BracketSlot`); removed the `bracketTree` useMemo (replaced by `positions` + `connectors` computed from feeder graph)
- `AGENTS.md` — updated "Recent UX improvements" section

## Verification
- ✓ Git commit pushed to `main`
- ✓ Route synced to zo.space via `write_space_route` (28 routes synced)
- ✓ Live at https://sail.zo.space/predict26

## Next steps
- Confirm with user that the tree renders correctly across rounds and zoom levels
- Consider: a "Fit to screen" computation that picks zoom based on container width
- Consider: keyboard pan (arrow keys) and ctrl/cmd-scroll-to-zoom

---
*Designed in response to user feedback; documented for future Claude sessions.*
