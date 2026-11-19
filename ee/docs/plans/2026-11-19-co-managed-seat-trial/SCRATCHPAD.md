# Implementation notes

Design baseline: local origin/main at `2a91d24766` on 2026-11-19. Resolve symbols on the implementation branch because the co-managed EE boundary work changes their location.

| Existing owner | Why it matters |
| --- | --- |
| `ee/server/src/lib/co-managed/purchaseDiscovery.ts`, `ee/server/src/components/co-managed/CoManagedPurchaseOverview.tsx` | Hosted Pro discovery checks the commercial surface and account permissions. This alone does not authorize a client invitation. |
| `server/src/lib/actions/coManagedSeatActions.ts`, `packages/co-managed/src/seatArrangement.ts`, `seatInvitation.ts` and `seatInvitationRegistration.ts` in that package | Setup creates the arrangement, then sets scope and invites. A send failure can leave committed setup to resume. Invitation acceptance establishes the user's identity before interactive sign-in. |
| `packages/auth/src/lib/nextAuthOptions.ts` and `packages/auth/src/nextauth/customHostAuth.ts` | Trace the successful interactive session path across supported providers, MFA and custom host. An early sign-in decision alone is insufficient to start the clock. |
| `packages/licensing/src/lib/co-managed-reservation.ts`, `co-managed-capacity.ts` | Writers use the sponsor entitlement lock. Capacity sums every unreleased allocation across Seat and Workspace. Trial-funded allocations must be excluded from paid use in all consumers, including reduction and lapse ordering. |
| `packages/co-managed/src/seatAuthority.ts`, `seatWriteAdmission.ts`, `packages/licensing/src/lib/co-managed-seat-write-admission.ts` | The existing write check only handles mutations. The seat resolver retains subject classification after revocation. Apply access expiry at read and write admission and preserve this classification. |
| `ee/server/src/lib/actions/coManagedBillingActions.ts`, `ee/server/src/lib/stripe/StripeService.ts` | Use the existing absolute pool quantity purchase, canonical subscription and verified entitlement reconciliation. Confirm how the canonical base trial end is persisted and read on the target branch. |
| `server/src/test/integration/coManagedSeatPurchaseResume.emulator.integration.test.ts`, `coManagedPoolCapacity.db.test.ts`, `coManagedSeatAuthority.db.test.ts` in the same directory | Extend runtime coverage with real allocations, sessions and payment replay. |

Related plans: `2026-11-17-co-managed-ee-boundary`, `2026-11-18-co-managed-first-seat-purchase`, `2026-11-18-shared-stripe-offer-catalog`. Resolve the configured offer through the active pricing owner at implementation time. No rollout depends on changing the price in live Stripe as part of this card.

## Draft implementation discoveries

- On this branch the co-managed Seat arrangement and invitation owners are in `packages/co-managed/src/seatArrangement.ts` and `seatInvitation.ts`; the allocation pool reader and reservation owner are in `packages/licensing/src/lib/co-managed-capacity.ts` and `co-managed-reservation.ts`.
- `co_managed_allocations` is a shared CE/EE ledger. A shared `funding_source` column with default `paid` is required so the shared pool reader can exclude EE pilot capacity without making CE behavior depend on pilot tables. The pilot ledger is EE-only.
- The first-session auth callback is not sufficient for activation because MFA and custom-host flows converge later; the lifecycle primitive is being shaped as an authenticated Seat admission operation and must still be wired into a universal first Seat request boundary before launch.
- Local dev Postgres is `alga-psa-local-test-postgres-1` on host port 5474. Its migration ledger is from a different checkout and fails Knex's missing-file validation; do not use it for a migration result. The EE runner first defaulted to port 5432 and then hit this ledger mismatch on 5474.
