# Time approval and billing

MSP commercial effort stays in the MSP workspace. Customer operational effort stays with the customer. Their combined display must not turn customer effort into billable MSP time.

## Before you start

Use an assigned MSP technician, a customer technician, an MSP timesheet approver and a billing operator. Prepare a current time period and a valid service/contract line for the sponsor's client. Start on [shared ticket 000002](http://feature-co-managed-it.localhost:23374/msp/co-management/tickets/1f98df77-cd15-44c2-8f4d-42ff52d01e84/c7de2b20-f1d9-4374-b7bb-c223f681955e/cfff4242-7962-4100-a54c-687eaa540500), or a disposable shared task.

The October 25 production check at source `cd28aa9531f7` (build
`build-1792904848073`) verifies the repaired native timesheet projection: Grid
shows both shared work rows, and List shows five entries totaling 4:15, including
the exact 15-minute commercial entry `9bcd33ca`. A new customer entry
`1a9812cb` persisted after reload as five minutes of operational effort, with
zero billable minutes and no service or contract line. The separate recording
for this guide retains those outcomes and the actual build revision.

These checks close the demonstrated missing-row display failure. Approval,
invoice generation, timer recovery, and the previously reported invalid
contract-line behavior after a date change remain unaccepted. Do not infer
those results from correct rows or totals.

## Risks to check

- Lost billable MSP time or invisible timesheet rows.
- Customer operational effort appearing on an MSP invoice.
- Duplicate time after stopwatch/manual-save recovery.
- Approval or billing losing the original customer/work attribution.

## 1. Persist one commercial entry

As QA, open **Log time** on the shared ticket. Choose the date before selecting the service. Enter a distinct description and a small known duration such as 15 minutes, complete the required fields and save once. Reload the ticket, reopen its time-entry list, and record the saved entry and MSP effort delta.

Expected: one persisted entry belongs to Oz, points to this qualified customer work and adds exactly 15 minutes to MSP effort. A changed picker or closed dialog without a persisted row is not a pass. The work reference uses `co_managed`, not the foreign customer's native ticket ID.

## 2. Check stopwatch and customer effort separately

If the native stopwatch is offered to the authorized technician, start it, stop it after a recorded interval, and complete its time-entry flow. Reload and compare the entry count and duration; stopping must not silently create two entries.

As the customer, record a small operational entry on the same authoritative work. Reload **Customer / MSP / Combined** effort from both permitted views.

Expected: each organization owns its own entry, and the combined total is the arithmetic sum of the disclosed effort. Customer time does not carry MSP commercial service, contract line or invoice attributes. The viewer must not gain a time-entry flow.

## 3. Follow the entry into normal timesheets

As the MSP technician, open [Time Entry](http://feature-co-managed-it.localhost:23374/msp/time-entry), select the relevant period and inspect its timesheet details. Find the exact review entry and compare duration, description, work identity and total.

Submit through the normal timesheet controls, then inspect it as an approver at [Timesheet Approvals](http://feature-co-managed-it.localhost:23374/msp/time-sheet-approvals). Approve or return the disposable sheet through the offered workflow, then reload both views.

Expected: shared rows are visible and identifiable wherever totals include them. A missing row with a correct total is a failure to record, not a reason to use only the ticket effort display. If this blocks approval, stop this flow and preserve evidence.

## 4. Reconcile commercial billing

Use the prepared client contract and service in [Invoicing](http://feature-co-managed-it.localhost:23374/msp/billing?tab=invoicing). The Billing root can open Quotes; select **Invoicing** in the sidebar. Review eligible approved time and generate a draft invoice through the ordinary billing workflow only when that setup is available. Open the resulting invoice and trace its source time back to the review entry.

Expected: MSP commercial time reaches the correct MSP client and contract line once; customer operational entries never become sponsor billable time. The draft, approved minutes and source entry must reconcile. Do not infer this result from a ticket's combined effort total.

Billing-profile controls are implemented on qualified time surfaces that mount them. The native shared ticket does not gain a general billing/quick-invoice section. If a required profile cannot be configured through the prepared surface, record the setup gap rather than assuming a ticket billing control exists.

## Pass criteria and retained state

Pass when exact persisted entries agree across effort, timesheet, approval and draft billing, with commercial and operational ownership preserved. Keep time and financial evidence; do not delete entries to restore a display count. Record any absent rows, unavailable period or missing contract as a distinct failure or blocker.

## Source references

- [Native shared-ticket time reference](../../../server/src/components/co-managed/useCoManagedSharedTimeConfig.ts)
- [Qualified time launcher](../../../server/src/components/co-managed/CoManagedTimeEntry.tsx)
- [Commercial billing profile](../../../server/src/components/co-managed/CoManagedTimeBillingProfile.tsx)
- [Shared time billing mode](../../../packages/co-managed/src/timeEntryBillingMode.ts)
