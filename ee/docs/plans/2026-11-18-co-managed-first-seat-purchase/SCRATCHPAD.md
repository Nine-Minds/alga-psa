# First co-managed seat purchase — engineering notes

## Baseline

Reviewed `origin/main` at `df2e614614` on 2026-11-18. The sponsor overview layout and page require `co-managed` to serve the tenant. Account Management already mounts `CoManagedPoolEditor`. The missing entry is the path from the MSP navigation before a sponsor owns seats.

## Where the decisions live

| Baseline path | Behavior to preserve or extend |
| --- | --- |
| `server/src/config/coManagedMenu.ts`, `server/src/components/layout/SidebarWithFeatureFlags.tsx` | The served-capability slot contributes both root and archive. Both rows require `co_management:read`. Granting that permission solely to display the root would also expose other operational entry points. |
| `server/src/app/msp/co-managed/{layout,page}.tsx`, `server/src/app/msp/co-managed/archive/page.tsx` | The parent layout and root page each gate on `serves`. The product boundary also distinguishes a customer home from a sponsor overview. Archive has its own gate. The root metadata separately checks capability. |
| `server/src/components/co-managed/CoManagedOverview.tsx`, `server/src/lib/actions/coManaged{,Seat}Actions.ts` | The existing overview starts relationship/combined-table reads, some of which admit sponsor permissions lazily. A financial view must be renderable without those reads. |
| `packages/licensing/src/lib/co-managed-purchase-surface.ts`, `server/src/lib/actions/coManagedActions.ts` | The price, release flag and force setting gate `getCoManagedPurchaseState`. The reader requires internal account read permission, derives availability using deployment, tier and update permission, and returns pending operations in preparing, checkout or payment-failed states. It does not distinguish completed operations awaiting verified capacity today. |
| `ee/server/src/components/settings/account/AccountManagement.tsx`, `server/src/components/co-managed/{CoManagedPoolEditor,CoManagedPurchaseReview,useCoManagedPurchaseController}.*` | The editor already supports absolute pool quantities, explicit review, checkout and recovery. Its current minimum equals allocated seats. Require a positive quantity when buying the first seats, while preserving supported pool reductions elsewhere. |
| `ee/server/src/lib/actions/coManagedBillingActions.ts`, `ee/server/src/lib/stripe/StripeService.ts` | Preview and purchase require account update and an open purchase surface. Stripe checks tenant/product, manual billing, current Pro subscription, configured price and subscription ownership. Preserve those checks on action calls and resume, even when the UI previously showed a quote. |
| `packages/licensing/src/lib/co-managed-purchases.ts`, `packages/licensing/src/lib/co-managed-hosted-reconcile.ts` | A purchase can mark an operation completed before verified capacity increases. Reconciliation can insert a zero-capacity hosted row, and completes only an operation matching the proved subscription/operation and target. The confirmed provider state governs the paid capacity. |
| `packages/co-managed/src/capability.ts`, `server/src/lib/co-managed/admitSponsor.ts`, `packages/licensing/src/lib/co-managed-admission-permissions.ts` | On the baseline, an entitlement row counts toward both operational gates regardless of capacity. Reconciliation does not grant co-management permissions. A later admitted sponsor read can seed them and grant them to the default MSP Admin role. A custom account administrator may never hold them. |

## Implementation handoff

- Use the root’s authenticated commercial decision to contribute the navigation link without an operational permission. Keep an account-only buyer’s view accessible through checkout, a zero-row observation and the eventual paid result. Existing served operational readers keep their own independent route. A lapsed sponsor with history must still be able to read it.
- A completed operation is also a legitimate historical record. When deriving an awaiting-verification state, use the first purchase’s target and provider/entitlement evidence. Explicitly handle expired and failed outcomes through the existing controller so a historical purchase cannot strand a legitimate retry.
- The Nov 17 boundary plan identifies EE owners for licensing, UI, route implementations and menu contributions. Check which slices have landed before coding. Use the corresponding EE path or seam on the implementation base.
- The Nov 10 plan’s F087 covers purchasing a shortfall inside one client’s Seat setup. Keep that flow’s client context, target calculation and allocation recovery. [Seat and Workspace checklist](../2026-11-10-co-managed-seat-and-workspace/features.json)

## Verification references

`server/src/test/integration/coManagedPurchaseEmulator.integration.test.ts` already exercises a hosted first purchase, delayed webhook delivery and an unpaid first observation against persistent data. Extend the coverage at the navigation, root and actor boundaries. `server/src/test/unit/co-managed/coManagedPageGate.test.tsx` and `CoManagedOverview.test.tsx` exercise the page and rendered overview. The [test checklist](tests.json) describes the missing behavioral journeys.
