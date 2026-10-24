# Ticket queue operations

Use Customer Tickets to find permitted shared work, export the filtered result and return eligible work to customer IT in a batch.

## Before you start

Sign in as QA for the existing shared queue. Open [Customer Tickets](http://feature-co-managed-it.localhost:23374/msp/tickets/customer?queueView=working&workspace=all). For bulk changes, prepare two disposable MSP-responsible tickets and record their responsibility, assignments and current handoff history. The existing fixture catalog has one ready MSP-responsible ticket, not a prepared two-ticket bulk set.

See [accounts and retained changes](README.md#fixtures). Keep [All Tickets](http://feature-co-managed-it.localhost:23374/msp/tickets) as the native MSP control.

## Risks to check

- Shared work mixing into or replacing the native desk.
- Filtered totals and CSV content disagreeing.
- Bulk operations affecting hidden or ineligible selections.
- Retrying an interrupted handback creating duplicate notes or transitions.

## 1. Keep queue scope stable

1. Open All Tickets and record a native ticket, then open Customer Tickets.
2. Use the **View** control to compare **Working queue** with **Customer oversight**.
3. Apply **Workspace**, status, search and sort controls. For the existing fixture, search `000002` and press Enter.
4. Reload, open a result, and return to the queue. Compare the applied scope, result identity and displayed organization.

Expected: the working queue follows MSP responsibility or assignment; oversight follows permitted customer scope. Native All Tickets remains the MSP's own desk. URLs and return navigation preserve the applied qualified scope.

## 2. Export the full filtered set

Choose **Export CSV** from the list actions. Open the downloaded file and compare ticket numbers, workspaces, statuses and responsibility with the selected filters. If the filtered result spans pages, compare the export with the whole result, not only the visible page.

Expected: all permitted matching rows are exported once, with no other customer's records or hidden fields. A failed export must report failure rather than silently produce a partial or stale file.

## 3. Return selected tickets once

1. On the disposable working set, select eligible rows using their checkboxes. Read the selected count and ticket labels.
2. In **Return tickets to customer IT**, enter a unique shared IT handoff note and submit.
3. Read each ticket's outcome. Open every successful ticket after reload and compare responsibility and handoff history.
4. As the customer, inspect the same authoritative tickets and note.

Expected: only selected eligible tickets change. Each successful ticket has customer responsibility and one handoff note. A returned ticket may remain in the working queue if the MSP is still assigned; responsibility and assignment are distinct.

## 4. Recover interrupted or mixed results

If a request has an unknown outcome, use the offered retry; after a same-tab reload, use the interrupted-return resume control when offered. Do not rewrite the note or create a new selection while recovering that operation.

For a prepared conflict case, have the customer change one selected ticket before submission. Expected: outcomes distinguish **Returned to customer IT**, **Ticket changed**, and **Access denied** as appropriate. Successful items remain successful; failed items are not silently counted as returned. Re-read conflicted work before starting a new operation.

## Pass criteria and recovery

Pass when queue scope survives navigation, exported content matches the full authorized filter, and each selected ticket has a clear once-only outcome. Re-escalate disposable tickets through the customer UI if restoring responsibility is required. Retain handoff history and downloaded CSV as evidence.

## Source references

- [Qualified ticket list](../../../server/src/components/co-managed/QualifiedTicketList.tsx)
- [Bulk handback composer and reload recovery](../../../server/src/components/co-managed/CoManagedTicketHandbackComposer.tsx)
- [Bulk command](../../../packages/co-managed/src/ticketBulkHandback.ts)

