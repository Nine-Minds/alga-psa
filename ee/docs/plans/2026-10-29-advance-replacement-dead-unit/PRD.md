# PRD — Advance-replacement track: ship the dead unit back to the vendor

Card: `379a7983` — alga-2026-0002683 (C5 follow-up).
Customer: Joymode Business Solutions (Munjal Thakkar), PSA alga-2026-0002683.
Stacks on C5 (`7d3b2c3d`, PR #3896) until it merges, then targets main.
Background: C5's PRD, section "Follow-up: advance-replacement dead-unit shipping"
(`ee/docs/plans/2026-10-25-warranty-review-and-rma/PRD.md`).

## 1. The product question, answered first

**Question.** On the advance-replacement track the vendor pre-ships a
replacement and the defective unit goes back afterwards. Does the MSP ever
handle that leg, or does the client deal with the vendor directly using a
prepaid label (C5's assumption)?

**Answer: the MSP handles it in exactly the flow this card came from, so the
transition must be built.** The evidence is in the customer's own case, not in
vendor marketing: the dead unit had already been *received by the MSP for
evaluation* before the advance replacement was approved. Once the MSP has
physically taken custody of a client asset, "return to client" and "close RMA"
are the only exits the advance track offers — and both record a false custody
fact. The unit is sitting in the MSP's possession and has to leave, with
outbound tracking, to the vendor.

Advance exchange itself is consistent with that: the replacement ships first,
and the defective unit is expected back within the vendor's return window
using the vendor's own return logistics — but *the return movement is still a
real custody event for whoever holds the unit*. When the client holds it, the
client moves it and Alga need not model it (C5's assumption holds). When the
MSP holds it — the evaluation-first path — the MSP moves it, and custody must
say so.

**Recorded product rule.** Alga models the dead-unit leg whenever the MSP holds
custody at the moment the replacement is received. It never models the leg for
units that never entered MSP custody. The UI hint C5 contemplated for the
"client holds it" case is therefore *not* needed; the advance track gains a
real transition instead.

**Open item, deliberately not blocking.** Vendors differ on the return window
(Dell's advance-exchange terms are typically a fixed number of days from
delivery of the replacement; HP and Lenovo publish their own). This design
does **not** encode a vendor-specific deadline: it records the vendor's
`return_by` when the shipment is created and surfaces an overdue state. Turning
a deadline into an automatic action (forfeiture, billing, escalation) is a
product decision this card does not take; see §6.

## 2. Design

Additive, not a redesign. Built the same way as the existing stock-unit track.

### 2.1 Transition `shipDeadUnitToVendor`

- **From:** `replaced`, `repaired` (advance track only — the stock-unit track
  already has its own `dead_unit_owed` handling, which stays untouched).
- **Effect:** records a custody `shipped` event with outbound carrier and
  tracking number — the same schema shape as `shipToVendorCore`, minus
  `return_by` on the *inbound* side and with `return_by` repurposed as the
  vendor's dead-unit return deadline.
- **Lands in:** `dead_unit_owed`. This is already a valid `rma_cases.status`
  from the stock-unit track, so **no migration is expected**; the implementer
  must confirm against main before writing one (the card says so explicitly,
  and a redundant migration is worse than none).
- **Idempotence:** re-invoking with the same tracking number is a no-op; a
  different tracking number after the fact is a correction event, not a second
  shipment.

### 2.2 Closing the episode

- Add `dead_unit_owed` to the `from` set of `close`.
- Add the step that confirms **vendor receipt** of the dead unit and closes the
  case as resolved, with the custody episode closed as `returned_to_vendor` —
  not `returned_to_client`. This is the whole point of the card: the custody
  history must never say the device went back to the client.
- `dead_unit_owed` is terminal for the customer-facing flow; the case is not
  "resolved" until receipt is confirmed.

### 2.3 Surfaces

- **Server action** `shipDeadUnitToVendor(rmaCaseId, {carrier, trackingNumber,
  returnBy?})` plus `confirmVendorReceipt(rmaCaseId, {receivedAt, note?})`,
  both tenant-scoped and record-level checked.
- **RBAC:** the same capability that authorises `shipToVendorCore` on the stock
  track. No new permission; the guard is applied after any QR scan (a QR code
  is never a secret).
- **UI:** RMA detail screen on the advance track gains the "Ship dead unit to
  vendor" action once the replacement is received, and a "Vendor received"
  confirmation afterwards. Overdue `return_by` renders as a warning badge.
- **Return slip:** if C1's label types make a dead-unit shipping slip trivial,
  reuse them; otherwise skip — it is not required for the card's "done".

### 2.4 Deadline behaviour (design decision)

`return_by` is stored and displayed; nothing fires automatically. When it
passes, the case shows an overdue badge and remains closeable — an MSP must
never be *unable* to close a case because a vendor's clock ran out, and Alga
must never silently declare a device forfeited. Any automatic consequence is a
later product decision with its own card.

## 3. Invariants (all must be tested)

1. Printing or scanning a label has **no side effects** — no stock, billing,
   ownership, or time change.
2. A QR code is **never a secret**; RBAC and record-level checks run after the
   scan.
3. Client-owned equipment **never becomes sellable stock** — the dead unit
   never touches `stock_units`, `stock_movements`, `stock_levels`.
4. **Reserving** equipment is distinct from **consuming** it; no second stock
   ledger is introduced.
5. Existing stock-unit RMA paths — including stock-unit `dead_unit_owed` —
   are unchanged and regression-tested.

## 4. Features

- **F1 Shipment capture.** Carrier + tracking (+ optional `return_by`) from the
  advance track, deduped on tracking number.
- **F2 Custody truth.** `shipped` event to the vendor; episode closes
  `returned_to_vendor`.
- **F3 Vendor receipt.** Confirm receipt, close as resolved, timeline entry.
- **F4 Overdue visibility.** Badge only; no automatic action.
- **F5 Regression.** Stock-unit RMA paths unchanged.

## 5. Tests

- Unit: transition guard matrix — allowed (`replaced`, `repaired`), rejected
  (`received`, `approved`, `dead_unit_owed`, `closed`), idempotent re-ship,
  tracking correction.
- Unit: custody episode after ship+confirm reads `returned_to_vendor`, never
  `returned_to_client`.
- Unit: no writes to stock tables (spy on knex statements or assert table
  access set).
- Integration: end-to-end advance flow (warranty review → approval → replacement
  received and attached to the client asset → dead unit shipped with tracking →
  vendor confirms → case closed) with custody history assertions.
- Regression: stock-unit RMA suite passes unchanged.

## 6. Deliberately not doing

- No vendor API integration; carrier/tracking are recorded, not polled.
- No automatic consequence for a lapsed `return_by` (see §2.4).
- No change to the "client holds it" path; it correctly needs no modelling.
- No new stock ledger, no new permission, no schema change unless confirmed
  necessary.
- No redesign of the C5 advance track.

## 7. Done

The advance-track Dell flow is demonstrable end to end for Joymode: warranty
review, approval to advance replacement, replacement received and attached to
the client asset, dead unit shipped to Dell with tracking, Dell's receipt
confirmed, case closed — and the custody history shows the dead unit going to
the vendor, not back to the client.
