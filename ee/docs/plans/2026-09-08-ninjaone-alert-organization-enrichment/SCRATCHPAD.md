# Scratchpad

## Durable decisions

- Scope is forward-only per captain decision: no replay/backfill of existing active alerts.
- Fix the provider-specific sparse polling shape in the NinjaOne reconciliation adapter; do not weaken shared rule evaluation.
- Use tenant-scoped `tenant_external_entity_mappings` filtered by `integration_type=ninjaone` and `alga_entity_type=asset`.
- `external_realm_id` is the stored external organization identity. Enrich only a single distinct non-empty realm; ambiguity fails closed.
- Preserve explicit provider organization identity and never infer from `client_id`.

## Code map

- `ee/server/src/lib/integrations/ninjaone/alerts/reconciliationFetcher.ts`: fetch and normalization boundary; enrichment added here (was reading only `alert.device?.organizationId`).
- `shared/rmm/alerts/processRmmAlertEvent.ts`: maps device to asset/client and evaluates the original normalized event; duplicate handling preserved.
- `shared/rmm/alerts/ruleEvaluator.ts`: organization condition; not modified.
- `shared/rmm/sharedAssetIngestionService.ts`: confirms asset mapping identity and `external_realm_id` conventions.
- `ee/server/src/__tests__/integration/ninjaoneAlertOrganizationEnrichment.integration.test.ts`: DB-backed coverage for sparse normalization/enrichment, ticket pipeline, isolation, forward-only guard, and lifecycle regressions (uses the real fetcher with only the NinjaOne HTTP client mocked).
- `ee/server/src/__tests__/integration/rmmAlertPipeline.integration.test.ts`: pre-existing DB-backed alert behavior and reconciliation coverage.

## Verification

Draft implementation (commit on `feature/fix-organization-matching-for-new-ninjaone-alert`):

- Adapter + pipeline integration suite `ninjaoneAlertOrganizationEnrichment.integration.test.ts`: 17 passing, including:
  - Sparse payload normalization → enrichment → `runRmmAlertReconciliation` creates/links a ticket on the configured board/assignee for a freshly encountered alert (T004).
  - Explicit provider org preserved; missing/null/ambiguous/cross-provider/cross-tenant realms fail closed (T001-T003, T005).
  - Forward-only guard runs under a live org-500 rule with valid device/asset mappings: pre-existing active and acknowledged rows without tickets remain skipped (their redelivered sparse payloads are enriched) while a fresh alert on a separate device creates a ticket under the same configuration (T006).
  - Redelivery of an active alert creates no duplicate; per-condition repeat firings append to the open ticket (T007).
  - Organization exclusions (orgs 6 and 7), first-match keyword/severity priority, maintenance-window suppression + reprocess after window end, resolved re-trigger under a NEW external id, and resolved re-trigger under the SAME external id (reopens a ticket on the same `rmm_alerts` row, then redelivery is skipped) (T008).
- Regression: `rmmAlertPipeline.integration.test.ts` still passes (22 tests); ee NinjaOne unit/contract tests and the jobs `rmmAlertPollingHandlers` tenant-scoped contract test pass; `ee/server` typecheck (`tsc --noEmit`) passes; eslint reports no errors (only non-null-assertion warnings consistent with the pre-existing pipeline test).
- No production mutation, credential reconnect, polling-schedule change, migration, or data rewrite.

## Gotchas

- Root `package-lock.json` was already modified before planning; preserve it and exclude it from this work.
- Mapping rows do not carry `integration_id`; multiple distinct realms for one tenant/provider/device must remain unresolved.
- Polling and background-worker deployment color can differ from the active web color; this plan does not alter job routing.
- DB-recreating integration test files drop/recreate the shared `test_database`; run them individually (running several in one vitest invocation tears down the shared DB mid-run).
- Vitest shuffles top-level suites between runs; shared rule/mapping fixtures for a tenant are seeded at file level so suites are order-independent.
