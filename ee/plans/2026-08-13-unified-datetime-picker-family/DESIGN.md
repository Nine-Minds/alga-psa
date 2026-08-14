# One picker family — split pair, one shared panel

**Approved option: E3.** Two typeable fields; focusing either one opens a *single* panel that spans
the pair — calendar on the left, 15-minute rail on the right. Date-only drops the rail. Time-only
drops the calendar. Same field, same panel, same exit contract, three configurations.

Implemented in `packages/ui/src/components/DateTimeField.tsx` with the parsing rules in
`packages/ui/src/lib/dateTimeInput.ts`. `DatePicker`, `DateTimePicker` and `TimePicker` are thin
wrappers pinned to a variant, so every consumer moved with them.

---

## 1 · Why this shape

The control that was there — a month grid plus two tall scrolling number lanes — was not wrong so
much as unchosen. E3 keeps the one thing about it that is genuinely good, the calendar-left /
time-right silhouette every existing user already reads at a glance, and replaces the mechanics
underneath:

- the two 24-row / 60-row lanes become **one 15-minute rail**;
- the trigger buttons become **text inputs you can type into at any moment, including while the
  panel is open**;
- the panel becomes an **assist**, not a required stop — every value is reachable from the keyboard
  without opening it.

The cost, accepted knowingly: the panel is more surface to dismiss than a bare dropdown. It is paid
for by close-on-time-pick, a footer that states the exit in words, and the fact that setting a date
*and* a time — the dispatch norm — takes one open-close cycle instead of two.

## 2 · Anatomy

**The field** is an input, and is specced like one (`Input.tsx`): 36 px tall, `--radius-lg`,
`border-200`, `shadow-sm`, trailing `Calendar`/`Clock` icon, `✕` when `clearable` and filled.

**The focus rule is the "no double borders" fix.** Every picker used to focus with
`ring-2 ring-offset-2`, which paints the ring *outside* the border and leaves a white gap between
them — border, gap, ring, three edges. The family focuses the way `Input.tsx` always has: the border
goes transparent and the ring replaces it. One edge.

**The panel** is a single popover: calendar pane, rail pane, footer. Date-only renders the calendar,
time-only the rail, date+time both. Container on `--color-card` with `border-200`, radius 12; the
rail sits on `border-50` behind a `border-100` divider; selected rail row is `primary-700` on
`primary-100`.

## 3 · The rail — precision without 60 rows

```
rows = every quarter hour 00:00 … 23:45              // 96 rows, fixed
     ∪ { the value in play }                          // 0 or 1 extra row, inserted in order
```

- The extra row appears only when the value is not already on a quarter. `14:35` renders between
  `14:30` and `14:45`, carrying a 2 px accent bar so it reads as *your* minute.
- The rail centres on the value when it opens and **re-scrolls live while you type**.
- Scrolling commits nothing; hovering commits nothing. Only a click, `Enter`, or a blur whose text
  parses writes a value.
- 12-hour locales render `2:35 PM` in the row itself — no separate meridiem column to aim at.

**Precision guarantee:** the family never rounds, snaps or truncates a minute. `:35` and `:37` stay
reachable by typing, by `Shift`+`↑`/`↓` (±5 min) and by clicking their inserted row. Timesheet values
reach invoices; a silent snap would be a billing defect, not a UX regression.

## 4 · The exit contract

| Variant | Footer text | Day click | Time click |
|---|---|---|---|
| date + time | *Pick a day to keep going, pick a time to save and close* | selects, **stays open**, focus moves to the time field | commits, **closes** |
| date only | *Pick a day to save and close* | commits, **closes** | — |
| time only | *Pick a time to save and close* | — | commits, **closes** |

Always available: the **✕** in the footer, **`Esc`**, and **click-outside**. Dismissal is never a
discard — all three keep whatever the fields currently say.

## 5 · Typing

**Time** reuses the parser that two surfaces used to opt into via `allowManualInput`: `1435`,
`14:35`, `14.35`, `235p`, `2:35 pm`, `9a` all land; `25:00` does not. It is now the default in every
time field, which also deletes the fork where `allowManualInput` selected between two whole render
branches with two different chromes.

**Date** is new and deliberately small — locale-ordered numbers with `/ . -` or no separator at all
(`13/8`, `13/08/26`, `130826`), `today`/`tomorrow`/`yesterday`, and signed day offsets (`-1`, `+7`).
`31/02/2026` is rejected rather than rolled forward to 03/03. Field order and the placeholder come
from `Intl.DateTimeFormat` for the active locale.

While typing, the field holds raw text and is never rewritten under the caret; each keystroke
re-parses and steers the panel. On blur or `Enter` the text is normalised and committed. Text that
does not parse marks the field invalid and **keeps the previous value** — a bad guess never becomes a
date, and never becomes empty.

## 6 · Keyboard

| Key | Effect |
|---|---|
| `Tab` in | focuses, selects all, opens the panel |
| `Enter` | commits and closes |
| `Esc` | closes, keeps the text, keeps focus |
| `↑` `↓` | date: ∓1 day · time: ∓1 quarter hour |
| `Shift`+`↑` `↓` | time: ∓5 minutes |
| `PgUp` `PgDn` | date: ∓1 month · with `Shift`: ∓1 year |
| `Backspace` | clears, when `clearable` and the whole field is selected |

A keyboard user fills both halves and tabs away without ever looking at the panel.

## 7 · Locale and i18n

Date format, first day of week and month names come from the active locale; 12h vs 24h from
`localeUses12HourClock`, with `timeFormat` still the per-caller override. Every string in the chrome
now goes through `t()` (`datePicker.*`, `timePicker.*`, `dateTimePicker.*`) with the English wording
as the fallback, replacing the hardcoded `Hour` / `Minute` / `Period` / `Today` that used to sit
inside fully translated dialogs. Adding the keys to the seven locale files is the follow-up; until
then the fallback renders exactly what shipped before.

## 8 · API

```ts
variant: 'date' | 'time' | 'datetime'
value:   Date | 'HH:mm'
```

plus `clearable`, `minDate`, `maxDate`, `timeFormat`, `minuteStep` (rail granularity only — exact
values always survive), `displayFormat`, `disabled`, `required`, `id`, `label`, `placeholder`.

`DateRangePicker` stays a composition of two date fields. `allowManualInput` is a no-op with a
deprecation note: typing is no longer a privilege.

## 9 · Coverage, and the three fields that stay native

Every date, time and date+time field in the product renders the family. That includes the three
schema-driven workflow forms (simulate an event, schedule a workflow, start a run), which used to
render `date` / `date-time` properties as browser controls and now go through `DatePicker` /
`DateTimePicker` bridged by `dateInput.ts`.

Three fields are deliberately **not** migrated. They are named here so the gap is a decision on the
record rather than something to rediscover:

| Where | What | Why it stays |
|---|---|---|
| `ee/extensions/softwareone-ext/.../StatementsList.tsx` | 2 × `<input type="date">` period filter | Sandboxed extension |
| `ee/extensions/nineminds-reporting/src/iframe/main.tsx` | 2 × `datetime-local`, share link window | Sandboxed extension |
| `packages/reporting/.../DeferredRevenueReport.tsx` | 1 × `<input type="month">` | No month variant |

**The two extensions** are separate bundles with their own dependency closures and their own build
pipelines — `softwareone-ext` builds through its own Vite lib config against `@alga/ui-kit`,
`nineminds-reporting` builds its UI the same way against `@alga-psa/ui-kit` and its backend into a
WASM component via `jco`. Neither has `@alga-psa/ui` in its graph, and neither renders inside the
host's React tree: they run in an iframe, without the host's i18n provider or token scope. Migrating
them is not a call-site swap — it means either vendoring the family into each extension bundle or
promoting it across the `ui-kit` boundary as a supported, versioned surface. That is its own card,
with its own API-stability question, and it should be answered deliberately rather than smuggled in
here. (One piece of debris was cleared: `StatementsList` carried an unused
`import { DatePicker } from 'server/src/components/ui/DatePicker'` — a path that does not exist and
a component it never rendered.)

**The deferred-revenue filter** picks a *month*, and holds `yyyy-MM`. The family picks days and
minutes; it has no month variant, and inventing one to absorb a single filter would add a fourth
configuration for one caller. If a second month field ever appears, that is the moment to add it.

## 10 · What would change my mind

- **If dispatch turns out not to be the common case.** E3's advantage is one open-close cycle for
  both halves; most consumers are date-only, so if instrumentation shows few date+time edits, a
  smaller per-field dropdown wins on surface area.
- **If anchoring proves as bad as feared** in narrow dialogs and drawers — if the stacked fallback
  fires more often than not, the two-pane silhouette is a fiction.
- **Nothing about precision.** No amount of elegance buys a design that rounds minutes.
