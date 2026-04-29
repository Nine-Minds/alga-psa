# PRD — Tanium Criticality Asset Facts

- Slug: `tanium-criticality-asset-facts`
- Date: `2026-04-29`
- Status: Draft

## Summary

Add a small, generic Asset Facts data model in CE and use it as the day-one persistence/display surface for Tanium endpoint criticality in EE.

Tanium exposes endpoint criticality through Gateway endpoint sensor readings, not as a first-class `Endpoint` GraphQL field. Alga should fetch the Tanium `Endpoint Criticality with Level` virtual sensor as a best-effort enrichment during Tanium inventory sync, persist the parsed result as a provider-sourced asset fact, and display it on Tanium-synced asset detail pages.

The first release is display-focused. The data model must remain queryable and neutral enough to support later asset filtering, workflow predicates, AI context, and possible future user-defined fields without requiring a rewrite.

## Problem

Tanium has a device criticality concept that can change how endpoints are handled operationally. Alga currently has no universal asset criticality concept and no generic custom-field/fact model for integration-sourced asset metadata.

A purely Tanium-specific UI-only implementation would satisfy immediate display needs but would work against later goals:

- asset filtering by criticality,
- workflow conditions such as “Tanium criticality is High or Critical,”
- AI-assisted queries over endpoint posture,
- a broader custom/facts model for asset metadata.

At the same time, building a full custom-fields platform now is too much scope for the first Tanium criticality release.

## Goals

1. Create a CE/base `asset_facts` data structure for provider/system/manual facts about assets.
2. Keep Tanium criticality provider-sourced and read-only in day one.
3. Fetch Tanium criticality through Gateway `Endpoint Criticality with Level` sensor readings.
4. Keep the criticality fetch best-effort so missing Tanium Criticality permissions do not break inventory sync.
5. Persist the parsed display value and raw Tanium sensor response in a queryable fact row.
6. Display Tanium criticality on asset detail pages when an available fact exists.
7. Preserve a clean path to future filtering, workflow, AI, and custom-field-like usage.

## Non-goals

- Build generic user-editable custom fields.
- Add workflow predicates over asset facts in this phase.
- Add AI tools or agent context retrieval for asset facts in this phase.
- Add asset list filtering by facts in this phase.
- Add Tanium write-back based on Alga state.
- Add manual editing of provider-sourced facts.
- Treat Tanium criticality as an Alga-native first-class asset column.

## Users and Primary Flows

### MSP technician viewing an asset

1. Technician opens a Tanium-synced asset detail page.
2. Alga displays the usual RMM/Tanium-enriched asset data.
3. If Tanium criticality is available, Alga shows a compact Tanium Criticality indicator, such as `Tanium Criticality: High`.
4. If no criticality fact is available, the page remains clean and does not show an empty placeholder.

### Admin running Tanium sync

1. Admin runs Tanium full inventory sync from RMM integration settings.
2. Alga fetches endpoint inventory as it does today.
3. Alga separately attempts to fetch Tanium `Endpoint Criticality with Level` readings for the same mapped scopes.
4. Inventory sync succeeds even if criticality readings fail due to content-set/RBAC availability.
5. Where readings are available, Alga upserts asset facts after assets are mapped/created.

### Future consumer: filters/workflows/AI

Not in day-one UI scope, but later consumers should be able to query asset facts directly instead of scraping provider JSON from `system_info`.

## UX / UI Notes

Day-one UI should be intentionally modest:

- Render a provider-sourced fact area or small provider badge/card only when available facts exist.
- Known Tanium renderer:
  - Label: `Tanium Criticality`
  - Value: `Low`, `Medium`, `High`, or `Critical`
- Use theme-aware badge/status styling.
- If only a numeric multiplier is available, display the multiplier in a neutral form.
- Hide unavailable facts from the primary asset detail surface.
- Do not introduce a generic editable facts/custom-fields UI in this phase.

## Requirements

### Functional Requirements

1. Add a CE/base migration for an `asset_facts` table.
2. Add a reusable server-side helper/service to upsert provider-sourced asset facts.
3. Add a Tanium Gateway client method to discover/verify the `Endpoint Criticality with Level` sensor metadata when needed.
4. Add a Tanium Gateway client method to query endpoint criticality readings by optional computer group filter.
5. Parse Tanium criticality values into a normalized fact shape:
   - display text where available,
   - numeric multiplier where available,
   - raw sensor columns/values in JSON.
6. Run the criticality query separately from the main endpoint inventory query.
7. Continue Tanium inventory sync when the criticality query fails globally.
8. Upsert an available criticality fact after shared RMM ingestion returns an asset id.
9. Mark an endpoint-specific criticality fact unavailable when Tanium explicitly returns no result for that endpoint.
10. Leave existing facts untouched when the entire criticality query fails for a scope.
11. Add asset detail loading for available asset facts.
12. Render Tanium criticality on asset detail pages when the fact exists and is available.

### Non-functional Requirements

1. The `asset_facts` table must follow tenant/Citus conventions, including tenant in primary/unique indexes and query predicates.
2. Provider-sourced facts must be read-only from UI surfaces in this phase.
3. Criticality enrichment must not materially increase Tanium sync fragility.
4. Raw provider data must be preserved for traceability without forcing UI consumers to parse it.
5. The implementation must not require EE-only schema for the generic facts table.

## Data / API / Integrations

### CE data model

Create a CE/base table, tentatively named `asset_facts`:

```text
asset_fact_id uuid
tenant uuid
asset_id uuid
source_type text          -- integration | manual | system; v1 uses integration
provider text             -- nullable; tanium for this use case
integration_id uuid       -- nullable; RMM integration id where applicable
namespace text            -- tanium, alga, ninjaone, etc.
fact_key text             -- criticality
label text                -- Criticality
value_text text           -- High / Critical / Medium / Low
value_number numeric      -- 1.67 / 2 / 1.33 / 1
value_bool boolean        -- future use
value_json jsonb          -- raw/structured source value
source text               -- tanium.gateway.sensor.Endpoint Criticality with Level
source_updated_at timestamptz nullable
last_synced_at timestamptz nullable
is_available boolean
created_at timestamptz
updated_at timestamptz
```

Practical uniqueness for v1:

```text
unique (tenant, asset_id, source_type, namespace, fact_key)
```

For Tanium criticality:

```text
source_type: integration
provider: tanium
namespace: tanium
fact_key: criticality
label: Criticality
value_text: High
value_number: 1.67
value_json: {
  sensorName: "Endpoint Criticality with Level",
  columns: [...],
  rawValues: [...]
}
source: "tanium.gateway.sensor.Endpoint Criticality with Level"
is_available: true
```

### Tanium Gateway

Docs findings:

- `Endpoint Criticality with Level` is a Criticality virtual sensor.
- It returns endpoint criticality value and text.
- Gateway supports arbitrary endpoint sensor reads through:
  - `Endpoint.sensorReading(sensor: EndpointSensorRef!): EndpointSensorReading`
  - `Endpoint.sensorReadings(sensors: [EndpointSensorRef!]!): EndpointSensorReadings!`
- If a sensor is unavailable from the data source, Gateway returns an error.

Recommended criticality query shape:

```graphql
query TaniumEndpointCriticality(
  $first: Int!
  $after: Cursor
  $filter: EndpointFieldFilter
) {
  endpoints(first: $first, after: $after, filter: $filter) {
    edges {
      node {
        id
        criticality: sensorReadings(
          sensors: [
            { name: "Endpoint Criticality with Level" }
          ]
        ) {
          columns {
            name
            values
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

Optional metadata verification query:

```graphql
query TaniumCriticalitySensorMetadata {
  sensors(
    first: 10
    filter: {
      path: "name"
      op: EQ
      value: "Endpoint Criticality with Level"
    }
  ) {
    edges {
      node {
        name
        description
        valueType
        virtual
        harvested
        contentSetName
        columns {
          name
          valueType
          hidden
        }
      }
    }
  }
}
```

## Security / Permissions

- Tanium settings and sync actions continue to use existing `withAuth`, RBAC, and `ADVANCED_ASSETS` tier gating.
- The `asset_facts` table exists in CE, but Tanium fact production remains gated by the existing EE Tanium integration feature/tier controls.
- Asset fact reads should respect existing asset access patterns and tenant filtering.
- Provider-sourced facts are not user-editable in this phase.

## Observability

- Log a warning when Tanium criticality enrichment fails globally for a scope.
- Do not mark the whole Tanium inventory sync as failed solely due to criticality enrichment failure.
- Preserve raw sensor response in `value_json` for later debugging.

No new metrics/monitoring work is required for this phase.

## Rollout / Migration

1. Add CE/base migration for `asset_facts`.
2. Existing tenants receive an empty table; no backfill is required.
3. Tanium facts are populated on the next full Tanium inventory sync.
4. If the UI deploys before facts exist, no empty criticality section is shown.
5. Existing `system_info` storage remains unchanged and can continue carrying raw provider metadata.

## Open Questions

1. What exact column names does each Tanium tenant return for `Endpoint Criticality with Level`? Implementation should discover/preserve raw columns and parse defensively.
2. Should unavailable facts be shown in any diagnostic/admin-only UI later? Day one hides them from primary asset detail.
3. Should future fact uniqueness distinguish multiple integrations of the same namespace for one asset? V1 assumes one current fact per asset/source_type/namespace/key.

## Acceptance Criteria (Definition of Done)

1. CE/base migrations create and rollback `asset_facts` successfully.
2. Tanium full sync continues to ingest assets if criticality sensor access fails.
3. Tanium full sync upserts `asset_facts` rows for endpoints with criticality readings.
4. Tanium criticality facts preserve both normalized display data and raw Tanium sensor values.
5. Explicit per-endpoint no-result values mark facts unavailable without deleting raw traceability.
6. Asset detail displays Tanium criticality when an available Tanium criticality fact exists.
7. Asset detail hides unavailable/missing criticality facts.
8. Unit/integration tests cover Gateway parsing, fact upsert behavior, sync failure isolation, and UI rendering.
