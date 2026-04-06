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
- (2026-04-06) Feature `F005`–`F009` implementation detail: normalized RMM contracts and the shared ingestion engine now live in `packages/integrations/src/lib/rmm/`, allowing provider fetchers to hand off provider-neutral snapshots into a single create/update/delete pipeline.
- (2026-04-06) Feature `F010`–`F018` implementation detail: Tanium v1 is implemented as pull-oriented server actions backed by a Gateway client plus shared ingestion, with no public webhook/callback route additions.

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
- (2026-04-06) Validate F005-F009 targeted changes:
  - `npx nx typecheck @alga-psa/integrations`
- (2026-04-06) Validate F010-F018/F020 targeted changes:
  - `npx nx typecheck @alga-psa/integrations`
  - `npx nx typecheck sebastian-ee`
- (2026-04-06) Validate Tanium + shared RMM tests:
  - `npx nx test sebastian-ee -- --run src/__tests__/unit/integrations/taniumActions.test.ts src/__tests__/unit/integrations/TaniumIntegrationSettings.ui.test.tsx src/__tests__/unit/integrations/rmm/syncOrchestration.test.ts`
  - `cd server && npx vitest run ../packages/integrations/src/lib/rmm/providerRegistry.test.ts ../packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.registry.test.tsx ../packages/integrations/src/lib/rmm/sharedAssetIngestionService.test.ts`
  - Note: `@alga-psa/integrations` Nx test target currently points to deprecated `@nx/vite:test` without a config file; targeted package tests were executed via server Vitest harness instead.

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

- (2026-04-06) `F005` completed.
  - Added normalized provider contracts for scopes and device snapshots:
    - `packages/integrations/src/lib/rmm/contracts.ts`

- (2026-04-06) `F006` completed.
  - Added shared RMM asset correlation/upsert ingestion service centered on `tenant_external_entity_mappings`:
    - `packages/integrations/src/lib/rmm/sharedAssetIngestionService.ts`

- (2026-04-06) `F007` completed.
  - Shared ingestion create path now provisions:
    - base `assets` row
    - extension row (`workstation_assets` / `server_assets` when applicable)
    - `tenant_external_entity_mappings` link
  - Creation is driven from normalized snapshots and resolved client mapping.

- (2026-04-06) `F008` completed.
  - Shared ingestion update path now:
    - updates mapped assets
    - upserts extension fields
    - refreshes mapping metadata/sync timestamps
  - Includes fallback correlation to an existing asset by `rmm_provider + rmm_device_id` when an external mapping row is missing.

- (2026-04-06) `F009` completed.
  - Shared ingestion now handles lifecycle states `deleted`/`tombstoned` with a single path that marks asset inactive/offline and updates mapping status/metadata (`deleted`, `deletedAt`).

- (2026-04-06) `F010` completed.
  - Added transport-agnostic sync orchestration seam:
    - `ee/server/src/lib/integrations/rmm/sync/syncOrchestration.ts`
  - Tanium full sync now executes through this seam (`runRmmSyncWithTransport`) with direct transport active by default and temporal transport hook points available via env configuration.

- (2026-04-06) `F011` completed.
  - Added Tanium Gateway client/query runner:
    - `ee/server/src/lib/integrations/tanium/taniumGatewayClient.ts`
  - Includes authenticated GraphQL query runner, connection test, scope discovery (`computerGroups`), endpoint inventory (`endpoints`), and optional Asset API fallback fetcher.

- (2026-04-06) `F012` completed.
  - Added tenant-scoped Tanium connection lifecycle actions:
    - `ee/server/src/lib/actions/integrations/taniumActions.ts`
  - Implements settings retrieval, configuration save, connection test (state transition to active on success), and disconnect (secret cleanup + inactive row state).

- (2026-04-06) `F013` completed.
  - Added Tanium provider settings UI:
    - Enterprise implementation: `ee/server/src/components/settings/integrations/TaniumIntegrationSettings.tsx`
    - CE stub path for shared alias resolution: `packages/ee/src/components/settings/integrations/TaniumIntegrationSettings.tsx`
  - Selector wiring updated via shared provider registry rendering:
    - `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx`

- (2026-04-06) `F014` completed.
  - Implemented Tanium scope discovery action (`syncTaniumScopes`) with `rmm_organization_mappings` upsert/refresh behavior.

- (2026-04-06) `F015` completed.
  - Tanium settings now exposes mapping management using existing `rmm_organization_mappings` flow and client assignment updates (`updateTaniumOrganizationMapping`).

- (2026-04-06) `F016` completed.
  - Implemented Tanium full inventory sync action (`triggerTaniumFullSync`) that fetches endpoint inventory, normalizes snapshots, and calls shared ingestion (`ingestNormalizedRmmDeviceSnapshot`).

- (2026-04-06) `F017` completed.
  - Implemented constrained Asset API fallback path in full sync when a mapped scope has no Gateway endpoints and fallback is enabled.

- (2026-04-06) `F018` completed.
  - Tanium phase-1 implementation remains pull-only: no new `/api/webhooks/*` or callback ingress routes added.

- (2026-04-06) `F020` completed.
  - Tanium actions reuse existing `rmm_integrations` sync lifecycle fields (`sync_status`, `sync_error`, `last_sync_at`, `last_full_sync_at`) rather than introducing a separate status subsystem.

- (2026-04-06) `F019` completed.
  - Legacy NinjaOne and Tactical settings flows remain operable and are now selected via registry-driven adapter wiring in `RmmIntegrationsSetup` (`providerSettingsComponents`) instead of bespoke top-level branching, allowing transition without rewriting either provider stack.

## Test Implementation Log

- (2026-04-06) `T001` completed.
  - Added provider registry capability test:
    - `packages/integrations/src/lib/rmm/providerRegistry.test.ts`
  - Added selector registry-rendering test:
    - `packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.registry.test.tsx`

- (2026-04-06) `T002` completed.
  - Added shared ingestion create-path test:
    - `packages/integrations/src/lib/rmm/sharedAssetIngestionService.test.ts`

- (2026-04-06) `T003` completed.
  - Added shared ingestion update/no-duplicate test:
    - `packages/integrations/src/lib/rmm/sharedAssetIngestionService.test.ts`

- (2026-04-06) `T004` completed.
  - Added scope-discovery mapping preservation test in Tanium actions suite:
    - `ee/server/src/__tests__/unit/integrations/taniumActions.test.ts`

- (2026-04-06) `T005` completed.
  - Added Tanium full-sync happy-path test asserting Gateway fetch + shared ingestion invocation + completed sync status:
    - `ee/server/src/__tests__/unit/integrations/taniumActions.test.ts`

- (2026-04-06) `T006` completed.
  - Added Tanium fallback test asserting Asset API path ingestion when Gateway scope returns zero endpoints:
    - `ee/server/src/__tests__/unit/integrations/taniumActions.test.ts`

- (2026-04-06) `T007` completed.
  - Added connection failure test asserting inactive integration and actionable auth error:
    - `ee/server/src/__tests__/unit/integrations/taniumActions.test.ts`

- (2026-04-06) `T008` completed.
  - Added UI integration-style test for Tanium settings configuration/test/scope-discovery flow:
    - `ee/server/src/__tests__/unit/integrations/TaniumIntegrationSettings.ui.test.tsx`

- (2026-04-06) `T009` completed.
  - Added shared sync orchestration seam tests:
    - `ee/server/src/__tests__/unit/integrations/rmm/syncOrchestration.test.ts`

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
