# Scratchpad — Tanium RMM Integration Plan

- Plan slug: `tanium-rmm-integration-plan`
- Created: `2026-04-06`

## What This Is

Working notes for the Tanium RMM planning effort. This is intentionally biased toward repo seams, official Tanium guidance, and concrete implementation consequences.

## Decisions

- (2026-04-06) Tanium should not be implemented by copying NinjaOne or Tactical RMM. The missing seam is a shared provider registry plus shared normalized ingestion pipeline.
- (2026-04-06) `tenant_external_entity_mappings` is the main simplification-cascade seam. Treat external RMM providers as identity sources that feed one shared asset correlation/upsert path.
- (2026-04-06) Tanium v1 is pull-oriented and Gateway-first.
- (2026-04-06) Tanium Connect is a later optional capability for outbound/event-triggered delivery, not a prerequisite for inventory sync.
- (2026-04-06) Tanium Asset API is a fallback for aged-out endpoint coverage, not the primary default integration surface.
- (2026-04-06) Tanium Direct Connect / Threat Response should be capability-flagged later work, not v1 scope.
- (2026-04-06) Feature `F001` is complete: plan artifacts now capture exact documented Gateway query/object/mutation families for inventory, scope discovery, actions, Connect, and Direct Connect, plus Asset API fallback posture and `assetUpsertEndpoints` usage constraints.

## Discoveries / Constraints

- (2026-04-06) Current RMM UI is hard-coded in `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`.
- (2026-04-06) Current public ingress handling is hard-coded in `server/src/middleware.ts` for `/api/integrations/ninjaone/callback`, `/api/webhooks/ninjaone`, and `/api/webhooks/tacticalrmm`.
- (2026-04-06) Shared RMM types already leak provider specifics, for example `ninja_instance_region` inside `ee/server/src/interfaces/rmm.interfaces.ts`.
- (2026-04-06) NinjaOne sync logic is split across provider-specific strategy/orchestration and duplicated persistence logic in Temporal activities.
- (2026-04-06) Tactical RMM keeps orchestration and persistence mostly inside one large action file, which reinforces the need for a shared ingestion seam before adding Tanium.
- (2026-04-06) Official Tanium docs say Gateway is preferred for querying online and offline systems, managing groups, deploying actions, establishing direct endpoint connections, and inserting/updating Asset records.
- (2026-04-06) Official Tanium docs say Connect is best for scheduled or event-triggered outbound delivery, including webhook destinations and detected-event delivery.
- (2026-04-06) Official Tanium docs say Asset API is useful for endpoints that have aged out of TDS.
- (2026-04-06) Feature `F002` implementation detail: provider unions are duplicated across `packages/types`, `server`, and `ee/server`; adding a provider requires touching all three type seams until a single source-of-truth type export is introduced.
- (2026-04-06) Feature `F003`/`F004` implementation detail: provider metadata and capability gating are now centralized in `packages/integrations/src/lib/rmm/providerRegistry.ts`, while provider settings components remain pluggable in UI composition code.

## Gateway Schema Findings

- (2026-04-06) Logged-in Gateway docs expose stable route families under `https://developer.tanium.com/apis/tanium_gateway_schema/{queries|mutations|objects}/...`.
- (2026-04-06) For Tanium inventory, the primary query surface is confirmed in the schema:
  - `endpoints(...args)`
  - `endpointCounts(input)`
  - `endpointIdChanges(...args)`
  - `endpointLastSeen(eids)`
- (2026-04-06) The endpoint object family is concrete and broad enough for normalized inventory snapshots:
  - `Endpoint`
  - `EndpointConnection`
  - `EndpointEdge`
  - `EndpointOS`
  - `EndpointUser`
  - `EndpointInstalledApplication`
  - `EndpointMetric`
  - `EndpointCompliance`
- (2026-04-06) The schema exposes a natural scope/group surface for client mapping:
  - queries: `computerGroup(ref)`, `computerGroups(...args)`
  - objects: `ComputerGroup`, `ComputerGroupConnection`, `ComputerGroupEdge`
  - mutations also exist for later admin workflows: `computerGroupCreate(input)`, `computerGroupDelete(ref)`
- (2026-04-06) The schema exposes Connect as a first-class later event/export surface:
  - queries: `connectConnection(ref)`, `connectConnections(...args)`, `connectRun(ref)`, `connectRuns(...args)`
  - objects: `ConnectConnection`, `ConnectGraphConnection`, `ConnectRun`, `ConnectRunConnection`
  - mutations: `connectConnectionStart(input)`, `connectConnectionStop(input)`
- (2026-04-06) The schema exposes Direct Connect as a first-class later remote-action surface:
  - queries: `directConnectConnectionStatus(input)`, `directConnectEndpoint(input)`, `directConnection(connectionID)`, `directEndpoint(input)`
  - mutations: `directConnectOpen(input)`, `directConnectClose(input)`, `directConnectPing(input)`, `directConnectProcessTerminate(input)`
  - objects: `DirectConnect`, `DirectConnectOpenPayload`, `DirectConnectClosePayload`, `DirectConnectConnectionStatusPayload`, `DirectConnectPingPayload`
- (2026-04-06) Legacy direct-connect mutations still exist, but the docs explicitly mark them as not preferred:
  - `closeDirectConnection(input)` is documented as legacy and says to use `directConnectClose` because the `directConnect*` APIs better support tracking slow-to-establish connections.
  - `openDirectConnection(input)` and `pingDirectConnection(input)` still appear alongside the newer `directConnect*` family.
- (2026-04-06) Action and scheduled-action surfaces are confirmed in Gateway and should remain capability-gated later work:
  - queries: `action(ref)`, `actions(...args)`, `actionGroup(ref)`, `actionGroups(...args)`, `scheduledAction(ref)`, `scheduledActions(...args)`
  - mutations: `actionCreate(input)`, `actionPerform(input)`, `actionGroupCreate(input)`, `actionGroupDelete(ref)`, `scheduledActionApprove(ref)`, `scheduledActionCreate(input)`, `scheduledActionDelete(ref)`
  - objects: `Action`, `ActionConnection`, `ActionGroup`, `ActionGroupConnection`, `ActionInfo`, `ScheduledAction`
- (2026-04-06) The logged-in object docs and screenshot evidence show `ScheduledAction` is a real first-class object with approval and scheduling metadata such as `approved`, `approver`, `comment`, `creator`, `distributeSeconds`, and `endTime`.
- (2026-04-06) `assetUpsertEndpoints(input)` is the key Tanium Gateway write surface around Asset-managed endpoint records:
  - return type: `AssetsUpsertPayload!`
  - argument type: `AssetUpsertEndpointsInput!`
  - docs say it upserts endpoint records in the given Asset Import API source using the Asset entity/attribute model
  - docs say source keys must be present as entity values; matching keys update an existing endpoint, otherwise a new endpoint is created
  - docs say TTL is updated for both Asset and TDS
  - docs require the Asset solution and `Asset Api User Write`
- (2026-04-06) `assetsImport(input)` is explicitly deprecated in favor of `assetUpsertEndpoints(input)` because `assetUpsertEndpoints` supports multi-row/reference entities.
- (2026-04-06) Working decision from the schema:
  - v1 scope discovery should target `computerGroups`
  - v1 inventory sync should target `endpoints` and normalize from the `Endpoint*` object family
  - `endpointIdChanges` / `endpointLastSeen` are candidates for incremental sync later, not prerequisites for v1
  - Direct Connect, action execution, scheduled actions, and Connect export jobs are later capability flags, not part of the base Tanium inventory adapter
- (2026-04-06) Docs-site gotcha: navigating directly to deep links or clicking raw anchors can bounce the browser into Redocly login. Expanding schema sections and changing routes inside the existing authenticated page was reliable; use that workflow if more schema mining is needed.

## Commands / Runbooks

- (2026-04-06) Find the live Tanium docs browser pane:
  - `alga-dev list-browsers --allTabs --pretty`
- (2026-04-06) Pull Tanium doc text from the live pane:
  - `alga-dev browser-eval --paneId=<pane> --script='(() => (document.body.innerText || \"\").slice(0, 10000))()'`
- (2026-04-06) Fetch official markdown docs directly:
  - `python3 - <<'PY'`
  - `import requests`
  - `print(requests.get('https://developer.tanium.com/guides/core-platform/integration_methods.md').text)`
  - `PY`
- (2026-04-06) Scaffold this plan:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py --slug tanium-rmm-integration-plan "Tanium RMM Integration Plan"`
- (2026-04-06) Validate F002 targeted changes:
  - `npx nx test @alga-psa/assets --testFile=packages/assets/src/lib/rmmProviderDisplay.test.ts`
  - `npx nx test @alga-psa/types`
- (2026-04-06) Validate F003/F004 targeted changes:
  - `npx nx typecheck @alga-psa/integrations`

## Implementation Log

- (2026-04-06) `F002` completed.
  - Added `tanium` to `RmmProvider` unions in:
    - `packages/types/src/interfaces/asset.interfaces.ts`
    - `server/src/interfaces/asset.interfaces.tsx`
    - `ee/server/src/interfaces/rmm.interfaces.ts`
  - Refactored EE RMM settings typing to separate common settings from provider-specific payloads:
    - introduced `RmmCommonIntegrationSettings`
    - introduced typed provider payloads (`NinjaOneRmmProviderSettings`, `TacticalRmmProviderSettings`, `TaniumRmmProviderSettings`)
    - introduced `RmmProviderConfigurationPayload` and `provider_settings`
    - retained `ninja_instance_region` as a compatibility bridge during migration
  - Updated provider display utilities/tests to include `tanium`:
    - `packages/assets/src/lib/rmmProviderDisplay.ts`
    - `packages/assets/src/lib/rmmProviderDisplay.test.ts`
  - Expanded type-level coverage:
    - `packages/types/src/interfaces/rmmProvider.typecheck.test.ts`

- (2026-04-06) `F003` completed.
  - Added shared provider registry with normalized provider metadata and capability flags:
    - `packages/integrations/src/lib/rmm/providerRegistry.ts`
  - Registry now captures connection/scope/device/events/remote-action capability state per provider and centralizes enterprise/feature-flag availability gates.

- (2026-04-06) `F004` completed.
  - Refactored settings selector UI to render provider cards from registry output instead of hard-coded provider branches:
    - `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`
  - Added Tanium placeholder settings component wiring behind the `tanium-rmm-integration` feature flag so registry-driven rendering can include Tanium metadata without breaking current behavior.

## Links / References

- Official docs:
  - https://developer.tanium.com/guides/core-platform/integration_methods
  - https://developer.tanium.com/guides/core-platform/integration_methods.md
  - https://developer.tanium.com/apis/api_intro
  - https://help.tanium.com/bundle/ug_gateway_cloud/page/gateway/index.html
  - https://help.tanium.com/bundle/ug_gateway_cloud/page/gateway/gateway.html
- Alga repo references:
  - `server/migrations/20251124000001_create_rmm_integration_tables.cjs`
  - `server/migrations/20250502173321_create_tenant_external_entity_mappings.cjs`
  - `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`
  - `server/src/middleware.ts`
  - `ee/server/src/interfaces/rmm.interfaces.ts`
  - `ee/server/src/lib/integrations/ninjaone/sync/syncStrategy.ts`
  - `ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts`
  - `ee/temporal-workflows/src/activities/ninjaone-sync-activities.ts`
  - `packages/integrations/src/actions/integrations/tacticalRmmActions.ts`
  - `packages/integrations/src/lib/rmm/tacticalrmm/tacticalApiClient.ts`

## Open Questions

- What exact Tanium auth material should Alga store per tenant for Gateway access?
- Do we need incremental sync in Tanium v1, or is full inventory sync enough until real-world volume proves otherwise?
- Is there an officially documented programmatic management surface for Tanium Connect destinations/jobs, or would later Connect event delivery be console-configured?
- Does `ComputerGroup` map cleanly enough to `rmm_organization_mappings` for real MSP tenant usage, or do we need a provider-specific scope-normalization rule on top of Tanium groups?
- Which exact `Endpoint` fields and nested objects are sufficient for Alga’s normalized device snapshot without overspecifying the first adapter?
