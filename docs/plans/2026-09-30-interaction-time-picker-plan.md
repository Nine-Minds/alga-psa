# Interaction Start/End time picker — implementation plan (alga-2026-0002591)

Customer: RightPath Consulting (Eric Pfeifer). Ticket alga-2026-0002591, Critical.
Symptom: in the Add Interaction dialog the time half of the Start/End `DateTimePicker`
"does not accept anything else than the first entry in the list 12:00am"; the date half
works.

## Where
- `packages/clients/src/components/interactions/QuickAddInteraction.tsx` — Start Time
  picker :1293 (no `minDate`), End Time :1312 (`minDate={startTime}`), handlers
  `handleStartTimeChange` :602 and `handleEndTimeChange` :634. The dialog renders inside
  `Dialog`/`DialogContent` (:964).
- `packages/ui/src/components/DateTimePicker.tsx` → `DateTimeField.tsx` (variant
  `datetime`), helpers in `packages/ui/src/lib/dateTimeInput.ts`.

## Investigation result (Design Session, XO)
Read all four files end-to-end and ran a focused vitest reproduction in
`packages/ui/src/components`:

- `DateTimeField variant="datetime"`, `timeFormat="12h"`, value initially `undefined`:
  focus the date half, click **Today**, then click the `2:00 PM` rail option →
  `onChange` is called with `2026-9-29 00:00` (day) then `2026-9-29 14:00` (time). The
  picked time **is** committed.
- Same with a controlled parent (`value` mirrored from `onChange`) and with
  `minDate` set to a later-than-midnight date: the committed time is still `14:00`.
  The rail (`buildTimeOptions`) contains all 96 quarter-hour rows and the selected row
  tracks the value.

Conclusion: the shared picker's commit path is **correct on current main** for the
date→time flow. The reported defect is therefore in the **Add Interaction dialog
integration**, not in the shared commit math. (jsdom cannot reproduce Radix
Dialog+Popover focus/pointer behaviour, so the failing layer must be confirmed live.)

## Reproduction to confirm (do this first, live)
1. Add Interaction on a ticket/client in a US tenant (12h). Pick a date, then pick any
   non-midnight time on both Start and End. Try clicking a rail row and typing a time.
2. If it reproduces, instrument: log `onChange` payloads from each picker and watch
   `startTime`/`endTime` in QuickAddInteraction; check whether the dialog closes/resets
   the picker on the rail click.

### Hypotheses, most likely first
- **H1 (most likely):** the Popover rail/calendar is portalled from inside the Radix
  `Dialog`; the dialog's focus/pointer handling (or the field's `onInteractOutside`
  guard, which only protects `fieldsRef` — the two inputs — not the calendar/rail) makes
  the rail click land as an outside interaction, so the panel closes and the value keeps
  the day's midnight. Confirms by the rail click doing nothing but closing.
- **H2:** a QuickAddInteraction effect re-seeds `startTime` around the commit — e.g. the
  "set start time to now" branch at :441 (`isOpen && !startTime && !isEditMode`) firing
  on a render where `startTime` is transiently undefined, or the schedule/duration
  effects (:483, :174) — overwriting the picked time with a fresh `new Date()`.
- **H3:** 12h display/parse round-trip on the tenant's country format.
- **H4:** the time survives the UI but the save path (`handleSubmit`, :738+) drops it.

## Fix strategy
Fix at the layer the live repro shows failing; prefer the source, not a
`QuickAddInteraction` workaround (per the card).
- If H1: make the picker's panel interaction self-contained — include the panel body in
  the `onInteractOutside`/`onFocusOutside` guard (or render it so the Dialog does not
  treat it as outside), and/or ensure a rail/calendar pointerdown does not blur the field
  into a close. Keep the "day click keeps the panel" contract.
- If H2: scope the seeding effect to the open transition only (not re-run while the
  dialog is open) and make `handleStartTimeChange` never overwrite a value it just set.
- If H3/H4: fix the format or the submit mapping respectively.
Regardless: the most recent explicit user selection (rail click or typed time) must be
authoritative and not clobbered by a later blur/effect commit.

## Tests
1. **Shared regression** — `packages/ui/src/components/DateTimeField.test.tsx`: for
   `datetime`, after picking a day, select a non-midnight time in both `12h` and `24h`,
   and with `minDate` set; assert the committed `Date`'s hours/minutes and that the time
   input shows the pick. Strengthen the existing `keeps the panel for the time half…`
   test (:216) — it currently asserts only that the panel closed, so it would not catch a
   wrong commit value.
2. **Dialog/integration** — extend `QuickAddInteraction.scheduling.test.tsx` (or add a
   sibling): mount the dialog, pick a non-midnight start and end, assert the saved
   `start_time`/`end_time` equal the picks and that the created schedule entry carries
   them.
3. **Typed time** after a day pick commits the typed value.

## Acceptance
- In the dialog, Start and End accept any quarter-hour and typed times.
- Saved interactions and their schedule entries carry those times.
- The shared picker's other consumers (schedule entry, ticket due date, time entry) are
  unaffected, or fixed the same way.

## Out of scope
Unrelated quote/optional-items work.

## Evidence
Focused vitest repro run (deleted after use) produced:
`onChange calls [ '2026-9-29 0:00', '2026-9-29 14:00' ]` for the 12h / undefined-initial
flow; controlled-parent and `minDate` variants committed `14:00` under assertion.
