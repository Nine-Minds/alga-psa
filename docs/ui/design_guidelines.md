# UI Design Guidelines

Density, typography, and composition rules for Alga PSA product surfaces. The
canonical reference implementation is the ticket "Grid" (bento) layout —
`packages/tickets/src/components/ticket/bento/` — which established this
language; new panels, tiles, and cards should match it. Color/token rules live
in [theming.md](./theming.md); this document covers how type, spacing, and
structure use those tokens.

## Principles

1. **One surface, one density.** A card ("tile") is a compact, self-contained
   unit: `p-4` padding, small type, quiet meta text. Don't mix full-page
   density (`p-6`, `text-xl` headings) into tile contexts.
2. **Tokens only.** All colors via `rgb(var(--color-*))` or semantic Tailwind
   tokens (see theming.md). No raw hex, no `text-gray-*` in new code.
3. **Truncate, never overflow.** Every flex row that carries text needs
   `min-w-0` + `truncate` on the text and `flex-shrink-0` on badges/meta.
   Horizontal scrolling inside a card is a defect.
4. **Fail visible.** Loading = pulse skeleton; error = red boxed message;
   empty = quiet sentence with an action. Never a blank card.

## Typography scale

| Role | Classes | Example |
|---|---|---|
| Page/hero title | `text-lg font-bold text-[rgb(var(--color-text-900))]` | Ticket title in the hero band |
| Tile/card title | `text-sm font-semibold text-[rgb(var(--color-text-800))] truncate` + leading `h-4 w-4` icon in `text-[rgb(var(--color-primary-500))]` | "Documents", "Next visit" |
| Eyebrow / section label | `text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-400))]` | "Tracked intervals" |
| Row subject | `text-sm font-medium text-[rgb(var(--color-text-800))] truncate` | Schedule entry title |
| Row body | `text-sm text-[rgb(var(--color-text-700))] truncate` | Document name, interaction title |
| Meta / secondary | `text-xs text-[rgb(var(--color-text-500))]` (or `-400` for the quietest tier, right-aligned via `ml-auto flex-shrink-0`) | Dates, file sizes, "· done" |
| Empty state | `text-sm text-[rgb(var(--color-text-400))]` | "Nothing scheduled" |
| Inline action / link | `text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline`, optional `h-3 w-3` icon | "View all 7", "+ Schedule a visit" |
| Chip / pill | `text-[10px] font-semibold rounded-full bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))] px-2 py-0.5` | Board name chip, timeline event kind |
| Micro badge | `text-[9px] font-semibold tracking-wide` in a bordered `rounded` box (`border-border-200`, `bg-border-50`) | "PDF" / "DOC" extension badges |
| Timer / duration numerals | `font-mono text-xl text-[rgb(var(--color-text-900))]` on a `rounded-md bg-[rgb(var(--color-border-100))] px-3 py-2` field | `00:02:48` session timer |

Notes:
- Two meta tiers exist on purpose: `text-500` for labels the user reads,
  `text-400` for glance-only metadata and empty states.
- All-caps only at the eyebrow size (`text-[10px]` + `tracking-wider`/`wide`).
  Never uppercase `text-sm` or larger.
- Monospace is reserved for time/duration/ID numerals, so they align and don't
  jiggle while ticking. Use the mono field style above rather than ad-hoc
  `<code>` styling.

## Composition patterns

**Tile surface** (see `BentoTile.tsx`):
`rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4 flex flex-col min-w-0`.
Header = icon + title + optional right-edge action slot (`ml-auto`), `mb-2`.

**Header action slot.** Exactly one compact control: a count chip, a
`h-6 w-6 p-0` ghost icon button (`＋`), or a "View all" text link. Full-size
buttons ("New Document", "Upload File") never live in a tile header — put the
rich management UI in a `Dialog` opened from the slot (see
`DocumentsTile.tsx`).

**Label/value rows** (see `BillingTile`):
```tsx
<div className="flex justify-between">
  <span className="text-[rgb(var(--color-text-500))]">Logged</span>
  <span className="font-medium text-[rgb(var(--color-text-800))]">2h 15m</span>
</div>
```
Stack with `space-y-1.5`, `text-sm` on the container.

**Item lists** (see `CallsEmailsTile`, `DocumentsTile`):
`ul.divide-y divide-[rgb(var(--color-border-100))]`, rows
`py-1.5 first:pt-0 last:pb-0 flex items-center gap-2`. Subject truncates;
meta hugs the right edge. Cap visible rows (~5) and add a "View all N" link
instead of scrolling.

**Date chip** (see `ScheduleRow`): `w-10` block, month in
`text-[10px] font-semibold uppercase tracking-wide text-primary-500`, day in
`text-base font-semibold text-primary-600` on a `bg-primary-50` rounded box
(dark: `bg-[rgb(var(--color-primary-400)/0.15)]`, day `text-primary-300`).

**Loading**: `animate-pulse bg-[rgb(var(--color-border-100))] h-16 rounded-md`.

**Error**: bordered box — `border-red-200 dark:border-red-800 bg-red-50
dark:bg-red-900/20 text-sm text-red-800 dark:text-red-300` — showing the
message, in place of the body.

**Density switching.** Components shared between full-page and tile contexts
read `useContentCardVariant()` (`'default' | 'bento'`) from
`ContentCardVariantProvider` rather than taking ad-hoc size props. When a
component can't reasonably compress (e.g. the documents manager), build a
compact tile representation and open the full component in a `Dialog`.

## Voice and microcopy

- Sentence case everywhere: "Customer feedback", "Team and watchers",
  "Time logged" — not Title Case.
- Empty states are short human sentences with a next step: "Nothing scheduled"
  + "Schedule a visit"; "No documents yet" + "Add a document"; "Nothing yet.
  The ticket was opened {date}."
- Prefer product terms over cleverness: "Documents" not "Files",
  "Waiting on us" / "Waiting on client" for response state.
- Separate inline facts with a middle dot (`·`): `1.2 MB`, `Jul 4 · done`,
  `2h · 1h 30m billable`.

## Checklist for a new tile/panel

- [ ] Uses `BentoTile` (or matches its surface exactly) with `p-4`, `min-w-0`
- [ ] Title `text-sm font-semibold`, `h-4 w-4` primary icon
- [ ] Body type from the scale above — nothing larger than `text-sm` except
      hero numerals/timers
- [ ] Meta right-aligned, `text-xs`, `flex-shrink-0`
- [ ] Truncation-safe at 280–320px tile width (right-rail span)
- [ ] Loading skeleton, visible error state, empty state with action
- [ ] One compact header action max; heavy flows go to a Dialog
- [ ] Both themes verified (see theming.md)
