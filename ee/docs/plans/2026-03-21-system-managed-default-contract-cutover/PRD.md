# PRD — System-Managed Default Contract Cutover

- Slug: `system-managed-default-contract-cutover`
- Date: `2026-03-21`
- Status: Draft

## Summary

Replace unmatched/non-contract billing fallback behavior with a first-class, system-managed **Default Contract** per client. The default contract is created on-demand when billing configuration exists/gets created, but it no longer behaves like a user-authored recurring contract. Instead, it becomes a non-authorable attribution shell for unmatched time/usage, while billing windows come from the client billing schedule and pricing comes from default/service-catalog pricing. Client billing setup gains an optional historical bootstrap date so MSPs can backfill client billing cycles for back-dated billable work without corrupting invoiced history.

## Problem

Today, unmatched work is represented as non-contract/fallback behavior across time-entry save paths, usage save paths, due-work collection, and invoice generation. That causes:

- inconsistent assignment outcomes across UI/save/invoice paths,
- ambiguous UX language (`non-contract`, `default rates`) that does not match target business model,
- fragile edge cases after multi-contract-per-client changes,
- complexity debt from fallback paths that should no longer be primary behavior,
- overloaded semantics where a system-managed default contract still looks like a recurring contract with start dates, cadence, and line authoring,
- unresolved back-dated billing gaps when a client receives billing configuration after historical work already exists and no historical client billing cycles have been established.

## Goals

1. Establish a single default-contract model for unmatched billable work.
2. Make default contract creation deterministic and on-demand.
3. Remove runtime non-contract fallback paths from normal billing flow.
4. Make system-managed default contracts non-authorable, non-recurring attribution shells rather than quasi-normal recurring contracts.
5. Bill unmatched default-contract work on the client billing schedule, not on default-contract cadence semantics.
6. Support optional historical client billing-cycle bootstrap/backfill from a user-chosen date while preserving invoiced history.
7. Keep behavior safe under multi-contract-per-client, date-effective resolution, and concurrent writes.
8. Make UI language and controls explicit for system-managed default behavior.

## Non-goals

1. No redesign of contract pricing model itself.
2. No new contract authoring UX beyond minimum surfaces needed for visibility/read-only constraints and historical client-cycle bootstrap.
3. No broad billing overhaul unrelated to default-contract routing and client-schedule backfill for unmatched work.
4. No attempt to make the system-managed default contract support recurring fees, contract cadence, or custom line authoring.

## Users and Primary Flows

1. Billing admin configures/updates client billing settings.
2. Technician enters billable time or usage.
3. System auto-resolves work to explicit contract line or system-managed default contract path.
4. If the client has no historical billing cycles for back-dated work, billing admin optionally establishes a historical client billing bootstrap date from the client billing schedule UI.
5. Billing admin generates invoices for unmatched work on the client billing schedule without manual non-contract fallback reconciliation.

## UX / UI Notes

1. Contract lists/detail surfaces show `System-managed default` badge and helper copy.
2. Destructive/manual lifecycle actions for system-managed default contracts are constrained, and authoring surfaces that would make them behave like normal contracts are hidden/disabled.
3. System-managed default contracts do not expose recurring cadence, start/end date, contract-line authoring, pricing-schedule authoring, or service-period management as meaningful editable controls.
4. Time-entry/usage copy uses `system-managed default contract` language instead of `non-contract/default rates`.
5. Automatic invoicing grouped rows distinguish explicit contract work from default-contract work using business labels.
6. Client billing schedule UI may optionally collect a `Billing history start date` on first setup (and controlled edits before invoiced history) to backfill client billing cycles.
7. If required attribution metadata is missing for grouped generation, hard block generation for affected rows.

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
17. System-managed default contracts must not participate in recurring cadence/service-period generation.
18. System-managed default contracts must not allow contract-line authoring, recurring cadence edits, pricing-schedule authoring, or user-managed assignment date edits.
19. Runtime billing for unmatched default-contract work must use the client billing schedule for invoice-window timing.
20. Runtime billing for unmatched default-contract work must use default/service-catalog pricing semantics rather than default-contract-authored recurring lines.
21. Client billing schedule setup must support an optional historical bootstrap date used to generate historical `client_billing_cycles` from the containing billing-cycle boundary through the present.
22. Historical bootstrap date must normalize to the containing client billing-cycle boundary rather than trusting the raw user-entered date as the exact period start.
23. Historical bootstrap/backfill must remain safe under invoiced-history constraints: uninvoiced historical cycles may be rebuilt, but invoiced cycles define the earliest locked boundary.
24. If client billing cycles already exist and none are invoiced, moving the bootstrap earlier must regenerate historical cycles from the newly normalized boundary.
25. If invoiced client cycles already exist, moving the bootstrap earlier than the earliest invoiced cycle start must be blocked with clear UI copy.
26. Manual creation/bootstrap flows and automatic first-time billing-schedule setup must converge on the same cycle-generation rules so client-schedule history stays deterministic.
27. Default-contract invoice history and UI attribution must remain meaningful even though the default contract no longer carries recurrence semantics.

### Non-functional Requirements

1. Deterministic behavior under concurrent write paths (no duplicate default contracts).
2. No cross-tenant leakage.
3. Backward-compatible migration path with nullable new pointers/flags where needed.
4. Idempotent reconciliation jobs/actions.
5. Clear observability logs for ensure/reconcile/route decisions.
6. Historical client billing-cycle bootstrap must be deterministic for the same client/schedule/date inputs.

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
6. Decide whether historical bootstrap date lives in `client_billing_settings`, is derived ad hoc during setup, or is stored only as operational metadata after cycle creation.
7. Ensure client billing-cycle bootstrap uses the same anchor normalization helpers as normal cycle creation so historical cycles and future cycles stay continuous.

## Security / Permissions

1. Only authorized billing/contract roles can view/manage default contract details.
2. System-managed fields are read-only where user edits could break invariants.
3. No privilege escalation through API bypass flows.
4. Historical bootstrap/backfill actions are restricted to billing-schedule management permissions.

## Observability

1. Structured logs for default contract ensure, resolution, and reconciliation outcomes.
2. Metrics/counters (or equivalent trace markers) for:
   - default contract created,
   - default contract reused,
   - unmatched resolved deterministically,
   - unresolved ambiguous still requiring human action.
3. Historical cycle bootstrap/backfill should emit structured markers for:
   - bootstrap requested,
   - normalized bootstrap boundary chosen,
   - historical cycles created/regenerated,
   - bootstrap blocked by invoiced-history boundary.

## Rollout / Migration

1. Hard cutover objective: remove fallback complexity in primary path.
2. Schema/runtime shift: default contract becomes attribution shell, not a recurring contract authority.
3. Schema migration first (nullable-safe) for any new client billing settings bootstrap metadata if persisted.
4. Runtime on-demand ensure enabled behind migration-complete assumption.
5. Reconciliation pass for existing null `contract_line_id` records that have deterministic single match.
6. Clean up UI/API terminology and selection-key parsing after routing cutover is in place.
7. Remove/gate obsolete default-contract recurring/service-period code paths after validation.
8. Roll out historical client-cycle bootstrap behind deterministic invoiced-history guards.

## Execution Order

1. Finalize data/runtime model: system-managed default contract is an attribution shell with no recurrence authority.
2. Implement shared default-contract ensure primitive (idempotent + concurrency-safe).
3. Hook ensure primitive into all billing settings/schedule/cycle-anchor ensure/insert paths.
4. Add client billing-schedule historical bootstrap model and deterministic boundary-normalization rules.
5. Implement historical `client_billing_cycles` bootstrap/regeneration with invoiced-history guardrails.
6. Align resolver contract (`effectiveDate`) and update all save/UI callers.
7. Remove default-contract participation from recurring cadence/service-period generation and authoring flows.
8. Update unmatched-work invoice timing to consume client billing schedule windows plus default/service pricing semantics.
9. Implement billing engine reconciliation write-back for deterministic single-match records.
10. Update due-work collection and invoice generation to consume reconciled/default-contract-aware semantics.
11. Update UI copy/constraints across contract list/detail, time entry banner, automatic invoicing rows, and client billing schedule.
12. Implement deletion and orphan cleanup consistency across package actions + API service paths.
13. Add migrations/tests, run high-impact integration suite, then remove obsolete fallback and default-contract-recurring code paths.

## Open Questions

1. Should default contract creation trigger on every billing-settings ensure event or only on explicit non-null billing configuration states?
2. Should API generic delete be replaced with domain delete orchestration for clients, or should it call the same cleanup primitive?
3. Do we store default-contract pointer on `client_billing_settings` directly, or infer by deterministic query each time?
4. Should historical bootstrap date be persisted as durable client billing metadata, or treated as an operational input that only shapes `client_billing_cycles` creation/regeneration?
5. Should unmatched default-contract work use only service-catalog default pricing, or can other tenant-wide default-pricing rules participate?

## Acceptance Criteria (Definition of Done)

1. For any client with active billing configuration, system can ensure exactly one default contract identity.
2. System-managed default contracts do not act as recurring cadence/service-period authorities and do not expose normal contract authoring flows.
3. New/updated billable time and usage resolve through effective-date-aware resolver, with deterministic assignment when possible.
4. Unmatched default-contract work bills on client billing schedule windows rather than default-contract cadence.
5. Billing admins can optionally define a historical bootstrap date on client billing schedule setup to create historical client billing cycles from the containing boundary through today.
6. Historical bootstrap can be moved earlier only while preserving invoiced-history boundaries; unsafe backward moves are blocked clearly.
7. Invoice due-work no longer surfaces deterministic single-match work as non-contract.
8. Automatic invoicing flow does not depend on legacy non-contract fallback keys for normal operation.
9. UI labels and action constraints reflect system-managed default contract semantics clearly.
10. Client deletion and billing-config cleanup do not leave orphaned default contract assignment artifacts.
11. Test suite covers core creation/routing/reconciliation/cleanup/bootstrap behavior with high-confidence scenarios.
