# Manual Smoke Pass — Ticket Close Rules

Run this after implementation, before merge. It replaces the Playwright/UI
entries trimmed from `tests.json` (board settings dialog, templates settings,
checklist section, blocked-close dialog, override flow, bulk summary,
auto-close banner, timeline rendering, job wiring, i18n) — automated coverage
owns the logic; this pass owns the screens and the end-to-end business
outcomes.

> Steps below are derived from the plan and the existing screens it extends,
> not from a running build of the feature. Exact button/label copy may drift
> during implementation — treat the live screens as ground truth and update
> this file when they disagree.

## Preflight

- Dev stack up for this worktree (alga-env-manager), logged in as an **Admin**
  and a second **technician user without** `ticket:close_override`.
- A test board with open statuses and a closed status; a client with a
  contact that has portal access; a way to see outbound email (e.g. the dev
  mail catcher).
- For the auto-close flows: a rule with small `inactivity_days`, and either
  wait out a 15-minute scan cycle or trigger the `auto-close-tickets` job
  manually; backdate the ticket's last comment in the DB to make it stale.

## Risks this smoke is defending

1. **Stranded revenue** — tickets close with no time logged.
2. **Accountability theater** — checklist signoff doesn't durably record who/when.
3. **Rules theater** — bulk close or an unauthorized override smuggles tickets past enabled gates, or an override leaves no audit trail.
4. **Auto-close kills a live conversation** — the customer replies and the ticket closes anyway.
5. **Silent auto-close divergence** — auto-closed tickets skip the side effects manual closes get (customer email, automatic comment, audit attribution), or the engine never fires and stale tickets pile up unnoticed.
6. **Audit-history mutation** — editing a template rewrites checklists already signed off on tickets.
7. **Cross-board bleed** — one board's gates or auto-applied templates leak onto another board's tickets.

## Flows

### Flow 1 — stranded revenue: the time-entry gate blocks, then yields (risks 1, 3)

1. Settings → Ticketing → Boards → edit the test board → Close Rules section:
   enable the time-entry and resolution-comment gates. Save, reopen the
   dialog, confirm the toggles persisted.
2. Open a ticket on that board with no time logged → set status to the closed
   status.
3. **Expect:** closure is refused; the blocked-close dialog lists *both* unmet
   conditions (not just the first).
4. Use the dialog's quick actions: add a time entry and a resolution comment.
5. Close again. **Expect:** ticket closes; the client contact receives the
   normal ticket-closed email.

### Flow 2 — accountability is durable and visible (risk 2)

1. On a ticket, add two checklist items (one required, one optional) as the
   technician user; check the required item.
2. **Expect:** the item immediately shows the technician's name and timestamp
   inline, and the progress chip near the status control reads "1 of 1
   required done".
3. As the Admin, uncheck the item. **Expect:** the inline signoff clears, and
   the activity timeline shows both the original check (by the technician)
   and the uncheck (by the Admin) with the prior signoff preserved in the
   entry.

### Flow 3 — overrides are permissioned and leave a trail (risk 3)

1. As the technician (no `ticket:close_override`), attempt to close a gated
   ticket with unmet conditions. **Expect:** the dialog shows the failures and
   offers **no** "Close anyway" control.
2. As the Admin, repeat. **Expect:** "Close anyway" appears; provide a reason
   and confirm.
3. **Expect:** the ticket closes and the activity timeline shows an override
   entry listing the skipped conditions and the reason.

### Flow 4 — bulk close can't smuggle tickets past gates (risk 3)

1. From the ticket list, select one ticket that satisfies the gates and one
   that doesn't; bulk-set both to the closed status.
2. **Expect:** a summary like "1 closed, 1 blocked by close rules" with the
   blocked ticket's reasons; the blocked ticket is still open afterward.

### Flow 5 — auto-close never kills a live conversation (risk 4)

1. Configure an auto-close rule (trigger status, short inactivity, 1-day
   warning) on the board; put a stale ticket in the trigger status and let
   the scan run.
2. **Expect:** the ticket shows the banner "Will close automatically on
   <date> unless there's new activity", and the contact receives the warning
   email once (not again on the next scan).
3. Reply as the customer from the client portal.
4. **Expect:** after the next scan, the banner is gone and the ticket does
   not close at the originally scheduled time.

### Flow 6 — an auto-close is a real close (risk 5)

1. Let a stale ticket pass its scheduled close time and let the scan run.
2. **Expect:** the ticket is in the rule's target closed status with an
   automatic comment ("Closed automatically after N days of inactivity"); the
   contact receives the standard ticket-closed email; the activity timeline
   attributes the closure to the system (no human user); if the board had
   gates enabled, a bypass entry (source: auto-close) appears rather than a
   gate failure.

### Flow 7 — template edits don't rewrite signed history (risks 6, 2)

1. Settings → Ticketing → Checklist Templates: create a template with two
   ordered required items; apply it to a ticket; check both items.
2. Back in settings, rename one template item, delete the other, and add a
   third.
3. **Expect:** the ticket's checklist is byte-for-byte unchanged — original
   names, order, and signoffs intact. Re-applying the same template to the
   same ticket adds nothing (idempotent).

### Flow 8 — rules and templates stay on their board (risk 7)

1. With gates, an auto-close rule, and a board-scoped auto-apply rule all
   configured on Board A only: create a ticket on Board B in the same
   category.
2. **Expect:** the Board B ticket gets no auto-applied checklist, closes
   freely with no gate dialog, and never grows an auto-close banner.
3. Move the Board B ticket to Board A. **Expect:** the matching template
   attaches now (once), and closure is now gated.

## Pass criteria

- No ticket can be closed by hand past an enabled time-entry/comment gate
  without satisfying it or leaving an audited override (risks 1, 3 — Flows 1,
  3, 4).
- Every checklist signoff and its removal is attributable on the ticket
  forever (risk 2 — Flows 2, 7).
- A replying customer is never auto-closed on, and a fired auto-close is
  indistinguishable from a careful manual close in side effects and audit
  (risks 4, 5 — Flows 5, 6).
- Template maintenance can't alter past signoffs (risk 6 — Flow 7).
- Nothing configured on one board observably touches another board's tickets
  (risk 7 — Flow 8).
- Incidental: no raw translation keys or layout breakage on any new screen
  visited during the pass (board dialog, templates settings, checklist
  section, blocked-close dialog, banner).
