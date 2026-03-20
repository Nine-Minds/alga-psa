# Scratchpad — Multi-Active Contracts Per Client

- Plan slug: `multi-active-contracts-per-client`
- Created: `2026-03-20`

## Decisions

- 2026-03-20: This plan assumes true concurrent active assignments are allowed, including overlapping active windows for the same client.
- 2026-03-20: This plan preserves single-assignment invoices. Removing the single-active-contract rule does **not** imply mixed-contract invoices.
- 2026-03-20: PO scope remains invoice-level and therefore remains assignment-scoped because invoices remain assignment-scoped.
- 2026-03-20: `client_contract_id`, not `contract_id`, is the canonical identity for assignment-scoped UI and execution.
- 2026-03-20: Ambiguous legacy surfaces must stop guessing. Prefer explicit assignment identity or an explicit ambiguity failure.
- 2026-03-20: Mixed-currency behavior is explicitly preserved as a separate policy; multi-active assignment support does not imply mixed-currency active assignments for the same client.

## Discoveries / Constraints

- 2026-03-20: There is no DB-level uniqueness or exclusion constraint enforcing one active contract per client. The rule is app-layer only.
- 2026-03-20: The billing wizard path is asymmetric today. It only preflights mixed-currency active contracts and can already create same-client same-currency active contracts through a different path than `packages/clients`.
- 2026-03-20: `packages/clients` has the most dangerous identity bugs for this change. Several reads and UI flows still key by `contract_id`, which is not unique once a client can hold multiple active assignments to the same header/base contract.
- 2026-03-20: Recurring due-work grouping is already closer to the desired behavior than preview/generation. Candidate grouping already splits by `client_contract_id`; the execution path is the risky part.
- 2026-03-20: Invoice generation, PO consumption, invoice queries, and exports all still assume one invoice belongs to one `client_contract_id`. That assumption is workable and should be preserved in this plan.
- 2026-03-20: Fixed recurring charge attribution can still collapse sibling concurrent assignments if they share the same base line/template identity.
- 2026-03-20: Bucket usage currently picks the latest active matching assignment. That behavior becomes actively wrong when concurrent active contracts are allowed.
- 2026-03-20: BillingCycles still collapses multiple active assignments for a client to the first active row returned, ordered by latest start date.
- 2026-03-20: Singleton active-contract UI/action blockers were still live in `ContractBasicsStep`, `ContractDialog`, `ClientContractsTab`, `Contracts.tsx`, `contractActions`, and shared/model helper layers.
- 2026-03-20: Wizard assignment writes inserted directly into `client_contracts`, so shared assignment validation was bypassed and mixed-currency policy could diverge from clients flows.

## Agent Audit Summary

- UI enforcement audit:
  - `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx`
  - `packages/billing/src/components/billing-dashboard/contracts/ContractDialog.tsx`
  - `packages/billing/src/components/billing-dashboard/contracts/ClientContractsTab.tsx`
  - `packages/billing/src/components/billing-dashboard/contracts/Contracts.tsx`
- Shared/server invariant audit:
  - `shared/billingClients/contracts.ts`
  - `shared/billingClients/clientContracts.ts`
  - `packages/billing/src/actions/contractActions.ts`
  - `packages/billing/src/models/contract.ts`
- Clients identity/scoping audit:
  - `packages/clients/src/components/clients/ClientContractAssignment.tsx`
  - `packages/clients/src/components/clients/BillingConfiguration.tsx`
  - `packages/clients/src/components/clients/ContractLines.tsx`
  - `packages/clients/src/actions/clientContractLineActions.ts`
  - `packages/clients/src/models/clientContractLine.ts`
- Recurring/invoice/PO audit:
  - `packages/billing/src/actions/invoiceGeneration.ts`
  - `packages/billing/src/lib/billing/billingEngine.ts`
  - `packages/billing/src/services/invoiceService.ts`
  - `packages/billing/src/services/purchaseOrderService.ts`
  - `packages/billing/src/actions/billingAndTax.ts`
- Secondary-surface audit:
  - `packages/billing/src/components/billing-dashboard/BillingCycles.tsx`
  - `packages/billing/src/services/bucketUsageService.ts`
  - `packages/billing/src/actions/contractReportActions.ts`
- Fixture/schema/docs audit:
  - `server/test-utils/billingTestHelpers.ts`
  - `server/test-utils/testContext.ts`
  - `docs/billing/billing.md`
  - `ee/docs/plans/2026-01-05-contract-purchase-order-support/*`

## Key File Pointers

- Singleton helpers:
  - `shared/billingClients/contracts.ts`
  - `shared/billingClients/clientContracts.ts`
- Billing UI blockers:
  - `packages/billing/src/components/billing-dashboard/contracts/wizard-steps/ContractBasicsStep.tsx`
  - `packages/billing/src/components/billing-dashboard/contracts/ContractDialog.tsx`
  - `packages/billing/src/components/billing-dashboard/contracts/ClientContractsTab.tsx`
- Clients UI identity/scoping:
  - `packages/clients/src/components/clients/ClientContractAssignment.tsx`
  - `packages/clients/src/actions/clientContractLineActions.ts`
  - `packages/clients/src/models/clientContractLine.ts`
- Invoice/PO boundary:
  - `packages/billing/src/actions/invoiceGeneration.ts`
  - `packages/billing/src/services/purchaseOrderService.ts`
  - `packages/billing/src/actions/invoiceQueries.ts`
- Secondary ambiguity surfaces:
  - `packages/billing/src/services/bucketUsageService.ts`
  - `packages/billing/src/components/billing-dashboard/BillingCycles.tsx`

## Commands / Runbooks

- 2026-03-20: Singleton-rule repo scan
  - `rg -n "hasActiveContractForClient|getClientIdsWithActiveContracts|already has an active contract|active contract overlapping|disabledClientIds" shared packages/billing packages/clients server/src/test ee/docs/plans docs/billing`
- 2026-03-20: Commit provenance for the UI client-disable behavior
  - `git show --stat --summary 3aa57cd62f62ba70b2d05e657d6d1bc9d67b7b05`
- 2026-03-20: Plan scaffold
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Multi-Active Contracts Per Client" --slug multi-active-contracts-per-client`
- 2026-03-20: Singleton-blocker removal audit
  - `rg -n "disabledClientIds|already has an active contract|terminate their current contract|save as draft|checkClientHasActiveContract|fetchClientIdsWithActiveContracts|getClientIdsWithActiveContracts|hasActiveContractForClient" packages/billing/src/components/billing-dashboard/contracts packages/billing/src/actions shared/billingClients packages/clients/src`
- 2026-03-20: Post-change verification scan
  - `rg -n "checkClientHasActiveContract|fetchClientIdsWithActiveContracts|hasActiveContractForClient|getClientIdsWithActiveContracts" packages/billing/src packages/billing/tests shared/billingClients packages/billing/src/models`
- 2026-03-20: Shared overlap/mixed-currency follow-up scan
  - `rg -n "join\\('client_contracts as cc'|already has an active contract overlapping the specified range|where\\(function overlap\\(" packages/billing/src/actions/contractWizardActions.ts shared/billingClients/clientContracts.ts packages/clients/src/actions/clientContractActions.ts packages/clients/src/models/clientContract.ts`
- 2026-03-20: Targeted billing test run
  - `cd packages/billing && npx vitest run --config vitest.config.ts tests/contract.test.ts tests/ClientContractsTab.assignmentLifecycle.test.ts tests/multiActiveContracts.singletonGuardRemoval.wiring.test.ts tests/multiActiveContracts.assignmentWritePath.wiring.test.ts`
- 2026-03-20: Clients identity wiring test run
  - `cd packages/billing && npx vitest run --config vitest.config.ts tests/multiActiveContracts.singletonGuardRemoval.wiring.test.ts tests/multiActiveContracts.assignmentWritePath.wiring.test.ts tests/multiActiveContracts.clientsAssignmentIdentity.wiring.test.ts tests/ClientContractsTab.assignmentLifecycle.test.ts tests/contract.test.ts`

## Implementation Log

- 2026-03-20: Removed billing wizard/client-dialog active-contract singleton gating (client disable lists, active-contract warning copy, and submit-disable behavior tied to sibling active contracts).
- 2026-03-20: Removed restore/set-active prechecks in both contract shells (`ClientContractsTab` and legacy `Contracts.tsx`) so activation no longer blocks on “another active contract exists”.
- 2026-03-20: Removed action/model/shared singleton helper path:
  - deleted `checkClientHasActiveContract(...)` and `fetchClientIdsWithActiveContracts(...)` action exports
  - removed `updateContract(... status: 'active')` active-contract singleton rejection
  - removed shared/model `hasActiveContractForClient(...)` and `getClientIdsWithActiveContracts(...)` wrappers
  - removed expired-contract reactivation singleton precheck in shared contract reactivation helper
- 2026-03-20: Updated contract-related billing tests/mocks to align with removed singleton helper exports and revised activation callback signatures.
- 2026-03-20: Routed wizard assignment persistence through shared `createClientContractAssignment(...)` and removed wizard-local mixed-currency preflight query so create semantics come from shared assignment writes.
- 2026-03-20: Removed shared assignment overlap-window create/update blockers while preserving the clients action-layer invoiced-period guard.
- 2026-03-20: Centralized packages/clients assignment create/update persistence through shared helpers (`createClientContractAssignment` / `updateClientContractAssignment`) and removed duplicate overlap enforcement in clients actions/models.
- 2026-03-20: Updated `ClientContractAssignment` to keep assignment flows keyed by `client_contract_id`:
  - add/apply now uses the returned assignment id from `assignContractToClient(...)`
  - removed contract-header de-dup filtering that blocked creating a second active assignment for the same `contract_id`

## Links / References

- Related plans:
  - `ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/`
  - `ee/docs/plans/2026-03-20-template-runtime-normalization-completion/`
  - `ee/docs/plans/2026-01-05-contract-purchase-order-support/`
- Product docs:
  - `docs/billing/billing.md`

## Open Questions

- Should the mixed-currency rule remain a separate restriction, or should this plan remove it too?
- For bucket usage ambiguity, should product UX require explicit assignment identity upstream or accept a hard failure at billing time?
- Are there any remaining client-facing surfaces where “contract” is actually intended to mean assignment and should be renamed in this plan?
