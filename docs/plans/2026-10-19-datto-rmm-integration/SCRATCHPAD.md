# SCRATCHPAD — Datto RMM Integration (CE)

## Reference map (Tactical → Datto)

| Tactical | Datto equivalent |
|---|---|
| packages/integrations/src/lib/rmm/tacticalrmm/tacticalApiClient.ts | lib/rmm/datto/dattoApiClient.ts |
| tacticalrmm/buildClient.ts | datto/buildClient.ts |
| tacticalrmm/deviceSync.ts (bespoke engine) | datto/deviceSync.ts via shared ingestNormalizedRmmDeviceSnapshot |
| tacticalrmm/deviceSyncStrategy.ts | datto/deviceSyncStrategy.ts |
| tacticalrmm/syncSingleAgent.ts | datto/syncSingleDevice.ts |
| tacticalrmm/alertFetcher.ts | datto/alertFetcher.ts |
| tacticalrmm/assetDeviceActions.ts | datto/assetDeviceActions.ts |
| actions/integrations/tacticalRmmActions.ts | actions/integrations/dattoRmmActions.ts |
| components/.../TacticalRmmIntegrationSettings.tsx | DattoRmmIntegrationSettings.tsx |
| server/src/app/api/webhooks/tacticalrmm/route.ts | server/src/app/api/webhooks/datto/route.ts |
| server/src/test/unit/tacticalrmm/* | server/src/test/unit/dattormm/* |
| docs/integrations/tactical-rmm.md | docs/integrations/datto-rmm.md |

## Registration touchpoints

- packages/integrations/src/lib/rmm/providerRegistry.ts (entry + icon union)
- packages/integrations/src/components/settings/integrations/RmmIntegrationsSetup.tsx (CE branch at "In CE, Tactical is the only…", component map, chip map)
- packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts (RMM_ALERT_POLLING_PROVIDERS, RMM_DEVICE_SYNC_PROVIDERS, ensureFetchersRegistered, ensureDeviceSyncStrategiesRegistered)
- packages/integrations/src/lib/rmm/assetDeviceActions.ts (resolveRmmAssetDeviceActions switch)
- packages/assets/src/components/RemoteAccessButton.tsx (providerTypes)
- packages/assets/src/lib/rmmProviderDisplay.ts ('Datto' → 'Datto RMM')
- shared/rmm/alerts/ticketCreator.ts (provider label map)
- server/src/lib/inboundWebhooks/reservedIntegrationTypes.ts
- server/src/middleware.ts (exactApiKeySkipPaths)
- packages/integrations/src/actions/index.ts + package.json exports
- server/src/lib/api/openapi/routes/rmmIntegrations.ts (check provider enum in OpenAPI schema)

## Already present for 'datto'
- RmmProvider unions (types, server, ee), display helper, inboundActions KNOWN_RMM_PROVIDERS, rmm_integrations.provider comment.

## Datto API spec
- Local copy: ~/.claude/skills/rmm/docs/datto-rmm-openapi.json (59 ops, v2). Use for fixtures and types.

## Decisions
- Use shared ingestion service, not a Tactical engine copy (less code; Level/Tanium path).
- Polling is the primary alert path; webhook is optional pending header-support verification.

## Log
- 2026-10-19: plan drafted.
- 2026-10-19 (foundation): Phase 0 + core client done (F001-F004, F010-F012, F015; T001, T002, T010-T012).
  - `lib/rmm/common/{db,events,errors,softwareInventory}.ts` created. Tactical `deviceSync.ts` re-exports `tenantScopedTable` and keeps thin `publishRmmSyncEvent` / `axiosErrorToMessage` wrappers (Tactical messages unchanged). `tacticalRmmActionsTenantScoped.contract.test.ts` now reads `common/db.ts` for the helper body.
  - Provider enum audit: no CHECK constraint or seeded enum lists providers (`rmm_integrations.provider` is varchar(50); migration only mentions slugs in comments). Only list found: the OpenAPI `RmmProviderParam` description (server/src/lib/api/openapi/routes/rmmIntegrations.ts) plus its generated copies (sdk/docs/openapi/*.json, server/src/lib/mcp/registry.generated.ts, ee/server/src/chat/registry/apiRegistry.generated.ts); updated to include datto.
  - Still lists that the later phases must extend: `RMM_ALERT_POLLING_PROVIDERS` / `RMM_DEVICE_SYNC_PROVIDERS` (jobs handler), `DEVICE_SYNC_SUPPORTED_PROVIDERS` (RmmDeviceSyncSettings.tsx), `POLLING_PROVIDERS` (RmmAlertAutomationSettings.tsx), `RemoteAccessButton.providerTypes`, `resolveRmmAssetDeviceActions`.
  - Reconnect-required: `rmm_integrations.settings.tokenLifecycle.status = 'reconnect_required'` (same key the polling/sync gates read for NinjaOne). `markDattoReconnectRequired` / `clearDattoReconnectRequired` in datto/buildClient.ts. Save/Test Connection must call `clearDattoReconnectRequired` after storing new credentials (gates skip a flagged integration so no client is built to self-clear).
  - `@alga-psa/integrations/*` already maps to `packages/integrations/src/*` (tsconfig + package.json `./lib/*`), so no new exports needed for `lib/rmm/datto/*` or `lib/rmm/common/*`.
  - Tactical e2e specs used a stale `#rmm-integration-configure-tacticalrmm` id; switched to `#rmm-integration-row-tacticalrmm` (the picker's row id) so the picker click works in CE.
- 2026-10-19: wave 2 (sites/devices, alerts/webhook, software/asset actions, settings UI/actions/docs) landed via parallel agents.
  - Webhook placeholders verified against https://rmm.datto.com/help/en/Content/3NEWUI/Monitors/Webhooks.htm (square-bracket syntax: [alert_uid], [device_uid], [site_uid], [device_hostname], [alert_type]). [alert_message] deliberately omitted (inserted unescaped → invalid JSON); route reads diagnostics via GET /v2/alert/{uid}. Custom headers configured per Global Webhooks page.
  - Added optional `isResetEnabled` to RmmAlertOutboundAdapter: with resolve-on-close off, Datto alerts are skipped on ticket close (no local-only resolve) so local state stays truthful. Note: processRmmAlertEvent's linkedTicketGone path intentionally reopens a still-firing alert whose ticket closed (same as Tactical) — documented in datto-rmm.md.
  - Shared ingest service blanks serial_number on update; Datto sync passes existing serial back when the audit is skipped.
  - asset reboot/runScript for provider 'datto' additionally require rmm:execute_command (other providers unchanged).
  - Not run (need DB / built dist / browser): T003 tactical e2e, T022 datto e2e specs, T034 schedule DB test. Written and type-checked only.
  - packages/assets has 5 pre-existing env failures (unbuilt @alga-psa/db, @alga-psa/event-schemas dist) unrelated to this work.
- 2026-10-19: Opus review (data + security) → fixes landed:
  - Data: software marker carried across device sync; per-site failure isolation + missing_in_datto flag; single-device sync only creates assets on auto-sync sites; audit failure ingests without hardware; incremental includes status flips + new devices; location = site name; antivirus normalized (running/at_risk/unknown, raw in systemInfo).
  - Security: API host allowlist (*.centrastage.net, *.rmm.datto.com, https), host change requires re-entering key+secret, maxRedirects 0, https-only Web Remote URL, sanitized job errors.
  - Alerts: webhook drops unmapped sites, stamps reconciliation marker, dedup discriminators (esAlertId, diagnostics hash, alertUid fallback), muted filtered, pagination truncation throws, token-store re-read on 401, reconnect flag only on token-endpoint rejection, per-credential in-process rate limiter, webhook client capped at 5s wait.
  - UI: messages survive reload; options disabled after disconnect; host-change credential hint.
  - Known/accepted: webhook dedupe claim not reclaimable after a hard crash (Level parity); job clears per-device sync_error on partial success (shared behavior); webhook secret visible to system_settings:read (Tactical parity).
  - Verification: server RMM unit suites 795/796 (1 unrelated flaky prepaid-balance test, passes alone), packages/integrations 1122/1122, EE integration contracts 146/146, translations PASSED, tsc clean for integrations/jobs/assets/shared/server.
