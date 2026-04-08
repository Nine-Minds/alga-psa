# PRD — Tanium RMM Integration Plan

- Slug: `tanium-rmm-integration-plan`
- Date: `2026-04-06`
- Status: Draft

## Summary

Add Tanium as a new RMM provider in Alga PSA, but do it through a shared RMM provider abstraction instead of adding a third bespoke integration stack.

The recommended shape is:

1. introduce a provider registry + normalized sync contracts + shared asset correlation/upsert pipeline
2. implement Tanium v1 as a pull-oriented provider over Tanium Gateway
3. defer optional Connect-backed outbound events and Direct Connect / Threat Response capabilities until after v1 inventory sync is stable

This plan is grounded in both the existing Alga RMM architecture and official Tanium guidance:

- Tanium positions Gateway as the preferred integration surface for querying online/offline systems, managing groups, deploying actions, establishing direct endpoint connections, and inserting/updating Asset records.
- Tanium positions Connect as the best mechanism for scheduled or event-triggered outbound delivery, including webhook-style downstream integrations.
- Tanium positions the Asset API as a useful fallback when endpoints have aged out of TDS.

Sources:

- [Tanium Integration Methods](https://developer.tanium.com/guides/core-platform/integration_methods)
- [Introduction to Tanium APIs](https://developer.tanium.com/apis/api_intro)
- [Tanium Gateway User Guide](https://help.tanium.com/bundle/ug_gateway_cloud/page/gateway/index.html)
- [Using Gateway](https://help.tanium.com/bundle/ug_gateway_cloud/page/gateway/gateway.html)

## Problem

Alga already has two materially different RMM integration shapes:

- NinjaOne is an EE-only, provider-specific stack with dedicated OAuth callback routing, webhook registration, webhook verification, sync strategy, sync engine, Temporal workflow support, and provider-specific UI.
- Tactical RMM is concentrated in a large action surface with a separate webhook route and its own persistence flow.

The persistence layer is already generic enough to support another provider:

- `rmm_integrations`
- `rmm_organization_mappings`
- `rmm_alerts`
- `rmm_alert_rules`
- `tenant_external_entity_mappings`

But the runtime abstraction is missing. Provider selection is hard-coded in the settings UI, middleware public ingress is hard-coded, shared RMM types already leak NinjaOne-specific settings, and the asset sync pipeline is duplicated across providers and execution modes.

If Tanium is added directly on top of the current patterns, Alga will end up with a third provider-specific implementation style and even more duplicated code around:

- auth / connection lifecycle
- organization or scope discovery
- device inventory normalization
- asset correlation and upsert
- webhook or event handling
- sync transport and status handling

## Goals

- Add a shared RMM provider abstraction that can support Tanium without copying either NinjaOne or Tactical RMM.
- Keep `tenant_external_entity_mappings` as the provider-neutral identity backbone for external device-to-Alga asset correlation.
- Implement Tanium v1 as an inventory-focused provider using Tanium Gateway as the primary data source.
- Reuse existing Alga RMM data structures and mapping flows where they are already generic.
- Avoid introducing a Tanium-specific public ingress path in v1 if the integration can be implemented as a pull-oriented provider.
- Record exact Tanium integration-method guidance and schema/API surfaces in the plan artifacts before implementation starts.

## Non-goals

- Rewriting NinjaOne and Tactical RMM completely before Tanium work starts.
- Delivering full multi-source RMM reconciliation across multiple active RMM providers on the same asset.
- Shipping Tanium Connect outbound event delivery in the same first phase as inventory sync.
- Shipping Tanium Direct Connect or Threat Response live remediation in v1.
- Building a generic webhook framework for all integrations before the Tanium inventory adapter exists.

## Users and Primary Flows

### Primary users

- MSP tenant admins configuring RMM integrations
- Alga engineers maintaining and extending the RMM subsystem
- Technicians consuming synced asset state after Tanium inventory arrives in Alga

### Primary flows

1. Tenant admin opens RMM integrations settings and selects Tanium from a registry-driven provider list.
2. Tenant admin enters Tanium connection details and verifies the connection.
3. Tenant admin runs scope discovery and maps Tanium scopes to Alga clients using the shared organization mapping flow.
4. Tenant admin triggers an inventory sync.
5. Alga pulls Tanium endpoint inventory, normalizes it, correlates or creates assets, and stores provider mappings.
6. Technicians see Tanium-managed assets in Alga with cached RMM state populated from the shared asset ingestion pipeline.

## UX / UI Notes

- Replace the hard-coded RMM provider card list with a registry-driven list of provider metadata and capability flags.
- Tanium should have a provider settings surface comparable in outcome to NinjaOne/Tactical but should be built on shared primitives:
  - connection status
  - credential form
  - sync actions
  - shared organization mapping manager
- If Tanium v1 is pull-only, the UI should not expose webhook setup or event-destination configuration.
- Capability-gated sections should be driven by provider metadata rather than provider-specific UI branching.

## Requirements

### Functional Requirements

- Define a shared `RmmProviderAdapter` / registry layer that owns provider identity, capabilities, and entry points for connection, scope discovery, and device sync.
- Introduce normalized provider contracts for:
  - external scope discovery
  - external device snapshots
  - optional event or alert payload normalization
- Extract a shared asset correlation/upsert service that:
  - uses `tenant_external_entity_mappings` as the external identity source of truth
  - creates new assets from normalized device snapshots
  - updates existing assets without creating duplicates
  - updates mapping metadata and sync status
- Introduce Tanium as a new `RmmProvider` with typed provider-specific configuration separated from common settings.
- Implement Tanium auth and query execution against Tanium Gateway as the default path.
- Implement Tanium scope discovery that populates `rmm_organization_mappings`.
- Implement Tanium full inventory sync using the shared normalized sync pipeline.
- Implement an Asset API fallback path only for cases where Gateway/TDS coverage is insufficient for aged-out endpoints.
- Preserve current NinjaOne and Tactical behavior during the transition by wrapping or adapting existing code behind the new provider registry instead of rewriting them in one pass.

### Non-functional Requirements

- Use only officially documented Tanium integration methods and APIs.
- Do not rely on unpublished or inferred Tanium private APIs.
- Keep public route exposure to the minimum required set.
- Do not duplicate business logic between direct and Temporal execution paths for new work.

## Data / API / Integrations

### Existing Alga seams to reuse

- `rmm_integrations` already models one integration row per tenant/provider.
- `rmm_organization_mappings` already models provider scope to Alga client mapping.
- `tenant_external_entity_mappings` is the most important provider-neutral seam for asset correlation.
- `assets`, `workstation_assets`, and `server_assets` already contain cached RMM fields that can be populated from normalized device snapshots.

### Existing Alga seams to replace or wrap

- Hard-coded provider selection in `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`
- Hard-coded public route allowlist in `server/src/middleware.ts`
- NinjaOne-specific sync transport interface in `ee/server/src/lib/integrations/ninjaone/sync/syncStrategy.ts`
- Duplicated provider-specific asset upsert logic in NinjaOne sync engine, NinjaOne Temporal activities, and Tactical RMM actions

### Tanium integration strategy

- Use Tanium Gateway as the primary integration surface.
  - Official guidance says Gateway is preferred for querying online and offline systems, managing groups, deploying actions, establishing direct endpoint connections, and inserting/updating Asset records.
- Treat Tanium Connect as an optional, later capability for scheduled or event-triggered outbound delivery to downstream systems.
  - Official guidance says Connect is suitable for webhook/file/syslog/common destinations and can be triggered by detected events such as Threat Response alerts.
- Treat the Asset API as a fallback path for endpoints that have aged out of TDS.
- Treat Threat Response REST and Direct Connect as specialized, later capability surfaces rather than v1 inventory requirements.

### Ground-truth schema work required before implementation

Before writing the Tanium adapter, the implementation spike must record the exact Gateway schema names for:

- endpoint inventory query surface
- scope / group ownership surface
- action / mutation surface
- Direct Connect surface
- any schema objects needed for aged-out endpoint fallback decisioning

If programmatic Connect destination or job provisioning is required later, the spike must also record the exact official Connect management surface and whether it is documented for external integrations.

### Captured Gateway schema decisions

- Inventory should be Gateway-first on the `endpoints` query family, with normalized device snapshots sourced from the `Endpoint` object family (`Endpoint`, `EndpointOS`, `EndpointUser`, `EndpointInstalledApplication`, `EndpointMetric`, and related connection/edge types as needed).
- Scope discovery should be Gateway-first on `computerGroup` / `computerGroups`, with `ComputerGroup` as the current best candidate for feeding `rmm_organization_mappings`.
- Gateway action, scheduled-action, Connect, and Direct Connect surfaces are confirmed to exist (`actionPerform`, `scheduledActionCreate`, `connectConnectionStart`, `directConnectOpen`, and related types), but they remain explicitly deferred capability flags rather than Tanium v1 requirements.
- Asset fallback remains narrow: use Tanium Asset API only when endpoint coverage in Gateway/TDS is insufficient for aged-out endpoints; Tanium Gateway `assetUpsertEndpoints` is a documented write surface, not the default read path for Alga inventory sync.

## Security / Permissions

- Tanium should follow the same tenant-level secret storage model used by existing RMM providers.
- The integration should remain Enterprise / tier gated in line with existing advanced asset integration behavior.
- The plan assumes least-privilege Tanium personas and permissions.
  - Official Tanium Gateway guidance documents persona-based permission scoping and explicitly describes a read-only persona model for query-only use.
- v1 should avoid adding public callback or webhook routes unless a later event-delivery feature actually needs them.

## Observability

- Reuse existing integration sync status fields in `rmm_integrations`.
- Reuse existing integration and sync event publication patterns where already present.
- Do not add a separate observability subsystem as part of this work.

## Rollout / Migration

### Phase 0: plan spike

- Record exact Tanium Gateway schema surfaces from the logged-in documentation/query explorer.
- Confirm exact Tanium connection/auth requirements for the tenant-facing setup form.

### Phase 1: abstraction first

- Add provider registry and normalized contracts.
- Extract shared asset correlation/upsert logic.
- Make the settings selector registry-driven.

### Phase 2: Tanium inventory v1

- Add Tanium connection flow.
- Add Tanium scope discovery and mapping.
- Add Tanium full inventory sync over Gateway.
- Add Asset API fallback only where Gateway coverage is insufficient.

### Phase 3: optional later capabilities

- Connect-backed outbound event delivery
- Direct Connect / Threat Response capability-gated actions
- broader migration of legacy providers onto the shared abstraction

## Open Questions

- Does Alga need Tanium to support incremental or single-device sync in v1, or is full inventory sync sufficient for the first cut?
- Does `ComputerGroup` map cleanly enough to tenant/client ownership for MSP use, or do we need a provider-specific scope-normalization layer on top of Tanium groups?
- Is there an officially supported external API for provisioning Connect destinations/jobs, or should event delivery remain console-configured if pursued later?
- What is the minimum Tanium persona/permission set needed for Alga’s intended v1 sync behavior?
- Which concrete `Endpoint` fields should become part of Alga’s normalized device snapshot contract for the first adapter cut?

## Acceptance Criteria (Definition of Done)

- A shared RMM provider abstraction exists and Tanium is added through it instead of as a third bespoke stack.
- The Tanium plan records the official Gateway/Connect/Asset positioning and the exact schema/API surfaces required for implementation.
- RMM settings UI is no longer hard-coded to Tanium/NinjaOne/Tactical-specific card logic.
- A shared asset correlation/upsert service exists for normalized RMM device snapshots and uses `tenant_external_entity_mappings`.
- Tanium can connect, discover scopes, map scopes to clients, and run a full inventory sync that creates or updates assets.
- Asset API fallback is used only for documented fallback cases, not as the primary Tanium integration surface.
- Existing NinjaOne and Tactical RMM behavior remains operable during the transition.
