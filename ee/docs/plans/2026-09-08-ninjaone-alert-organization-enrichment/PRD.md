# NinjaOne alert organization enrichment

## Problem

NinjaOne reconciliation alerts commonly contain a device id but no embedded device object. The poller currently derives `externalOrganizationId` only from that optional object, so organization-scoped alert rules reject otherwise valid newly encountered alerts before the normal ticket pipeline can run.

## Goals

- Enrich newly polled sparse NinjaOne alerts with the external organization realm already stored for their mapped device.
- Preserve provider-supplied organization ids and all existing rule priority, severity, keyword, maintenance, lifecycle, and ticket behavior.
- Keep tenant/provider isolation and fail closed when mapping evidence is absent or ambiguous.
- Perform bounded batched database lookup, not one database or API request per alert.

## Non-goals

- No backfill, replay, status reset, recovery migration, customer rule change, or production mutation.
- No weakening or removal of organization filters.
- No dedup-key, shared renderer, webhook, ticket-creation, polling cadence, or credential changes.
- No inference from `client_id`; multiple external organizations may map to one client.

## Design

Implement provider-specific enrichment in `ee/server/src/lib/integrations/ninjaone/alerts/reconciliationFetcher.ts` after `getAlerts()` and before normalized events are returned.

1. Normalize fetched alerts as today, retaining any explicit `alert.device.organizationId`.
2. Collect unique device ids only for events missing an organization.
3. In one tenant-scoped query, load asset mappings whose `integration_type` is `ninjaone`, `alga_entity_type` is `asset`, and `external_entity_id` is in that device set. Select `external_entity_id` and `external_realm_id`.
4. Group realms per device. Enrich only when exactly one non-empty realm is present. No match, null realm, or multiple distinct realms leaves the event unresolved.
5. Do not overwrite an explicit organization id. Return events in API order and preserve every other normalized field.

The adapter is the correct boundary because the defect is specific to NinjaOne polling payload shape. Shared `processRmmAlertEvent` must continue treating normalized organization identity as authoritative, which avoids changing webhook or other-provider semantics.

## Data and API notes

Use `createTenantKnex`/`tenantDb` and existing mapping columns; no schema migration is required. Tenant scoping is mandatory. Provider and entity-type filters are mandatory. `integrationId` is not represented on the external mapping row, so ambiguity across stored realms must fail closed rather than guessing.

## Acceptance criteria

- A sparse newly polled alert with one tenant/provider-scoped device realm reaches rule evaluation with that organization and can create/link a ticket through the existing pipeline.
- An explicit provider organization remains unchanged.
- Missing, null, or ambiguous device realms remain unresolved and cannot satisfy an organization-scoped rule.
- Same device ids in another tenant or provider cannot supply the realm.
- Multiple alerts are enriched using one bounded lookup and retain input order.
- Redelivery does not create duplicate tickets; pre-existing active/acknowledged rows remain skipped under the forward-only policy.
- Existing organization exclusions, first-match priority, keyword/severity matching, maintenance suppression, lifecycle behavior, and normal ticket creation remain intact.
- Tests exercise the actual sparse payload through normalization/enrichment and include real DB-backed tenant/provider isolation; source-string tests are insufficient.

## Risks and mitigations

- Stale duplicate mappings could select the wrong realm: require one distinct non-empty realm, otherwise leave unresolved.
- Broad shared-pipeline changes could affect other RMM providers: keep enrichment in the NinjaOne polling adapter.
- Large alert batches could produce excessive queries: deduplicate device ids and use one `whereIn` lookup.

## Rollout

Forward-only code rollout. No migration or data repair. Validate locally with focused adapter tests and DB-backed pipeline integration tests, then follow normal PR, CI, merge, and deploy gates.

## Open questions

None blocking. If future schema work adds integration identity to device mappings, ambiguity resolution may be narrowed further; this change deliberately does not invent that association.
