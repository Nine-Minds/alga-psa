# PRD — System-Managed Default Contract Cutover

- Slug: `system-managed-default-contract-cutover`
- Date: `2026-03-21`
- Status: Draft

## Summary

Replace unmatched/non-contract billing fallback behavior with a first-class, system-managed **Default Contract** per client. The default contract is created on-demand when billing configuration exists/gets created, unmatched billable work is routed to it deterministically, and stale/deleted clients do not leave orphaned default-contract artifacts.

## Problem

Today, unmatched work is represented as non-contract/fallback behavior across time-entry save paths, usage save paths, due-work collection, and invoice generation. That causes:

- inconsistent assignment outcomes across UI/save/invoice paths,
- ambiguous UX language (`non-contract`, `default rates`) that does not match target business model,
- fragile edge cases after multi-contract-per-client changes,
- complexity debt from fallback paths that should no longer be primary behavior.

## Goals

1. Establish a single default-contract model for unmatched billable work.
2. Make default contract creation deterministic and on-demand.
3. Remove runtime non-contract fallback paths from normal billing flow.
4. Keep behavior safe under multi-contract-per-client, date-effective resolution, and concurrent writes.
5. Make UI language and controls explicit for system-managed default behavior.

## Non-goals

1. No redesign of contract pricing model itself.
2. No new contract authoring UX beyond minimum surfaces needed for visibility/read-only constraints.
3. No broad billing overhaul unrelated to default-contract routing.

## Users and Primary Flows

1. Billing admin configures/updates client billing settings.
2. Technician enters billable time or usage.
3. System auto-resolves work to explicit contract line or system-managed default contract path.
4. Billing admin generates recurring invoices without manual non-contract fallback reconciliation.

## UX / UI Notes

1. Contract lists/detail surfaces show `System-managed default` badge and helper copy.
2. Destructive/manual lifecycle actions for system-managed default contracts are constrained.
3. Time-entry/usage copy uses `system-managed default contract` language instead of `non-contract/default rates`.
4. Automatic invoicing grouped rows distinguish explicit contract work from default-contract work using business labels.
5. If required attribution metadata is missing for grouped generation, hard block generation for affected rows.

## Requirements

### Functional Requirements

1. Introduce a system-managed default contract concept with deterministic identity per client+tenant.
2. Create default contract **on-demand** when billing settings are first ensured/inserted for a client.
3. Support idempotent default contract ensure under concurrent requests.
4. Route unmatched billable time and usage to default contract resolution path.
5. Default resolution must be **effective-date aware** (work date / usage date), not current-time-only.
6. Shared eligibility resolver must be used by save-path assignment, UI default display, and billing engine reconciliation.
7. Billing engine unresolved-path reconciliation must persist deterministic single-match assignment back to source records.
8. Automatic due-work candidate generation should include only truly unresolved records (none/ambiguous), not resolvable single-match records.
9. Invoice generation selection key logic removes non-contract fallback semantics and uses default-contract-aware selection semantics.
10. Existing clients with billing settings but no default contract should get it lazily at first qualifying touchpoint.
11. Deletion/cleanup rules remove default contract assignment artifacts when client lifecycle deletes billing configuration/client.
12. Contract deletion/archival guards remain intact for already-invoiced paths.
13. API/controller paths that bypass package-level cleanup must be reconciled so default-contract cleanup is not skipped.
14. Schedule/settings updates that intentionally delete overrides (`null` settings) must not accidentally recreate default contracts unless required by active billing configuration policy.
15. Add clear business-safe labels in UI for default-contract and unmatched work semantics.
16. Preserve multi-contract-per-client behavior without reintroducing single-contract constraints.

### Non-functional Requirements

1. Deterministic behavior under concurrent write paths (no duplicate default contracts).
2. No cross-tenant leakage.
3. Backward-compatible migration path with nullable new pointers/flags where needed.
4. Idempotent reconciliation jobs/actions.
5. Clear observability logs for ensure/reconcile/route decisions.

## Data / API / Integrations

1. Use existing `contracts` + `client_contracts` lifecycle as minimum durable footprint for default contracts.
2. Add schema support (if needed) for explicit system-managed marker and/or pointer from billing settings to default contract assignment.
3. Enforce uniqueness constraint/index for one default contract per client+tenant lifecycle domain.
4. Ensure existing migration conventions are followed with idempotent guards.
5. Audit create/delete pathways:
   - package actions,
   - shared helper paths,
   - API service/controller paths,
   - integration-import create paths.

## Security / Permissions

1. Only authorized billing/contract roles can view/manage default contract details.
2. System-managed fields are read-only where user edits could break invariants.
3. No privilege escalation through API bypass flows.

## Observability

1. Structured logs for default contract ensure, resolution, and reconciliation outcomes.
2. Metrics/counters (or equivalent trace markers) for:
   - default contract created,
   - default contract reused,
   - unmatched resolved deterministically,
   - unresolved ambiguous still requiring human action.

## Rollout / Migration

1. Hard cutover objective: remove fallback complexity in primary path.
2. Schema migration first (nullable-safe).
3. Runtime on-demand ensure enabled behind migration-complete assumption.
4. Reconciliation pass for existing null `contract_line_id` records that have deterministic single match.
5. Clean up UI/API terminology and selection-key parsing after routing cutover is in place.
6. Remove or gate obsolete fallback code paths after validation.

## Execution Order

1. Finalize data model markers/constraints for system-managed default contract identity.
2. Implement shared default-contract ensure primitive (idempotent + concurrency-safe).
3. Hook ensure primitive into all billing settings/schedule/cycle-anchor ensure/insert paths.
4. Align resolver contract (`effectiveDate`) and update all save/UI callers.
5. Implement billing engine reconciliation write-back for deterministic single-match records.
6. Update due-work collection and invoice generation to consume reconciled/default-contract-aware semantics.
7. Update UI copy/constraints across contract list/detail, time entry banner, automatic invoicing rows.
8. Implement deletion and orphan cleanup consistency across package actions + API service paths.
9. Add migrations/tests, run high-impact integration suite, then remove obsolete fallback paths.

## Open Questions

1. Should default contract creation trigger on every billing-settings ensure event or only on explicit non-null billing configuration states?
2. Should API generic delete be replaced with domain delete orchestration for clients, or should it call the same cleanup primitive?
3. Do we store default-contract pointer on `client_billing_settings` directly, or infer by deterministic query each time?

## Acceptance Criteria (Definition of Done)

1. For any client with active billing configuration, system can ensure exactly one default contract identity.
2. New/updated billable time and usage resolve through effective-date-aware resolver, with deterministic assignment when possible.
3. Invoice due-work no longer surfaces deterministic single-match work as non-contract.
4. Automatic invoicing flow does not depend on legacy non-contract fallback keys for normal operation.
5. UI labels and action constraints reflect system-managed default contract semantics clearly.
6. Client deletion and billing-config cleanup do not leave orphaned default contract assignment artifacts.
7. Test suite covers core creation/routing/reconciliation/cleanup behavior with high-confidence scenarios.
