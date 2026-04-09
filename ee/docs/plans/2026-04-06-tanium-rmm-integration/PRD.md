# PRD — Tanium RMM Integration

- Slug: `tanium-rmm-integration`
- Date: `2026-04-06`
- Status: Draft

## Summary

Add Tanium as a new RMM integration in Alga PSA without creating a third bespoke provider stack.

The work should introduce a provider-neutral RMM adapter and shared ingestion path, then implement Tanium against that contract. Tanium v1 should prioritize inventory and scope mapping using Tanium Gateway as the preferred API surface, with module REST APIs used only for documented gaps. Event push and remote response are explicitly secondary capabilities.

## Problem

The current RMM integration model is split between two provider-specific implementations:

- NinjaOne is a full EE-only stack with OAuth callback handling, webhook registration, provider-specific sync orchestration, and duplicated sync logic across server and Temporal paths.
- Tactical RMM keeps most lifecycle and persistence logic in one large actions file with a separate webhook route and duplicated single-agent sync logic.

The repo has generic persistence tables such as `rmm_integrations`, `rmm_organization_mappings`, `rmm_alerts`, and `tenant_external_entity_mappings`, but it does not have a provider runtime contract. If Tanium is added directly today, it will become a third custom stack and deepen divergence across auth, sync, event handling, and UI.

On the Tanium side, official guidance is clear that Tanium Gateway is the preferred integration method, with module REST APIs reserved for gaps. That means Alga should not start from a provider-specific REST-first design.

## Goals

- Add a concrete, documented plan for Tanium RMM support grounded in official Tanium guidance and the existing Alga architecture.
- Introduce a shared RMM provider abstraction that can support Tanium, NinjaOne, and Tactical without forcing identical auth or transport models.
- Use `tenant_external_entity_mappings` as the canonical external identity backbone for device-to-asset correlation.
- Deliver a Tanium v1 scope centered on:
  - Tanium connection/configuration
  - external scope discovery and mapping to Alga clients
  - device inventory sync into Alga assets
  - capability-driven UI that does not assume all providers support webhooks, alerts, or remote access
- Capture exact Tanium schema/API unknowns up front so implementation is based on verified surfaces instead of assumptions.

## Non-goals

- Do not implement the full long-term multi-source asset data architecture from `ee/docs/plans/rmm-data-architecture.md` as part of this initial Tanium effort.
- Do not require Tanium v1 to ship alerts, ticket automation, remote shell, or remediation actions.
- Do not force Tanium to match NinjaOne’s webhook/callback lifecycle if Tanium’s preferred model is push-via-Connect or pull-only sync.
- Do not redesign all existing RMM UI flows at once beyond what is necessary to support a provider registry and capability-driven rendering.
- Do not add new observability, rollout, or feature-flag systems beyond reusing existing RMM/workflow events unless later requested.

## Users and Primary Flows

### MSP Admin

- Opens Settings > Integrations > RMM and selects Tanium from the provider list.
- Saves Tanium credentials/configuration.
- Verifies Tanium connection health and supported capabilities.
- Syncs Tanium scopes and maps them to Alga clients.
- Triggers a full Tanium device sync and sees normalized status/errors.

### Technician / Dispatcher

- Views Tanium-sourced devices as standard Alga assets.
- Sees synced device state without needing to know whether the source was Gateway or a module API fallback.

### Platform Engineer

- Adds a new provider by implementing a provider adapter and registering capabilities instead of building a one-off stack.

## UX / UI Notes

- Replace the hard-coded RMM provider selector with a registry-driven list that renders cards and settings screens from provider descriptors.
- Each provider exposes capability flags such as:
  - `supportsScopeSync`
  - `supportsInventorySync`
  - `supportsEvents`
  - `supportsAlerts`
  - `supportsRemoteAccess`
  - `supportsManagedWebhookRegistration`
- The Tanium settings screen should be explicit about v1 scope:
  - inventory sync supported
  - scope mapping supported
  - events/alerts/remote access shown only if the provider reports support
- Do not show NinjaOne-specific language such as “region” or “webhook registration” in shared RMM scaffolding.

## Requirements

### Functional Requirements

1. Define a provider-neutral RMM runtime contract, tentatively `RmmProviderAdapter`, with capability metadata and methods for:
   - connection status
   - connect / disconnect
   - scope discovery
   - full device sync
   - single-device sync or targeted refresh where supported
   - optional event normalization
   - optional remote access/action resolution
2. Introduce a provider registry so the settings UI and server-side entrypoints can resolve providers by identifier instead of hard-coded switches.
3. Extract shared asset correlation and upsert behavior into a provider-neutral ingestion service that:
   - resolves existing external mappings from `tenant_external_entity_mappings`
   - creates or updates `assets` and extension rows
   - maintains `rmm_*` asset fields
   - updates external mapping metadata and sync timestamps
4. Extract shared scope mapping behavior so provider adapters only normalize Tanium/NinjaOne/Tactical scope records into a common shape.
5. Preserve direct and Temporal execution as transport choices, but move provider business logic behind the shared sync contract so the same core ingestion path can be reused.
6. Add Tanium as a valid RMM provider type in shared types and persistence code.
7. Implement Tanium configuration persistence and connection status handling without assuming OAuth if Tanium’s deployed auth model differs.
8. Implement a Tanium client/query layer that prefers Gateway and uses documented module REST APIs only for verified gaps.
9. Support Tanium scope discovery and persistence into `rmm_organization_mappings`.
10. Support Tanium full device inventory sync into Alga assets for mapped scopes.
11. Support a documented and explicit fallback strategy for aged-out endpoint inventory when Gateway/TDS data is insufficient and Asset API is the correct documented source.
12. Keep Tanium event ingestion optional in v1. If an event path is supported, represent it as a provider capability instead of assuming a NinjaOne-style public webhook route.
13. Preserve current NinjaOne and Tactical user-visible behavior while wrapping or adapting them to the new shared seams incrementally.
14. Document Tanium schema/API findings in the plan scratchpad and PRD so implementation uses verified fields and not guessed models.

### Non-functional Requirements

- Shared RMM abstractions must be additive and permit gradual migration of existing providers.
- Provider-specific settings must move toward typed config instead of further expanding a loose shared JSON blob with Tanium-specific keys.
- The design must support both Cloud-preferred Gateway flows and documented module-API fallback without binding the rest of Alga to Tanium-specific terminology.
- Error states must stay actionable at the provider and sync-job level.

## Data / API / Integrations

### Existing Alga Ground Truth

- `rmm_integrations` already stores one active provider config per tenant/provider pair.
- `rmm_organization_mappings` is already generic enough to represent external scope -> Alga client mapping.
- `tenant_external_entity_mappings` is the strongest generic external identity seam and should become the canonical asset correlation backbone.
- Current shared interfaces leak NinjaOne-specific settings and need neutralization before Tanium is added.

### Tanium Ground Truth From Official Docs

- Tanium Gateway is the preferred API surface for integrations and uses GraphQL.
- Gateway is the preferred option for querying online and offline systems, deploying actions, managing groups, scheduling software deployments, establishing direct endpoint connections, and inserting/updating Asset records.
- Tanium Connect is best for scheduled or event-triggered outbound delivery to destinations such as webhook, syslog, and files.
- The Asset API is specifically called out as useful for endpoints that have aged out of TDS.
- Direct Connect is for live endpoint connection, troubleshooting, evidence gathering, and certain remediation scenarios, and is not meant as the general integration transport.
- Threat Response REST is useful for threat hunting and investigation scenarios, not as the base inventory sync path.

### Tanium Schema / API Discovery Work Required Before Coding

The official docs establish the method-selection rules, but the implementation still needs tenant-backed schema verification for:

- exact Gateway object and field names for endpoints/devices and their grouping/scope metadata
- exact Tanium scope concept that best maps into `rmm_organization_mappings`
- exact Gateway or module API fields needed for offline / aged-out inventory coverage
- whether Tanium Connect delivery should be treated as a manually configured outbound feed, a provider-assisted setup, or deferred entirely
- whether any remote access or remediation capability is worth exposing in Alga v1

Implementation must capture these verified details in the scratchpad before writing provider code.

## Security / Permissions

- Tanium permissions should be modeled as least-privilege provider credentials with the minimum roles/personas needed for the selected Gateway and module API calls.
- Shared RMM code must not assume public callback routes for Tanium.
- Tanium capability exposure in UI must reflect what the configured credentials can actually support.
- Existing Alga tenant isolation rules continue to apply through tenant-scoped queries.

## Observability

- Reuse existing RMM sync and workflow event publication where possible.
- Do not add a new observability subsystem in this effort.
- Provider-neutral sync lifecycle events should identify provider, sync type, items processed, and actionable error summaries.

## Rollout / Migration

- Phase 1 is an internal architecture pass plus Tanium v1 inventory integration.
- Existing NinjaOne and Tactical flows should continue to function while being wrapped progressively by the shared abstractions.
- No data migration is required beyond any type additions or settings normalization needed for shared provider support.

## Open Questions

- What is the exact Tanium auth mechanism and credential shape we should support in Alga for Gateway and any necessary module API fallbacks?
- What Tanium scope concept should map to `rmm_organization_mappings`: customer, site, group, or another Tanium object?
- Which exact Gateway fields cover endpoint inventory, online/offline status, and client-scoping metadata in the target tenant?
- Do we need aged-out inventory fallback in Tanium v1, and if so, is Gateway insufficient in practice for the customer’s tenant?
- Should Tanium Connect delivery be part of v1, documented as manual setup, or deferred entirely?
- Is any Tanium remote action or direct connection capability a product requirement for v1, or should it remain hidden behind unsupported capability flags?

## Acceptance Criteria (Definition of Done)

- A provider-neutral RMM adapter and registry exist and are used by the shared RMM settings surface.
- Shared device ingestion uses `tenant_external_entity_mappings` for external identity correlation.
- Tanium can be configured, validated, scoped, and synced for mapped tenants/clients.
- Tanium inventory sync creates and updates Alga assets through the shared ingestion path.
- Any Tanium-specific fallback to module APIs is explicitly documented and justified by official Tanium guidance or verified schema gaps.
- Current NinjaOne and Tactical integrations still function after the abstraction layer is introduced.
- The plan scratchpad contains ground-truth references for Tanium method selection and a captured list of schema/API unknowns resolved during implementation.
