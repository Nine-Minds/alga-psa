# PRD — Advance-replacement track: ship the dead unit back to the vendor

Card: `379a7983` — alga-2026-0002683 (C5 follow-up).
Reported on PSA ticket alga-2026-0002683.
C5 has merged; this work targets main.
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

**Vendor terms (checked 2026-11-01, round 2).** The published advance-exchange
terms agree that whoever holds the dead unit ships it, with tracking, inside a
short window that starts when the replacement is delivered:

| Vendor | Window | Return logistics | Non-return consequence |
|---|---|---|---|
| Dell ([part return KB 000178919](https://www.dell.com/support/kbdoc/en-us/000178919/returning-service-parts-to-dell-us-only)) | Within 10 days of receiving the replacement, "unless Dell notified you otherwise" | Prepaid FedEx label in the replacement's box; the holder ships it | Charged the then-current standard price, or warranty service suspended |
| HP ([Hardware Support Exchange data sheet](https://h20195.www2.hp.com/v2/GetPDF.aspx/4aa5-7508enw.pdf)) | Ship within 3 business days; HP must *receive* it within 10 business days of your receipt of the replacement | Prepaid label and container supplied; keep a proof-of-shipment receipt; the unit becomes HP's property | Charged the replacement's list price (card/PO taken when the request is logged) |
| Lenovo ([Onsite Advanced Exchange agreement](https://static.lenovo.com/shop/emea/content/pdf/services-warranty/en/Services-Agreements/Onsite-Advanced-Exchange-Services-Agreement-DE_en.pdf)) | Ship within 7 calendar days of delivery, in the replacement's box | In-box instructions; remove accessories, SIM and storage first | Charged the replacement's current retail value |

This confirms the product rule above: when the MSP holds the unit, the MSP
makes the shipment, and custody must record it. It also fixes the deadline
semantics (§2.4): the deadline is a **ship-by** date anchored on replacement
delivery (HP adds a received-by date; Alga stores one date, the vendor's
`return_by`, and treats it as ship-by). The risk window is therefore the
`replaced`/`repaired` state, when the dead unit is still on the MSP's shelf,
not `dead_unit_owed`, when it is already in transit. Windows vary by contract
("unless Dell notified you otherwise"), so Alga records the vendor's date and
does not compute one.

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
  from the stock-unit track, but **a migration IS needed** (correction): the
  custody `close_reason` CHECK did not allow `returned_to_vendor`, and the
  append-only `rma_events` `event_type` CHECK did not allow the two new event
  types. Migration `20261031100000_add_returned_to_vendor_custody_close_reason`
  widens both (NOT VALID; the VALIDATE is in `20261031100100_validate_returned_to_vendor_checks`, a `transaction: false` file per lint R2), and its `down` refuses if any row uses
  a new value.
- **Idempotence vs. the guard matrix (resolved).** The guard matrix allows
  shipping only from `replaced`/`repaired`; `dead_unit_owed` is rejected. The
  one exception is a repeat of the *same* tracking number (case-insensitive,
  trimmed) on a case already in `dead_unit_owed`: it returns the case
  unchanged, writes no event and no custody row, and publishes nothing. A
  *different* tracking number from `dead_unit_owed` is refused. There is no
  correction event; the earlier "tracking correction" idea is removed.

### 2.2 Closing the episode

- Add `dead_unit_owed` to the `from` set of `close`. **Generic close does not
  touch custody**: closing from `dead_unit_owed` leaves the episode
  `with_vendor`. Only `confirm_vendor_receipt` closes custody, as
  `returned_to_vendor` (via `closeCustodyEpisode`, never the `returned` event,
  which hard-codes `returned_to_client`). `return_to_client` is refused from
  `dead_unit_owed`.
- Add the step that confirms **vendor receipt** of the dead unit and closes the
  case as resolved, with the custody episode closed as `returned_to_vendor` —
  not `returned_to_client`. This is the whole point of the card: the custody
  history must never say the device went back to the client.
- `dead_unit_owed` is terminal for the customer-facing flow; the case is not
  "resolved" until receipt is confirmed.

### 2.3 Surfaces

- **Server action** `shipDeadUnitToVendor(rmaId, {carrier, tracking_number,
  return_by?, ...common})` plus `confirmVendorReceipt(rmaId, {...common})`
  (`occurred_at` is when the vendor received it), both tenant-scoped and
  record-level checked. Both are advance-replacement only (`wrong_track`
  otherwise).
- **RBAC:** the same capability that authorises `shipToVendorCore` on the stock
  track. No new permission; the guard is applied after any QR scan (a QR code
  is never a secret).
- **UI:** RMA detail screen on the advance track gains the "Ship dead unit to
  vendor" action once the replacement is received, and a "Vendor received"
  confirmation afterwards. Overdue `return_by` renders as a warning badge.
- **Return slip: skipped.** C1's label types do not make a dead-unit slip
  trivial, and it is not required for "done".

### 2.4 Deadline behaviour (design decision, revised in review round 2)

`return_by` is the existing `rma_cases.return_by` column (not
`dead_unit_due_date`, which belongs to the stock track's client-owes-us clock).
It is the vendor's **ship-by** date for the dead unit (§1). It can be set at
approval, at `receive_replacement` on the advance track (the replacement's
delivery date is known then, so this is where the MSP will usually enter it),
and at `ship_dead_unit_to_vendor`. Nothing fires automatically.

The overdue warning badge follows the risk, not the status:

| State (advance track) | Badge shows when |
|---|---|
| `replaced` / `repaired` (dead unit still in custody) | today > `return_by` ("Dead unit not yet shipped, was due {date}") |
| `dead_unit_owed` (shipped, awaiting vendor receipt) | calendar day of `outbound_shipped_at` > `return_by` ("Dead unit shipped late, was due {date}") |
| any other state, the standard track, or no `return_by` | never |

An on-time shipment awaiting vendor confirmation never shows a badge. The case
always remains closeable: an MSP must never be *unable* to close a case
because a vendor's clock ran out, and Alga must never silently declare a
device forfeited. Attention-list surfacing and the vendor's non-return charge
are card `3a1d00ee` (C5 follow-up 2).

### 2.5 Discriminating the shared `dead_unit_owed` status

`dead_unit_owed` means "a client owes us a unit" on the stock track and "we owe
the vendor the dead unit" here. They are told apart by `returned_unit_id IS
NULL` (`isAssetTracked`); no new column. Guards:

- Every stock-track mutator (`markDeadUnitOwed`, `recordDeadUnitReturned`,
  `chargeForUnreturned`, `closeRma`, and the billing charge which goes through
  `chargeForUnreturned`) already refuses warranty cases at `loadRma`.
- Every warranty core refuses stock cases (`unit_tracked`) at `lockWarrantyRma`.
- The dead-units-owed report and the dashboard attention query gain
  `returned_unit_id IS NOT NULL`, so warranty dead units do not appear as
  client debts or get billed. The RMA list shows them as "Dead unit to vendor".

### 2.6 Custody and the serial (finding)

The open custody episode is keyed by `asset_id` and stores no serial. After
`receive_replacement` the asset row carries the NEW serial while the MSP
physically holds the DEAD unit. The dead serial survives in the
`replacement_received` event payload (`before.serial_number`) and in
`asset_history`. We represent the dead unit honestly with no parallel structure:
the dead serial is written into the custody `shipped` event note, the
`dead_unit_shipped` event payload and the close note. Reviewers should confirm
this is acceptable.

Open question: the asset status `held_by_msp` is left untouched by this leg.

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
- **F4 Overdue visibility.** Badge per the §2.4 table (unshipped past `return_by`; shipped late); `return_by` capturable at `receive_replacement`; no automatic action.
- **F5 Regression.** Stock-unit RMA paths unchanged.

## 5. Tests

- Unit: transition guard matrix — allowed (`replaced`, `repaired`), rejected
  (other states, standard track), same-tracking idempotent re-ship.
- Unit: custody episode after ship+confirm reads `returned_to_vendor`, never
  `returned_to_client`.
- Unit: no writes to stock tables (spy on knex statements or assert table
  access set).
- Integration: end-to-end advance flow (warranty review → approval → replacement
  received and attached to the client asset → dead unit shipped with tracking →
  vendor confirms → case closed) with custody history assertions.
- Unit: overdue badge truth table from §2.4 (replaced past due shows; replaced not yet due hides; dead_unit_owed shipped on time hides even when today > return_by; shipped late shows; standard track never; no return_by never).
- Unit/DB: `receive_replacement` on the advance track accepts and stores an optional `return_by`.
- Regression: stock-unit RMA suite passes unchanged.

## 6. Deliberately not doing

- No vendor API integration; carrier/tracking are recorded, not polled.
- No automatic consequence for a lapsed `return_by` (see §2.4). Attention-list surfacing, the vendor's non-return charge and retained-media custody are card `3a1d00ee`.
- No change to the "client holds it" path; it correctly needs no modelling.
- No new stock ledger, no new permission, no schema change unless confirmed
  necessary.
- No redesign of the C5 advance track.

## 7. Done

The advance-track Dell flow is demonstrable end to end: warranty
review, approval to advance replacement, replacement received and attached to
the client asset, dead unit shipped to Dell with tracking, Dell's receipt
confirmed, case closed — and the custody history shows the dead unit going to
the vendor, not back to the client.
