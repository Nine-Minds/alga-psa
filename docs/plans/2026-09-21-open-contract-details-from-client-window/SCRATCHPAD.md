# Scratchpad: Open Contract Details from the Client Window

- Plan slug: `2026-09-21-open-contract-details-from-client-window`
- Created: `2026-09-21`
- Tracking: `alga-2026-0002526`

## Decisions

- (2026-09-21) Reuse the existing Billing client-contract detail screen. The destination already accepts both `contractId` and `clientContractId`; no second details UI is needed.
- (2026-09-21) Preserve row click as assignment editing. The new contract-name and menu affordances will stop event propagation so users can choose details or assignment settings independently.
- (2026-09-21) Keep the route helper local to `ClientContractAssignment`. Importing a helper from the Billing package would create an undesirable Clients-to-Billing dependency for a small navigation change.
- (2026-09-21) Do not change the stale global-search URL in this card. Search results lack the client-assignment identity needed for the exact client-contract route and require a separate scope decision.
- (2026-09-21) Defer an in-context drawer. The existing Billing detail screen already provides the requested view and edit capabilities.

## Discoveries / Constraints

- (2026-09-21) `packages/clients/src/components/clients/BillingConfiguration.tsx` mounts `ClientContractAssignment` in the Contracts tab.
- (2026-09-21) `ClientContractAssignment.tsx` renders the name as plain text, uses row click for `handleEditContract`, and exposes only Edit and Unassign in the row menu.
- (2026-09-21) The component already loads `contract_id` and `client_contract_id` for every detailed assignment row.
- (2026-09-21) `ClientContractDialog.tsx` edits assignment dates and renewal settings. It is not a full contract editor.
- (2026-09-21) `packages/billing/src/components/billing-dashboard/contracts/ClientContractsTab.tsx` establishes the canonical route as `/msp/billing?tab=client-contracts&contractId=...&clientContractId=...`.
- (2026-09-21) `packages/billing/src/components/billing-dashboard/BillingDashboard.tsx` selects `ContractDetailSwitcher` for the canonical route. `ContractDetailSwitcher.tsx` resolves the client assignment, and `ContractDetail.tsx` consumes both identifiers.
- (2026-09-21) `packages/search/src/indexers/contract.ts` still emits `/msp/billing/contracts/<id>`. That defect is related but not required to enable navigation from the client window.
- (2026-09-21) The worktree had a pre-existing `package-lock.json` modification before plan authoring. Preserve it and exclude it from the plan commit.

## Expected Implementation Touchpoints

- `packages/clients/src/components/clients/ClientContractAssignment.tsx`
- `packages/clients/src/components/clients/ClientContractAssignment.test.tsx` or an equivalent colocated focused test
- `server/public/locales/*/msp/clients.json`

## Validation Commands

```bash
jq empty docs/plans/2026-09-21-open-contract-details-from-client-window/features.json
jq empty docs/plans/2026-09-21-open-contract-details-from-client-window/tests.json
jq -e 'all(.[]; .implemented == false) and ((map(.id) | unique | length) == length)' docs/plans/2026-09-21-open-contract-details-from-client-window/features.json
jq -e 'all(.[]; .implemented == false) and ((map(.id) | unique | length) == length)' docs/plans/2026-09-21-open-contract-details-from-client-window/tests.json
npm --workspace @alga-psa/clients test -- ClientContractAssignment
npm --workspace @alga-psa/clients run typecheck
git diff --check
```

## Open Questions

- None for this implementation.
