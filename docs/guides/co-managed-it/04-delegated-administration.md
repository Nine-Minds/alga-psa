# Delegated administration

A customer can approve one MSP technician or team to perform a specific operation on a specific customer record. This does not grant general administration.

## Before you start

Use a customer administrator, a customer-approved MSP technician/team, and a disposable customer board. Open [Delegated administration](http://feature-co-managed-it.localhost:23374/msp/co-management/administration); select a workspace if a directory appears. MSP administrators can also reach this section through the client's Co-managed IT view. See [accounts](README.md#fixtures).

Prepare a non-administrator customer user and an existing customer-created invitation only if reviewing those operations. This guide is source-grounded; delegation was not freshly demonstrated in the latest ticket correction.

## Risks to check

- A narrow approval becoming general customer administration.
- An approval applied to the wrong record or technician.
- A revoked approval remaining usable in an open editor.
- Invitation resend changing the customer's intended recipient or role.

## 1. Approve one board operation

1. As the customer, find **Approve a specific administration task**.
2. Select **Assigned MSP technician or team**, **Operation → Edit board display settings**, and the disposable **Customer record**.
3. Check the approval summary and select **Approve task** (`co-delegation-approve`).
4. Refresh access and confirm the approval names the intended principal and board.

Expected: approval covers that board and operation only. Unassigned staff and unrelated records are not newly authorized.

## 2. Perform only the approved change

Sign in as the approved MSP principal and open the same administration entry. Change the disposable board's **Description** with a unique review suffix and select **Save changes**. Refresh access, then sign in as the customer and inspect the board's normal settings.

Expected: the customer sees the persisted description. Offered fields are board name, description and live-ticket-timer setting. This approval does not expose role grants, unrestricted users or arbitrary board configuration. Restore the original description through the approved editor and reload.

## 3. Prove revocation closes an open editor

Leave the MSP editor open. In the customer session, select **Revoke access** for this approval and refresh. Return to the old MSP editor and attempt another harmless description change, then refresh it.

Expected: the stale editor cannot save; the customer's record remains unchanged. The record becomes unavailable or the approval disappears. A new approval is required for future work; retrying a revoked approval must not revive it.

## 4. Review the other bounded operations

For **Edit a non-administrator profile**, approve one eligible user. Change a permitted name or time-zone field, save, and confirm as the customer after reload. An administrator profile must not become an eligible target through this operation.

For **Resend a customer-created invitation**, approve one unexpired invitation and inspect its recipient, role and expiry. As the MSP principal, select **Resend approved invitation**. Compare the delivered message and customer invitation record.

Expected: resend retains the customer-created recipient, role, setup link and expiry; it does not extend or replace them. Record delivery through the controlled mailbox rather than treating a successful request as proof.

## Pass criteria and retained state

Pass when the approved operation persists on the approved record, other targets remain unavailable, and revocation blocks the old editor. Revoke test approvals after restoring reversible fields. Preserve sent-invitation evidence and note its unchanged expiry. Recover uncertain commands through **Retry same request** before making another change.

## Source references

- [Delegated administration screen](../../../server/src/components/co-managed/CoManagedDelegatedAdministration.tsx)
- [Allowed operations and admission](../../../packages/co-managed/src/delegatedAdministration.ts)
- [English screen labels](../../../server/public/locales/en/features/co-management-delegation.json)

