# Scratchpad

## Durable decisions

- Scope is forward-only per captain decision: no replay/backfill of existing active alerts.
- Fix the provider-specific sparse polling shape in the NinjaOne reconciliation adapter; do not weaken shared rule evaluation.
- Use tenant-scoped `tenant_external_entity_mappings` filtered by `integration_type=ninjaone` and `alga_entity_type=asset`.
- `external_realm_id` is the stored external organization identity. Enrich only a single distinct non-empty realm; ambiguity fails closed.
- Preserve explicit provider organization identity and never infer from `client_id`.

## Code map

- `ee/server/src/lib/integrations/ninjaone/alerts/reconciliationFetcher.ts`: fetch and normalization boundary; currently reads only `alert.device?.organizationId`.
- `shared/rmm/alerts/processRmmAlertEvent.ts`: maps device to asset/client and evaluates the original normalized event; preserve duplicate handling.
- `shared/rmm/alerts/ruleEvaluator.ts`: correct organization condition; do not modify.
- `shared/rmm/sharedAssetIngestionService.ts`: confirms asset mapping identity and `external_realm_id` conventions.
- `ee/server/src/__tests__/integration/rmmAlertPipeline.integration.test.ts`: DB-backed alert behavior and reconciliation coverage.

## Gotchas

- Root `package-lock.json` was already modified before planning; preserve it and exclude it from this work.
- Mapping rows do not carry `integration_id`; multiple distinct realms for one tenant/provider/device must remain unresolved.
- Polling and background-worker deployment color can differ from the active web color; this plan does not alter job routing.
