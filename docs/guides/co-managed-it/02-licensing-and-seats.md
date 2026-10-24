# Licensing and seats

The MSP buys or licenses a sponsor pool, then allocates technician seats to individual customer workspaces. A proposed purchase is not verified capacity.

## Before you start

Use an MSP account administrator for pool changes and a relationship administrator for customer allocations. Start at the [Co-Managed IT overview](http://feature-co-managed-it.localhost:23374/msp/co-managed). Record purchased capacity, allocated seats, available seats, and the disposable customer's allocation and usage.

Purchase steps require the configured isolated payment simulator or an approved test provider. Self-hosted capacity requires a signed test license. The latest ticket review did not freshly exercise purchase or license renewal. See [review conventions](README.md#review-order-and-retained-changes).

## Risks to check

- Charging twice when an uncertain purchase is retried.
- Allocating seats before payment or license verification.
- Reducing an allocation below active technicians and pending invitations.
- Mistaking customer allocation changes for cancellation of purchased capacity.

## 1. Reconcile the pool with customer allocations

Open the overview and the disposable client's **Co-managed IT** view. Compare pool totals with **Capacity** and the customer's used/allocated technician seats. Reload both pages.

Expected: used seats fit inside the allocation; all customer allocations fit inside verified capacity. Pool availability decreases when seats are allocated, not merely when technicians sign in.

## 2. Review a hosted pool purchase

1. As the account administrator, change the pool's seat quantity to a known target. Record the existing quantity and the proposed total.
2. Select **Review purchase**. Check the quantity, monthly total and amount due before **Confirm purchase**.
3. Complete the test checkout. If a purchase is pending, use **Resume purchase** rather than starting a competing operation.
4. Refresh the overview until entitlement verification resolves. Compare the provider's checkout/invoice record with AlgaPSA's pool.

Expected: capacity increases only after verification. Reopening the same pending purchase does not create another charge. Record provider operation identifiers alongside the resulting pool total. Test data here does not certify a live Stripe SKU or production pricing.

## 3. Change a customer's allocation

1. Open the disposable client, **Co-managed IT → Capacity → Change seat allocation**.
2. Enter **Technician seats** within available pool capacity and select **Save allocation**.
3. Reload the client and overview. Check that the allocation changed by the requested amount and availability changed by the opposite amount.
4. Try a value below the displayed minimum supported by active technicians and pending invitations.

Expected: valid changes persist; invalid reductions do not alter the allocation. For a hosted shortfall, review the proposed **new pool total** before purchasing. After verification, save/retry the allocation without paying again. An unavailable provider or missing administrator permission must show a blocker, not invented capacity.

## 4. Check the self-hosted branch separately

On a self-hosted review installation, follow **Manage license** to [License Management](http://feature-co-managed-it.localhost:23374/msp/licenses). Install the operator-supplied signed test license, refresh, and repeat the allocation check. Increasing a form value cannot bypass signed capacity. Do not try to exercise this branch by changing the hosted review deployment's mode.

License lapse and renewal need an isolated lifecycle fixture: record the lapse deadline, verify growth is denied, observe the planned read-only transition, then verify renewal recovery without duplicate effects. This timing exercise remains separate from the quick capacity check.

## Pass criteria and retained state

Pass when provider/license capacity, sponsor totals and customer allocations reconcile after reload, with no duplicate charge or over-allocation. Restore a temporary allocation only if current usage permits. Retain purchase receipts; lowering an allocation does not cancel the sponsor subscription.

## Source references

- [Pool editor](../../../server/src/components/co-managed/CoManagedPoolEditor.tsx)
- [Customer seat allocation and shortfall purchase](../../../server/src/components/co-managed/CoManagedClientSeats.tsx)
- [Tenant license management](../../../packages/co-managed/src/tenantLicenseManagement.ts)

