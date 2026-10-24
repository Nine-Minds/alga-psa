# Departure and archives

Ending co-management closes live trust between organizations. The customer keeps its workspace and data; the MSP keeps its own commercial records and permitted participation archive.

## Before you start

Use a **separate disposable relationship**, with customer and MSP administrators plus a technician who has participated in its shared work. Prepare a shared message/file, an MSP-private message/file, customer-private content and a commercial time entry. Record live links, permitted content, allocation and pool totals.

The active White Rabbit relationship supports the existing ticket review. Do not end it for this walkthrough. Departure has no simple undo or same-relationship reactivation flow. See [review order](README.md#review-order-and-retained-changes).

## Risks to check

- Old sessions or links retaining live access after departure.
- Loss of customer-owned data or MSP commercial evidence.
- The archive exposing customer-private or newly changed customer content.
- Seat allocation being released twice or being confused with subscription cancellation.

## 1. Record the cutoff baseline

As each side, inspect the disposable shared ticket/task and record its title, latest visible messages and file contents. Confirm private-content separation before departure. Record a commercial time entry and any existing permitted draft/invoice association.

Open the MSP [Shared work archive](http://feature-co-managed-it.localhost:23374/msp/co-managed/archive). Note the participant's existing retained work so later results can be distinguished from new retention.

## 2. End the disposable relationship

As its administrator, open [End co-management](http://feature-co-managed-it.localhost:23374/msp/co-management/departure) and choose the prepared workspace, or use that client's Co-managed IT section.

Select **Review departure**. Check the organizations and the effects described in **End this relationship?**. Select **End relationship**, then **Refresh status** and reload the client.

Expected: **This co-management relationship has ended** appears. The customer's workspace remains intact; live collaboration closes. If the outcome is unknown, recover the same request or refresh before repeating the operation.

## 3. Test the old access paths

As the former MSP technician, refresh the saved shared ticket/task URL, queue, file link and permitted export/list paths. Test from an already-open browser as well as a fresh navigation. As the customer, inspect its native ticket, own SLA outcome and local content.

Expected: fresh live cross-organization reads/writes/downloads are denied. The customer keeps access to its own records, export and independent upgrade; the former MSP's live SLA/effort fields become unavailable where appropriate. Merely hiding a navigation item is insufficient.

For prepared queued notifications or mail, confirm delivery workers do not send newly unauthorized content after cutoff. This requires worker/recipient evidence beyond the page walkthrough.

## 4. Read only retained evidence

As the authorized MSP participant, open **Shared work archive**, select the retained ticket/task and inspect **Retained history** and **Retained files**. Download the prepared retained file and compare its bytes. Check qualified author organization and handoff/time history.

As the customer, make a permitted post-departure local change. Refresh the MSP archive. Expected: retained evidence reflects what the MSP was authorized to retain; it does not track the customer's new live state or reveal customer-private notes/files. An unrelated MSP principal must not acquire archive access just by knowing a retained file link.

## 5. Reconcile seats and commercial continuity

Refresh the sponsor overview and customer history. Compare allocations and availability with the recorded baseline, then refresh again.

Expected: the relationship allocation returns to the pool once. Departure does not cancel the sponsor's paid pool subscription. MSP commercial time and authorized invoice/archive evidence remain, and neither organization is deleted.

## Pass criteria and retained state

Pass when live trust closes on every tested path, customer data and permitted MSP evidence survive, and capacity reconciles once. Retain the ended relationship as a departure fixture. Customer deletion and license-lapse recovery need separate operator-prepared lifecycle tests; this guide does not delete a tenant or simulate elapsed time.

## Source references

- [Departure screen](../../../server/src/components/co-managed/CoManagedDeparture.tsx)
- [Relationship closure](../../../packages/co-managed/src/relationshipClosure.ts)
- [Archive UI](../../../server/src/components/co-managed/CoManagedArchive.tsx)
- [Archive authorization and reads](../../../packages/co-managed/src/archiveReads.ts)

