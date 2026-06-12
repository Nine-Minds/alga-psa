# Smoke Tests — RMM Alert Handling

Manual validation for everything the automated core (tests.json) doesn't cover:
UI surfaces, live RMM round-trips, Temporal schedule lifecycle, email delivery,
and migrations against a real stack.

These steps are derived from the design (`docs/plans/2026-06-12-rmm-alert-handling-design.md`),
not a running build — the feature is not implemented yet. Re-ground exact
labels and routes against the real screens when executing, and update this file
where they differ.

## Preflight

- A worktree dev stack with migrations run clean (`npx knex migrate:latest`
  from `server/` exits 0; spot-check that `rmm_alerts` has `dedup_key` and
  `rmm_maintenance_windows` exists).
- A NinjaOne sandbox connected at **Settings → Integrations → RMM** with at
  least one organization mapped to a test client and one device synced as an
  asset.
- A catch-all alert rule: create it in the new **Alert Rules** section
  (create-ticket on, a board picked, notify yourself). Creating, editing,
  reordering, and toggling this rule during preflight doubles as the rules-UI
  compatibility check.
- A test condition you can flip on demand on the sandbox device (e.g., a
  disk-space or stopped-service condition you control).

## Risks this smoke is defending

1. A real client outage produces no ticket — SLA breach nobody notices.
2. A flapping condition floods the board — techs drown and miss real alerts.
3. Tickets close out from under a working tech, or stale alert tickets never
   close — lost work either way.
4. A maintenance window swallows alerts forever — "suppressed" silently becomes
   "lost".
5. Alga writes wrong state into the customer's RMM, or cleared tickets leave
   stale alerts piling up in the NinjaOne console.
6. Alert tickets land on the wrong board/client/priority — misdispatched work
   and a polluted audit trail.
7. Notify/automation wiring is dead — teams that rely on alert workflows and
   emails find out during an incident.
8. A disconnected integration keeps polling — zombie schedule hammering a
   revoked credential.

## Flows

### Flow 1 — a real alert becomes a correctly-routed ticket (risks 1, 6)

Trigger the test condition on the sandbox device. Within a minute, a ticket
appears on the board your rule chose, with the rule's priority and assignee,
linked to the correct client and asset, titled from your template with the
device name filled in, and carrying an initial internal comment with the alert
details. Check the asset's drawer: the alert shows in the alerts section with
the linked ticket.

### Flow 2 — a flapping condition doesn't storm the board (risk 2)

With Flow 1's ticket still open, clear and re-trigger the same condition twice.
The board's ticket count for that client does not change; the existing ticket
gains "re-triggered — 2nd occurrence" / "3rd occurrence" internal comments.

### Flow 3 — alert clears: untouched closes, touched survives (risk 3)

Clear the condition in NinjaOne. The untouched ticket gains an
"alert resolved" comment and moves to the closed status automatically. Then
re-trigger (new ticket), add a tech comment to it, and clear the condition
again: this ticket gains the resolution comment but stays open.

### Flow 4 — closing a ticket clears the alert in the RMM (risk 5)

Re-trigger to get an open alert ticket, then close the ticket in Alga. In the
NinjaOne console's alerts view, the alert is reset/gone within a minute. Then
edit the rule to turn off "reset alert in RMM on ticket close", repeat, and
confirm the alert stays active in NinjaOne (the opt-out is honored).

### Flow 5 — maintenance window suppresses during, surfaces after (risk 4)

In **Maintenance Windows**, create a one-off window for the test client
covering the next 30 minutes. Trigger the condition: no ticket appears, no
notification fires, and the alert shows as suppressed on the asset. Edit the
window to end now (or wait it out) while the condition is still active. Within
one poll cycle (≤15 min) the alert is processed and the ticket appears. This is
the highest-value silent-failure check in the set.

### Flow 6 — the poller heals missed webhooks (risks 1, 3)

Break webhook delivery deliberately (delete the webhook registration in
NinjaOne, or point it at a dead URL). Trigger one condition and clear a
different, previously-ticketed one. Within one poll cycle, the new alert has a
ticket and the cleared alert's untouched ticket is closed — same outcomes as
webhooks, just slower. Restore the webhook afterward.

### Flow 7 — notify and automation wiring is live (risk 7)

With your rule's notify-user set to yourself: trigger an alert and confirm both
the in-app notification and the email arrive (and that opting out of the
`rmm-alert` category in your notification preferences suppresses the email on a
repeat). In the workflow designer, build a trivial workflow triggered by
RMM_ALERT_TRIGGERED (e.g., add a ticket comment), trigger an alert, and confirm
the workflow execution log shows a run.

### Flow 8 — disconnect tears the poller down (risk 8)

Disconnect the NinjaOne integration in settings. The reconciliation schedule is
gone from the Temporal UI and no polling errors accrue in server logs
afterward. Reconnect and confirm the schedule reappears.

### Variant — TacticalRMM parity (risks 1, 2)

Repeat Flows 1 and 2 against a TacticalRMM instance: webhook alert → routed
ticket, repeat → occurrence comment. Confirm a reconciliation cycle runs
without errors (outbound reset is expected to be skipped if Tactical ships
without an adapter).

## Pass criteria

- Risks 1/6: every triggered test alert produced exactly one ticket, on the
  right board, client, priority, and asset — on both providers.
- Risk 2: repeated firings never created a second open ticket.
- Risk 3: untouched tickets closed themselves on alert clear; the touched
  ticket survived with its history intact.
- Risk 5: NinjaOne's console agreed with Alga after every ticket close —
  cleared when the rule says reset, untouched when opted out.
- Risk 4: nothing fired during the window, and the still-active alert became a
  ticket after it — suppressed never meant lost.
- Risk 7: notification arrived on both channels, preferences were honored, and
  the alert-triggered workflow ran.
- Risk 8: disconnect left no schedule and no errors; reconnect restored it.
