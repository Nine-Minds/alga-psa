# Open Contract Details from the Client Window

- Slug: `2026-09-21-open-contract-details-from-client-window`
- Date: `2026-09-21`
- Status: Draft
- Tracking: `alga-2026-0002526`

## Summary

Let an MSP user open a client's full contract details directly from the contract list under **Client > Additional Info > Billing > Contracts**. The contract name and a new **View details** row action will navigate to the existing billing contract-detail screen for the selected client-contract assignment.

## Problem

The client window lists assigned contracts but does not provide a path to their full details. The contract name is plain text. The row action menu only supports editing assignment dates and renewal settings or unassigning the contract. Clicking the row also opens that limited assignment editor.

Users must leave the client workflow and find the same contract again in Billing to inspect or edit the contract itself.

## Goals

- Make each contract name an obvious, keyboard-accessible details affordance.
- Add a **View details** item to each assignment's action menu.
- Send both affordances to the existing client-contract detail route with the contract and assignment identities intact.
- Preserve the current assignment-edit and unassign behaviors.

## Non-goals

- Building a contract detail drawer or editor inside the client window.
- Expanding `ClientContractDialog` beyond assignment dates and renewal settings.
- Changing the contract creation, Quick Add, assignment, or unassignment workflows.
- Changing contract or client-contract persistence, APIs, permissions, or server actions.
- Correcting the separate global-search contract URL in `packages/search/src/indexers/contract.ts`.
- Redesigning the Billing contract list or extracting a cross-package routing abstraction.

## Users and Primary Flows

### Open details from the contract name

1. An MSP user opens a client.
2. The user selects **Additional Info > Billing > Contracts**.
3. The user activates a contract name.
4. AlgaPSA opens the existing Billing client-contract detail screen for that exact assignment.

### Open details from the row action menu

1. The user opens the row action menu.
2. The user selects **View details**.
3. AlgaPSA opens the same Billing client-contract detail screen.

### Edit assignment settings

1. The user clicks elsewhere on the row or selects **Edit**.
2. The existing assignment editor opens.
3. No contract-detail navigation occurs.

## UX / UI Notes

- Render the contract name with the established linked-text styling used in client tables.
- Give the name control native keyboard behavior and a visible focus state.
- Stop the name activation event from bubbling to the table row. Otherwise the assignment editor can open during navigation.
- Place **View details** before **Edit** in the action menu so full contract details and assignment settings remain distinct choices.
- Stop action-menu events from bubbling to the row.
- Keep the current row pointer treatment and row-click behavior because row click remains a shortcut to edit assignment settings.
- Use the existing `msp/clients` translation namespace for the new action label.

## Requirements

### Functional Requirements

1. `ClientContractAssignment` must construct the canonical client-contract detail URL:

   ```text
   /msp/billing?tab=client-contracts&contractId=<contract_id>&clientContractId=<client_contract_id>
   ```

2. The URL must be built with `URLSearchParams`, matching the established `navigateToContract` behavior in the Billing contract list.
3. Navigation must occur only when both `contract_id` and `client_contract_id` are present on the assignment row.
4. Activating a contract name must navigate to the canonical URL without opening `ClientContractDialog`.
5. Selecting **View details** must navigate to the same URL without opening `ClientContractDialog`.
6. Clicking the remaining row area and selecting **Edit** must continue to open `ClientContractDialog`.
7. Selecting **Unassign** must continue to deactivate the client-contract assignment without navigating.
8. Quick Add and Create Contract must remain unchanged.

### Non-functional Requirements

- The name affordance must be reachable and operable with a keyboard.
- The change must not introduce a new package dependency from `@alga-psa/clients` to `@alga-psa/billing`.
- Navigation must rely on the existing Next.js client router and must not trigger a full page reload.
- Existing permission enforcement on the Billing detail screen remains authoritative.

## Implementation Plan

### `packages/clients/src/components/clients/ClientContractAssignment.tsx`

- Import `useRouter` from `next/navigation` and initialize it in the component.
- Add a local `navigateToContract(contractId?, clientContractId?)` helper that uses `URLSearchParams` and pushes the canonical Billing URL only when both identifiers exist.
- Change the contract-name cell from plain text to an accessible linked-text control. Stop propagation before navigating with the row's `contract_id` and `client_contract_id`.
- Add a **View details** dropdown item before **Edit**. Stop propagation and invoke the same helper with the same row identities.
- Leave `handleEditContract`, the row click handler, `ClientContractDialog`, deactivation, and creation controls unchanged.

The helper remains local. The existing canonical implementation lives in the Billing package, while this component lives in the Clients package. Extracting a shared helper would expand this small UI change into a package-boundary refactor.

### `server/public/locales/*/msp/clients.json`

- Add the `clientContractAssignment.viewDetails` key for the new menu action.
- Provide the English value `View details` and follow the repository's locale update convention for other locale files.

### Focused test coverage

- Add a component-level test beside `ClientContractAssignment` that mocks the router and contract-loading actions.
- Verify that the name and **View details** action push the exact canonical URL.
- Verify event isolation by asserting those affordances do not open the assignment editor.
- Verify the existing row-click and **Edit** behaviors still open the assignment editor.

## Data / API / Integrations

No data model, migration, API, or server-action changes are required. `ClientContractAssignment` already loads both identities needed by the existing Billing destination:

- `contract_id` identifies the contract.
- `client_contract_id` identifies the client-specific assignment.

`packages/billing/src/components/billing-dashboard/BillingDashboard.tsx` already selects `ContractDetailSwitcher` for `tab=client-contracts` when `contractId` is present. `ContractDetailSwitcher.tsx` and `ContractDetail.tsx` already consume both identifiers.

## Security / Permissions

The change exposes a route that is already available from the Billing contract list. It does not bypass contract read permissions. Existing Billing actions and detail components continue to enforce authorization. Hiding or disabling the affordance based on a second client-side permission check is not required.

## Rollout / Migration

No migration, feature flag, backfill, or staged rollout is required. The change is additive UI navigation and can ship with the normal application release.

## Risks

- The table row still opens the assignment editor, so missing `stopPropagation()` on either new affordance would cause navigation and dialog behavior to compete.
- `contract_id` and `client_contract_id` are different identities. Omitting or swapping either parameter can open the wrong detail mode or lose assignment-specific context.
- The canonical route builder is duplicated locally because of the package boundary. Future Billing route changes must update both callers.
- Draft contracts may have a different resume workflow in the Billing list. The client assignment table currently represents assigned contracts and should always use details navigation; tests should use an active assignment to make that expectation explicit.
- Adding a translation key to only one locale can create inconsistent fallback behavior across supported locales.

## Open Questions

None block implementation. A future product decision can determine whether full contract details should eventually open in an in-context drawer.

## Acceptance Criteria (Definition of Done)

- The contract name under **Client > Additional Info > Billing > Contracts** is visibly interactive and keyboard accessible.
- Activating the name navigates to `/msp/billing?tab=client-contracts&contractId=<contract_id>&clientContractId=<client_contract_id>` for that row.
- Every row action menu includes **View details**, which navigates to the same URL.
- Neither details affordance opens the assignment editor.
- Row click and **Edit** still open the assignment date and renewal editor.
- **Unassign**, Quick Add, and Create Contract continue to behave as before.
- Focused automated tests cover the exact route and the click-propagation regression.
- Relevant Clients package tests and type checks pass.
