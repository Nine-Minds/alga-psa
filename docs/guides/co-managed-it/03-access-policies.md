# Access policies

The customer approves what can be shared. The MSP assigns its own staff within that scope. Local permissions still apply to both sides.

## Before you start

Use Alice or another customer administrator for customer scope, and a permitted MSP administrator for staff assignments. QA can exercise the technician result; the viewer account provides a read-only comparison. Open [Co-managed access](http://feature-co-managed-it.localhost:23374/msp/co-management) as the customer and the client's **Co-managed IT** view as the MSP.

Use a disposable board and ticket for revocation checks. Record original access before changing it. See [fixture identities](README.md#fixtures). Existing approval of a board can preserve access even after one explicit ticket grant is revoked.

## Risks to check

- Staff seeing customer work outside customer-approved scope.
- View-only staff gaining write capability.
- Revoked access surviving through an old URL, export or download.
- Confusing one removed grant with removal of every independent grant.

## 1. Customer controls board and project scope

1. As the customer, inspect **Proposed ticket access** and **Boards/Projects** in **Co-managed access**.
2. Search for the disposable board, select it, **Add** it, and choose **View** or **Collaborate**.
3. Select **Save access**, then reload. Confirm the same board and access level are stored.
4. In **Escalated tickets only** mode, confirm an un-escalated ticket outside independent board grants is unavailable to the MSP; escalate it through its native customer ticket and check again.

Expected: board oversight and escalation-only access produce different permitted sets. Project access is configured separately. Adding a staff assignment on the MSP side cannot expand the customer's scope.

## 2. MSP assigns its own people

In the MSP client's Co-managed IT view, use **Staff** or **Teams** to add an eligible local principal, choose the offered access and save. Reload and sign in as that principal.

Expected: access is the intersection of customer approval, MSP assignment, and local permissions. A customer-private note stays private even for an assigned technician. An unassigned principal must not gain access solely because it knows the ticket URL.

## 3. Compare a viewer with a technician

Open the same permitted shared ticket as QA, then as `noassign@emeraldcity.oz`. In Entry, the viewer's Category picker stays disabled, the saved status remains readable, and no save bar offers edits. Attempt the same check in Grid. Reload after a technician edit to verify the persisted value.

Expected: both layouts enforce the same authority. Category creation and Tags are absent from shared tickets; customer-local and native MSP controls remain available under their own permissions.

## 4. Revoke the right grant

As the customer, open [Individual ticket access](http://feature-co-managed-it.localhost:23374/msp/co-management/ticket-access). Select **Revoke ticket access**, supply the required handoff note and confirm. Reopen the page to confirm the grant is gone. Refresh the old ticket URL and a previously captured attachment link as the MSP.

Expected: access disappears if that was the only qualifying grant. If an approved board still grants access, remove that independent grant on the disposable fixture before concluding revocation failed. Removing scope must also remove it from fresh lists and exports.

## Field visibility limits

Shared reads redact fields through the sponsor home policy. These guides do not establish a dedicated UI for configuring every visible field. Verify an operator-prepared restricted policy through the shared screen rather than assuming a field-settings dialog exists.

## Pass criteria and recovery

Pass when each principal sees and changes only permitted work, with revocation effective on fresh reads. Restore reversible test scope and assignments from the recorded baseline. Restore sharing through normal customer controls; do not edit tenant identifiers or copy a broader session.

## Source references

- [Access editor](../../../server/src/components/co-managed/CoManagedPolicyPanel.tsx)
- [Individual-ticket grants](../../../server/src/components/co-managed/CoManagedExplicitTicketGrantsPanel.tsx)
- [Policy enforcement](../../../packages/co-managed/src/policy.ts)
- [Shared field redaction](../../../packages/co-managed/src/sharedWorkRead.ts)
