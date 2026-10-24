# Customer onboarding

Create a customer-owned IT workspace and let its administrator approve the proposed relationship before MSP collaboration starts.

## Before you start

Use an MSP administrator with client and co-management permissions, an eligible sponsor, available pool capacity, and a new disposable client. Use a controlled administrator mailbox that can receive the invitation. QA's technician assignment alone is insufficient. See [accounts and review conventions](README.md#fixtures).

The existing White Rabbit workspace is already active. Use it to inspect the resulting client view, not to repeat initial provisioning. Fresh invitation and acceptance were not demonstrated in the latest ticket-screen run.

## Risks to check

- Duplicate workspaces or reserved seats after a retry.
- MSP access before the customer accepts.
- An invitation that activates the wrong customer or broader scope.
- Seats stranded after abandoned setup.

## 1. Create one workspace for one client

1. Open [Clients](http://feature-co-managed-it.localhost:23374/msp/clients), select the disposable client, and open **Co-managed IT**. The cross-client [Co-Managed IT overview](http://feature-co-managed-it.localhost:23374/msp/co-managed) also links to client setup.
2. In **Enable co-managed IT**, enter a unique **Workspace name**, administrator first name, last name and email, and **Technician seats**. Include the administrator in the allocation.
3. Choose **Proposed ticket access**: **Escalated tickets only** or **Oversight of the initial service desk board**. Choose an **MSP escalation queue**.
4. Select **Create workspace and invite administrator**. Record the client, workspace name and reservation. Refresh the client view.

Expected: one setup progresses through Queued/Preparing workspace to **Awaiting customer acceptance**. The workspace belongs to this client and seats are reserved once. An invitation email alone is not activation.

## 2. Require customer approval

1. Open the delivered invitation as the intended customer administrator and finish the normal account setup.
2. On **Review your co-management relationship**, compare the sponsor, proposed boards or escalation-only scope, and destination queue with the original request.
3. Before acceptance, confirm the customer is asked to review the relationship and normal shared work is not active.
4. Select **Accept and activate workspace**. Reload as the customer, then refresh the MSP client view.

Expected: the relationship becomes **Active**, the customer has its own workspace, and only the accepted scope is granted. Initial acceptance includes no shared projects or delegated administration.

## 3. Recover the existing setup

If submission reports an unconfirmed result, use **Retry** with the same details in that form. For a setup already listed on the client, use its recovery controls. **Resend administrator invitation** applies to an expired invitation; a worker failure requires recovery of that setup, not creation of another.

Reload the client and compare workspace and seat totals. Expected: recovery produces one workspace and one allocation. An invitation delivery failure stays visible until delivery recovers. Capture the received message; a success notice is insufficient proof of mail delivery.

## 4. Cancel only an unclaimed workspace

Use a second disposable setup that has not been accepted. Select **Cancel setup** and review **Cancel workspace setup?**, then **Delete workspace and cancel**. Refresh until cleanup finishes. If needed, use **Retry cleanup**.

Expected: seats remain reserved while cleanup is pending, then return to the pool once. A claimed workspace cannot be deleted through setup cancellation. Do not test cancellation on the active White Rabbit workspace.

## Pass criteria and retained state

Record the new client/workspace, accepted scope, delivered invitation, final status and seat totals. Pass when one setup survives retries, live access requires acceptance, and cancellation releases only the unclaimed setup's reservation. Keep an accepted fixture for later guides; a cancelled setup is not reusable.

## Source references

- [Client setup](../../../server/src/components/co-managed/CoManagedClientSetup.tsx)
- [Setup recovery](../../../server/src/components/co-managed/CoManagedClientRecovery.tsx)
- [Acceptance boundary](../../../server/src/components/co-managed/CoManagedAcceptanceBoundary.tsx)
- [Invitation delivery and retry](../../../packages/co-managed/src/provisioningInvitation.ts)
