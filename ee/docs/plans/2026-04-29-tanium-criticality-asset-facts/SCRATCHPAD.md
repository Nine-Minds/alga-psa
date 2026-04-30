# Scratchpad — Tanium Criticality Asset Facts

- Plan slug: `tanium-criticality-asset-facts`
- Created: `2026-04-29`

## What This Is

Working notes for adding CE asset facts and using them as the Tanium criticality display/persistence surface.

## Decisions

- (2026-04-29) Use the term `facts` for asset metadata that is observed/synced from a provider or system. Rationale: it avoids implying a full custom-fields platform while preserving a path to queryable workflow/AI/filtering consumers.
- (2026-04-29) Put the generic `asset_facts` data structure in CE/base migrations, not EE-only. Rationale: integrations can remain feature-gated, but the neutral data primitive should be available broadly.
- (2026-04-29) Keep Tanium criticality provider-sourced and read-only for day one. Do not promote it to a first-class Alga asset column yet.
- (2026-04-29) Fetch Tanium criticality separately from the main endpoint inventory query. Rationale: Gateway returns errors when a requested sensor is unavailable, and missing Criticality content-set access should not break normal inventory sync.
- (2026-04-29) Use Tanium `Endpoint Criticality with Level`, not just `Endpoint Criticality`, because Alga needs display text in addition to any numeric multiplier.
- (2026-04-29) If global criticality enrichment fails for a scope, leave existing facts untouched. If an endpoint explicitly returns no result, mark that endpoint fact unavailable and preserve raw metadata.
- (2026-04-29) Day-one UI should only display an available Tanium Criticality fact; no generic editable custom/facts UI in this phase.

## Discoveries / Constraints

- (2026-04-29) Existing Tanium sync already has a best-effort separate sensor enrichment pattern for `Last Reboot` in `ee/server/src/lib/integrations/tanium/taniumGatewayClient.ts`.
- (2026-04-29) Existing shared RMM ingestion returns `assetId` for created/updated assets, which is the right point to upsert facts.
- (2026-04-29) Existing normalized RMM extension fields and `system_info` are useful for raw provider metadata, but are not a good long-term query surface for workflows/AI/filtering.
- (2026-04-29) Tanium developer docs browser pane `a4169d08-2203-48d1-8845-330185626c87` showed `Endpoint Criticality` and `Endpoint Criticality with Level` in Sensor Inventory, not as first-class `Endpoint` GraphQL fields.
- (2026-04-29) Tanium Sensor Inventory details found:
  - `Endpoint Criticality`: Criticality virtual sensor. Returns number of endpoints with each criticality. Multipliers: Low = 1, Medium = 1.33, High = 1.67, Critical = 2.
  - `Endpoint Criticality with Level`: Criticality virtual sensor. Returns number of endpoints with each endpoint criticality value and text.
- (2026-04-29) Gateway schema supports arbitrary endpoint sensor reads through `Endpoint.sensorReading(sensor: EndpointSensorRef!)` and `Endpoint.sensorReadings(sensors: [EndpointSensorRef!]!)`.
- (2026-04-29) Gateway docs say `sensorReading` returns raw `values` and can return `floatValues` for numeric/integer conversion. For multi-column sensors, `sensorReading` requires exactly one column; `sensorReadings` should be used for multiple sensors/columns.
- (2026-04-29) Gateway docs say unavailable sensors return query errors, reinforcing the separate best-effort enrichment design.

## Commands / Runbooks

- (2026-04-29) Scaffold plan:
  - `python3 /Users/roberisaacs/.agents/skills/alga-plan/scripts/scaffold_plan.py --slug tanium-criticality-asset-facts "Tanium Criticality Asset Facts"`
- (2026-04-29) Inspect Tanium docs browser URL/content:
  - `alga-dev browser-get-url --paneId=a4169d08-2203-48d1-8845-330185626c87 --pretty`
  - `alga-dev browser-eval --paneId=a4169d08-2203-48d1-8845-330185626c87 --script='(() => ({title: document.title, url: location.href, text: (document.body.innerText || "").slice(0, 12000)}))()'`
- (2026-04-29) Fetch Gateway schema text from authenticated browser pane:
  - `alga-dev browser-eval --paneId=a4169d08-2203-48d1-8845-330185626c87 --script='(async () => (await fetch("/_spec-gql/apis/tanium_gateway_schema.graphql?download")).text())()'`
- (2026-04-29) Fetch Sensor Inventory page data from authenticated browser pane:
  - `alga-dev browser-eval --paneId=a4169d08-2203-48d1-8845-330185626c87 --script='(async () => fetch("/page-data/sensor-inventory/sensor_list/data.json").then(r=>r.json()))()'`

## Links / References

- Tanium docs page used: `https://developer.tanium.com/apis/api_intro`
- Tanium Gateway schema download path in authenticated browser: `/_spec-gql/apis/tanium_gateway_schema.graphql?download`
- Tanium Sensor Inventory page data: `/page-data/sensor-inventory/sensor_list/data.json`
- Existing Tanium client: `ee/server/src/lib/integrations/tanium/taniumGatewayClient.ts`
- Existing Tanium actions/sync: `ee/server/src/lib/actions/integrations/taniumActions.ts`
- Shared RMM contracts: `packages/integrations/src/lib/rmm/contracts.ts`
- Shared RMM ingestion: `packages/integrations/src/lib/rmm/sharedAssetIngestionService.ts`
- Prior design reference: `ee/docs/plans/2026-04-15-tanium-asset-enrichment-design.md`
- Tanium integration plan reference: `ee/docs/plans/2026-04-06-tanium-rmm-integration-plan/`

## Open Questions

- What exact columns does `Endpoint Criticality with Level` return in customer tenants? Implementation should preserve raw columns and parse defensively.
- Should future facts uniqueness include `integration_id` to support multiple providers/instances publishing same namespace/key for one asset? V1 plan uses one current fact per asset/source_type/namespace/key.
- Should unavailable facts be exposed in a future admin/debug panel? Day one hides unavailable facts from primary asset detail.

## Implementation Updates

- (2026-04-29) Implemented CE/base migration `server/migrations/20260429133000_create_asset_facts_table.cjs` for `asset_facts` with:
  - tenant-aware PK (`tenant`, `asset_fact_id`),
  - tenant+asset FK to `assets`,
  - typed value columns + raw `value_json`,
  - availability + sync/source timestamps,
  - uniqueness on (`tenant`, `asset_id`, `source_type`, `namespace`, `fact_key`).
  Rationale: provides a neutral, queryable fact primitive while preserving Citus tenant key patterns.

- (2026-04-29) Added shared asset fact typing and service:
  - `AssetFact` and `AssetFactSourceType` in `packages/types/src/interfaces/asset.interfaces.ts`.
  - `server/src/lib/assets/assetFactsService.ts` with `upsertAssetFact(...)` and `listAvailableAssetFactsForAsset(...)`.
  Rationale: central reusable read/upsert behavior for provider-sourced facts with tenant+asset scoping.

- (2026-04-29) Extended Tanium Gateway client (`ee/server/src/lib/integrations/tanium/taniumGatewayClient.ts`):
  - Added metadata lookup for `Endpoint Criticality with Level`.
  - Added paginated endpoint criticality sensor reading query via `sensorReadings`.
  - Added defensive parser that preserves raw columns, maps known labels to multipliers, and tolerates unknown columns.

- (2026-04-29) Integrated best-effort criticality enrichment into `triggerTaniumFullSync` (`ee/server/src/lib/actions/integrations/taniumActions.ts`):
  - Criticality query runs separately from endpoint inventory query.
  - Global criticality failure logs warning and does not fail full sync.
  - Existing facts remain untouched on global failure.
  - For successful criticality query, endpoint with explicit no result is upserted unavailable.
  - Criticality fact upsert happens only after ingestion returns `assetId`.
  - Fact shape stored with `source_type=integration`, `provider=tanium`, `namespace=tanium`, `fact_key=criticality`, source metadata for sensor.

- (2026-04-29) Added asset detail facts read path:
  - `getAvailableAssetFacts(asset_id)` in `packages/assets/src/actions/assetActions.ts` with tenant-scoped auth checks.
  - `useAssetDetail` now loads facts.

- (2026-04-29) Added Tanium criticality UI rendering on asset detail (`packages/assets/src/components/panels/RmmVitalsPanel.tsx`):
  - Shows `Tanium Criticality` only when available Tanium criticality fact exists.
  - Known labels map to compact badge variants (`Low/Medium/High/Critical`).
  - Missing/unavailable facts are hidden.

## Test Updates

- (2026-04-29) Added/updated tests:
  - `ee/server/src/__tests__/unit/integrations/taniumGatewayClient.test.ts`
    - endpoint criticality parse coverage (known + unknown columns).
  - `ee/server/src/__tests__/unit/integrations/taniumActions.test.ts`
    - criticality enrichment isolation from sync failure,
    - upsert only when `assetId` exists,
    - leave existing facts untouched on global criticality failure.
  - `packages/assets/src/components/panels/RmmVitalsPanel.test.tsx`
    - renders Tanium criticality only when available fact exists.

- (2026-04-29) Verification commands:
  - `npx nx test sebastian-ee -- --run src/__tests__/unit/integrations/taniumGatewayClient.test.ts src/__tests__/unit/integrations/taniumActions.test.ts` (pass)
  - `npx nx test @alga-psa/assets -- --run src/components/panels/RmmVitalsPanel.test.tsx --reporter=verbose` (our panel tests pass; suite still reports pre-existing unrelated failures in `QuickAddAsset.quick-add-client.contract.test.ts` and `CreateTicketFromAssetButton.boardScopedStatuses.test.tsx`).

## Gotchas

- (2026-04-29) EE action tests use `withAuth` wrappers directly; test invocations must pass explicit `(user, { tenant })` args.
- (2026-04-29) Asset package targeted test runs currently include additional files in this workspace, exposing unrelated baseline failures outside this change.
- (2026-04-29) Added `server/src/test/unit/assets/assetFactsService.test.ts` to cover T001/T002/T003 service behaviors:
  - tenant-scoped insert/read,
  - uniqueness/upsert semantics for current fact key,
  - explicit unavailable upsert preserving raw metadata.
- (2026-04-29) Verification command:
  - `cd server && npx vitest run src/test/unit/assets/assetFactsService.test.ts` (pass)
