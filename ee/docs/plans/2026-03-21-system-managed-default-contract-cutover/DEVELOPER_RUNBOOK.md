# Developer Runbook: System-Managed Default Contract

## Purpose

Reference for engineers touching contract assignment, due-work generation, and recurring invoice flows after default-contract cutover.

## Lifecycle Semantics

- Identity: one system-managed default contract per `(tenant, client)` in `contracts` (`is_system_managed_default=true`) with linked `client_contracts` assignment.
- Creation policy: lazy/on-demand only through billing-configuration touchpoints.
- Deletion policy: client/billing-config cleanup must remove assignment artifacts and avoid dangling references.
- Manual mutation policy: identity fields are server-guarded (`is_system_managed_default`, `owner_client_id`) and not user-editable.
- Attribution-shell policy: system-managed defaults are non-authorable and should never be used as recurring/service-period schedule authorities.

## Routing Semantics

- Resolver entry points (billing + scheduling) evaluate eligible lines by `effectiveDate` windows.
- Decision outcomes:
  - `explicit`: one eligible line.
  - `default`: one bucket-overlay-preferred fallback line.
  - `ambiguous_or_unresolved`: none or multiple unresolved matches.
- Resolver logs use event `contract_line_resolver.routing`.

## Reconciliation Semantics

- Unresolved due-work pass routes through billing-engine reconciliation.
- Deterministic single-match rows write back `contract_line_id` to source records with null-check guards.
- Ambiguous/no-match rows remain unresolved and visible for manual handling.
- Reconciliation logs use event `billing_engine.reconcile.unresolved`.

## Automatic Invoicing Semantics

- Grouped rows carry attribution metadata:
  - explicit contract
  - system-managed default contract
  - unresolved
- Missing required attribution metadata hard-blocks generation for affected grouped candidates.
- Selection-key compatibility supports legacy `non_contract` parsing only where needed for migration-safe history reads.

## Historical Client-Cycle Bootstrap

- UI can provide an optional `billingHistoryStartDate` when saving client billing schedule.
- Shared schedule domain normalizes that date to the containing cycle boundary before regeneration.
- Regeneration only mutates uninvoiced cycles from the normalized boundary onward.
- Bootstrap requests earlier than earliest invoiced cycle boundary are blocked with explicit user-facing copy.
- Manual cycle bootstrap (`createNextBillingCycle(..., effectiveDate)`) and schedule-save bootstrap use the same boundary-normalization contract.

## Operational Verification

- Default ensure + lifecycle:
  - `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSettings.defaultContract.ensure.test.ts`
- Resolver + reconciliation + grouped selection:
  - `cd server && npx vitest run src/test/unit/billing/billingEngine.unresolvedReconciliation.test.ts src/test/unit/billing/automaticInvoices.nonContractSelection.ui.test.tsx`
- Observability wiring:
  - `cd server && npx vitest run src/test/unit/billing/defaultContractObservability.wiring.test.ts`
- Historical bootstrap + attribution-shell routing:
  - `npx vitest run --config shared/vitest.config.ts shared/__tests__/billingSchedule.historyBootstrap.test.ts`
  - `cd server && npx vitest run src/test/unit/billing/defaultContractHistoricalBootstrapAndBillingRoute.wiring.test.ts src/test/unit/billing/systemManagedDefaultRecurringExclusion.wiring.test.ts`

## Guardrails For Future Changes

- Do not add eager default-contract creation at client-create time.
- Do not bypass action-level guards for system-managed identity fields.
- Do not remove compatibility parsing until rollout stages explicitly permit fallback retirement.
