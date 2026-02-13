# Scratchpad — Tactical RMM Integration

- Plan slug: `tacticalrmm-integration`
- Created: `2026-02-13`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

Prefer short bullets. Append new entries as you learn things, and also *update earlier notes* when a decision changes or an open question is resolved.

## Decisions

- (2026-02-13) Tactical RMM integration must be available in both CE and EE (unlike NinjaOne which is currently EE-oriented).
- (2026-02-13) Assume Tactical beta API is enabled and use it for fleet sync (`/api/beta/v1/{client,site,agent}/`).
- (2026-02-13) Support 2 auth modes per tenant:
  - API key: `X-API-KEY`.
  - Username/password: Knox token with `Authorization: Token <token>`, TOTP-aware via `checkcreds` + `login`.
- (2026-02-13) Tactical hierarchy mapping for sync:
  - Tactical Client ~= “organization” => `rmm_organization_mappings.external_organization_id`.
  - Tactical Agent ~= device => `assets.rmm_device_id` and `tenant_external_entity_mappings.external_entity_id` use `agent_id` (string).
  - Site id/name stored in mapping metadata (initially) to avoid schema churn.
- (2026-02-13) Realtime sync is alert-driven only (Tactical webhooks are configured as alert actions). We will use alerts as the trigger to run “sync single agent”.
- (2026-02-13) Webhook auth uses `X-Alga-Webhook-Secret` header (Tactical supports custom headers on webhook actions).

## Discoveries / Constraints

- (2026-02-13) Existing RMM platform tables are provider-agnostic: `rmm_integrations`, `rmm_organization_mappings`, `rmm_alerts`, `rmm_alert_rules` created by `server/migrations/20251124000001_create_rmm_integration_tables.cjs`.
- (2026-02-13) Existing NinjaOne integration structure to mirror:
  - Settings UI: `ee/server/src/components/settings/integrations/NinjaOneIntegrationSettings.tsx`
  - Org mapping UI: `ee/server/src/components/settings/integrations/ninjaone/OrganizationMappingManager.tsx`
  - Sync engine: `ee/server/src/lib/integrations/ninjaone/sync/syncEngine.ts`
  - Webhook handler: `ee/server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts`
  - Webhook route: `ee/server/src/app/api/webhooks/ninjaone/route.ts` (re-exported from `server/src/app/api/webhooks/ninjaone/route.ts`)
- (2026-02-13) Tactical has an additional status state `overdue`. Current Alga types/UI generally assume `online|offline|unknown`, so Tactical likely requires a small type/UI expansion.
- (2026-02-13) Tactical beta agent list serializer is `__all__` model fields; computed `status` may not appear on list responses. Prefer computing status from last_seen/offline_time/overdue_time for list-based sync.
- (2026-02-13) Fleet-scale software inventory ingestion should use bulk `GET /api/software/` (cached) rather than per-agent refresh `PUT /api/software/<agent_id>/`.

## Commands / Runbooks

- (2026-02-13) Plan validation: `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-02-13-tacticalrmm-integration`

## Links / References

- Tactical API docs (user provided): `docs.tacticalrmm.com/functions/api/` and related pages.
- Integrations settings entry point: `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
- Assets RMM status indicator (CE+EE): `packages/assets/src/components/RmmStatusIndicator.tsx`
- API auth middleware skip list (add `/api/webhooks/tacticalrmm`): `server/src/middleware.ts`

## Test Notes

- (2026-02-13) T080: Added bulk software ingest test verifying Tactical ingestion uses only `GET /api/software/` (no per-agent refresh `PUT`) and writes to normalized software tables (`software_catalog`, `asset_software`). Files:
  - `server/src/test/unit/tacticalrmm/tacticalSoftwareIngest.bulk.test.ts`
- (2026-02-13) T081: Extended software ingest test to assert agent_id to asset association via `tenant_external_entity_mappings` (unmapped agents do not produce catalog/asset_software rows).
- (2026-02-13) T082: Extended software ingest test to assert idempotency (rerun does not duplicate `software_catalog` or `asset_software` rows).
- (2026-02-13) T090: Added coverage for Tactical event-bus publishing:
  - Org sync publishes `RMM_SYNC_STARTED` and `RMM_SYNC_COMPLETED`, and now publishes `RMM_SYNC_FAILED` on exception (best-effort).
  - Webhook route publishes `RMM_WEBHOOK_RECEIVED` on valid webhook requests.
  - Files:
    - `packages/integrations/src/actions/integrations/tacticalRmmActions.ts`
    - `server/src/test/unit/tacticalrmm/tacticalEvents.published.test.ts`
- (2026-02-13) T092: Webhook route behavior for unknown/unmapped `agent_id` is explicitly covered: returns 200 and persists `rmm_alerts` with `asset_id=null` when no mapping exists. File:
  - `server/src/test/unit/tacticalrmm/tacticalWebhook.upsertAlert.test.ts`
- (2026-02-13) T094: Added unit coverage that `TacticalRmmClient.listAllBeta` accepts a non-paginated (array) response body for `/api/beta/v1/client/` and does not attempt to page further. File:
  - `server/src/test/unit/tacticalrmm/tacticalApiClient.pagination.test.ts`

## Open Questions

- Should we mark assets inactive when an agent disappears from Tactical inventory, or leave as-is unless explicitly deleted?
- Should Tactical “overdue” be first-class everywhere (recommended) or mapped to offline?
- What is the best heuristic for workstation vs server classification from Tactical agent fields?

## Deletion Policy

- (2026-02-13) F055: Device deletion handling is currently **skipped** (no auto-inactivation on missing agents). Rationale: avoid accidental deactivation without a complete snapshot + explicit user confirmation.

## Progress Log

- (2026-02-13) F001: Added `tacticalrmm` to `RmmProvider` unions in `packages/types`, `server` (CE), and `ee/server` (EE) so it can be persisted/rendered consistently.
- (2026-02-13) F002: Centralized RMM provider display-name mapping in `packages/assets` and added friendly label `Tactical RMM` for `tacticalrmm` (used by status indicator + asset header badge).
- (2026-02-13) F003: Added `overdue` to agent status unions and UI surfaces (dashboard filter, status indicator/badge, vitals panel) plus backend schema validation; treated `overdue` as non-online for remote access and health status.
- (2026-02-13) F010: Added Tactical RMM as a first-class integration entry under Settings -> Integrations -> RMM in `packages/integrations` (rendered in both CE + EE).
- (2026-02-13) F011: Implemented Tactical RMM settings panel UI (instance URL, auth mode, credential inputs, save/test/disconnect flows) in `packages/integrations`.
- (2026-02-13) F012: Added Tactical connection status panel (connected/disconnected, last sync, counts, last error) backed by a server action summary query.
- (2026-02-13) F013: Added "Sync Clients" UI + server action to pull Tactical `/api/beta/v1/client/` and upsert `rmm_organization_mappings` with created/updated/failed counts.
- (2026-02-13) F014: Added "Sync Devices" UI + server action to fetch Tactical agents for mapped orgs and upsert Alga assets + external entity mappings with summary counts.
- (2026-02-13) F015: Implemented org mapping UI using `ClientPicker` + per-org auto-sync toggle, backed by list/update server actions for `rmm_organization_mappings`.
- (2026-02-13) F016: Implemented webhook config UI (URL, `X-Alga-Webhook-Secret`, payload template) with per-tenant secret generation via secret store.
- (2026-02-13) F017: Added UI + server action to backfill Tactical alerts into `rmm_alerts` and display sync results.
- (2026-02-13) F018: Added UI + server action to ingest Tactical bulk cached software inventory into `software_catalog` + `asset_software` using external mappings (no per-agent refresh).
- (2026-02-13) F020: Added server actions to save/read Tactical settings and credential status with masking; disconnect clears tenant secrets.
- (2026-02-13) F021: Implemented Tactical connection test for both API key and Knox modes, including TOTP-required detection.
- (2026-02-13) F022: Implemented Tactical `rmm_integrations` upsert/update flows (instance URL, is_active, auth_mode in settings).
- (2026-02-13) F023: Implemented Tactical connection status summary (mapped orgs, synced devices, active alerts, status counts) for the settings status panel.
- (2026-02-13) F030: Added Tactical API client wrapper (`TacticalRmmClient`) with base URL normalization + shared request/pagination helpers.
- (2026-02-13) F031: API key auth implemented via `X-API-KEY` header in Tactical API client.
- (2026-02-13) F032: Knox auth implemented (checkcreds + login with optional TOTP) and token persisted in tenant secrets; requests use `Authorization: Token ...`.
- (2026-02-13) F033: Knox mode retries once on 401 by refreshing the token and retrying the request (single refresh guard).
- (2026-02-13) F034: Implemented beta pagination helper (`listAllBeta`) looping `page` until `next` is null with `page_size` capped at 1000.
- (2026-02-13) F040: Implemented Tactical client inventory sync into `rmm_organization_mappings` via `/api/beta/v1/client/`.
- (2026-02-13) F041: Implemented Tactical org mapping list/update server actions (client assignment + `auto_sync_assets`).
- (2026-02-13) F050: Implemented Tactical full device sync (sites + agents) for mapped orgs; upserts assets and updates RMM fields.
- (2026-02-13) F051: Implemented deterministic Tactical agent status computation (`online|offline|overdue`) from last_seen/offline_time/overdue_time.
- (2026-02-13) F054: Implemented Tactical external entity mapping upserts to `tenant_external_entity_mappings` with `external_entity_id=agent_id`, `external_realm_id=client_pk`, and site metadata.
- (2026-02-13) F052: Mapped Tactical agent OS/version + agent version into workstation/server extension rows during device sync; base asset RMM fields and last_seen/last_rmm_sync are set.
- (2026-02-13) F053: Mapped Tactical agent vitals (current user, uptime, LAN/WAN IP) into cached RMM extension fields when present on list responses.
- (2026-02-13) F056: Added targeted single-agent sync server action by `agentId` (refreshes asset fields + extension vitals).
- (2026-02-13) F060: Added `POST /api/webhooks/tacticalrmm` route (node runtime) and exempted it from API-key middleware.
- (2026-02-13) F061: Webhook validates `X-Alga-Webhook-Secret` (case-insensitive) against per-tenant secret store before processing.
- (2026-02-13) F062: Documented Tactical webhook JSON contract in `ee/docs/plans/2026-02-13-tacticalrmm-integration/WEBHOOK_CONTRACT.md` and surfaced a payload template in the settings UI.
- (2026-02-13) F063: Webhook upserts `rmm_alerts` for `tacticalrmm` and associates `asset_id` when an agent external mapping exists.
- (2026-02-13) F064: Webhook triggers a best-effort targeted single-agent refresh to update cached vitals/status after alert events.
- (2026-02-13) F070: Implemented Tactical alerts backfill via `PATCH /api/alerts/` and upsert into `rmm_alerts` (current default: active alerts).
- (2026-02-13) F071: Implemented Tactical bulk software ingestion via `GET /api/software/` into `software_catalog` + `asset_software` using Tactical agent_id mappings (no per-agent refresh calls).
- (2026-02-13) F080: Published event-bus events for Tactical sync and webhook flows (RMM_SYNC_STARTED/COMPLETED, RMM_WEBHOOK_RECEIVED) on a best-effort basis.
- (2026-02-13) T001: Added a types package typecheck test ensuring `RmmProvider` accepts `tacticalrmm`.
- (2026-02-13) T002: Fixed `@alga-psa/assets` unit test runner (migrated `@nx/vite:test` -> `@nx/vitest:test` with `packages/assets/vitest.config.ts`) and added a unit test asserting `tacticalrmm` renders as `Tactical RMM` via `getRmmProviderDisplayName`.
- (2026-02-13) T003: Added typecheck coverage for `RmmAgentStatus` including `overdue` in `@alga-psa/types`, and refactored the asset dashboard agent-status filter options into `packages/assets/src/lib/rmmAgentStatusOptions.ts` with a unit test ensuring `overdue` is present.
- (2026-02-13) T010: Added CE Playwright E2E coverage asserting Settings -> Integrations -> RMM renders `Tactical RMM`, and fixed CE Playwright auth cookie helper to align with `@alga-psa/auth/session` cookie naming (dev mode) and URL-scoped cookie injection.
- (2026-02-13) T011: Added EE Playwright E2E coverage asserting Settings -> Integrations -> RMM renders `Tactical RMM`; fixed workflow-worker docker build dependencies for Playwright (added `@alga-psa/portal-shared`) and addressed TS compile issues uncovered by the Playwright workflow-worker build.
- (2026-02-13) T012: Added CE Playwright E2E coverage for saving Tactical instance URL + API key and asserting masked credential status persists (placeholder + “Saved:” last-4) using a filesystem-backed Playwright secret store (`SECRET_FS_BASE_PATH=secrets-playwright`).
- (2026-02-13) T013: Added CE Playwright E2E coverage for Knox auth (username/password, no TOTP) using an in-test mock Tactical HTTP server (checkcreds/login/client list). Assertion targets the “Knox token saved” masked status (vs. the success alert, which may be clipped by scroll container overflow) and verifies the backend uses `Authorization: Token <knox>` when calling the beta clients endpoint.
- (2026-02-13) T014: Added CE Playwright E2E coverage for the TOTP-required Knox flow using a mock Tactical server (`checkcreds` returns `{totp:true}`). Test asserts the first connection test prompts for a TOTP input and does not attempt login; then with `twofactor` provided it completes login and persists the Knox token.
- (2026-02-13) T015: Added CE Playwright E2E coverage for disconnect: configures Tactical with API key against a mock server, tests connection to mark `rmm_integrations.is_active=true`, then disconnects and asserts the API key secret is cleared (placeholder resets, “Saved:” line gone) and `rmm_integrations.is_active=false` with `connected_at=null`.
- (2026-02-13) T020: Added a unit test for `getTacticalRmmSettings` secret masking using Vitest module mocks (bypassing `withAuth` and stubbing DB/secret provider) to assert only the last 4 characters are visible. Updated `server/package.json` to align `vitest` with workspace v4, updated root `package-lock.json`, and added missing Vitest alias for `@alga-psa/event-bus/publishers` required by integration action imports.
- (2026-02-13) T021: Added a unit/integration test for `testTacticalRmmConnection` (API key mode) asserting `X-API-KEY` is used and 401 errors are surfaced as `Unauthorized (401): invalid credentials or token expired.` (axios mocked).
- (2026-02-13) T022: Updated Knox connection test action to retry login once if the token verification GET returns 401. Added a unit/integration test asserting `Authorization: Token ...` is used and the retry persists the refreshed token.
- (2026-02-13) T023: Added an integration-style unit test that exercises `saveTacticalRmmConfiguration` twice with a mocked Knex upsert chain to ensure only one `rmm_integrations` row exists per tenant+provider and subsequent saves update the existing row (stable integration_id, instance_url updated).
- (2026-02-13) T024: Added a unit/integration test for `getTacticalRmmConnectionSummary` with a table-switching Knex mock to validate mapped org/device/active alert counts and agent_status breakdown mapping (`null` -> `unknown`).
- (2026-02-13) T030: Added unit tests for `normalizeTacticalBaseUrl` covering protocol defaults, trailing slash removal, and `/api` segment stripping behavior.
- (2026-02-13) T031: Added a unit test for `TacticalRmmClient.listAllBeta` verifying DRF-style pagination loops pages until `next=null` and caps `page_size` at 1000.
- (2026-02-13) T032: Added unit tests for the Knox connection test flow ensuring `checkcreds.totp=true` results in a `login` request with `twofactor`, while `totp=false` logs in without twofactor.
- (2026-02-13) T033: Added a unit test for the Tactical API client's Knox 401 retry behavior, asserting it refreshes at most once and uses the refreshed `Authorization: Token ...` on the retry.
- (2026-02-13) T040: Added an integration-style unit test for `syncTacticalRmmOrganizations` using a mocked Tactical API client and an in-memory `rmm_organization_mappings` store to verify upsert/merge behavior and created/updated counters across reruns.
- (2026-02-13) T041: Added CE Playwright E2E coverage for Tactical org mapping assignment using `ClientPicker` option ids; asserts `rmm_organization_mappings.client_id` persists after selecting an Alga Client.
- (2026-02-13) T042: Added CE Playwright E2E coverage for toggling `auto_sync_assets` via the org mapping switch; test forces a mapping refresh after toggles to ensure the UI reflects persisted DB state before asserting DB values.
- (2026-02-13) T050-T053: Added unit tests for `computeTacticalAgentStatus` covering online/offline/overdue/null-last_seen rules using a fixed `now` timestamp.
- (2026-02-13) T054: Added an integration-style unit test for `syncTacticalRmmDevices` using a fake Knex + mocked Tactical beta API client to validate it creates a new asset for an unmapped agent and writes `tenant_external_entity_mappings` with `external_entity_id=agent_id`.
- (2026-02-13) T055: Extended the full device sync test to cover the update path when a mapping exists, asserting asset fields (name/status/last_seen/last_rmm_sync) are refreshed on rerun.
- (2026-02-13) T056: Extended the full device sync create-path assertion to validate site id/name are stored in `tenant_external_entity_mappings.metadata` and the Tactical client id is stored as `external_realm_id`.
- (2026-02-13) T057: Added an integration-style unit test for `syncTacticalRmmSingleAgent` using a fake Knex + mocked Tactical `GET /api/beta/v1/agent/<id>/` to assert the linked asset and external mapping are updated (including site metadata).
- (2026-02-13) T058: Added an integration-style unit test asserting the Tactical device deletion policy is "skip": when an agent disappears from list responses, the sync does not delete or inactivate the existing asset/mapping (items_deleted stays 0).
- (2026-02-13) T060: Added unit tests for the Tactical webhook route handler ensuring it does not require API-key auth and enforces `X-Alga-Webhook-Secret` (401 on missing/invalid secret).
- (2026-02-13) T061-T062: Added unit tests for webhook ingestion verifying minimal payload upserts `rmm_alerts` and that `asset_id` is populated only when an external mapping exists.
- (2026-02-13) T063: Added an integration-style unit test exercising the webhook handler with the real `syncTacticalSingleAgentForTenant` helper (mocked Tactical API + fake Knex) to assert the webhook both records an alert and refreshes asset vitals/status.
- (2026-02-13) T070-T071: Added an integration-style unit test for alerts backfill that mocks the Tactical `PATCH /api/alerts/` response and verifies idempotent upsert into `rmm_alerts` plus mapping `agent_id` to `asset_id` via `tenant_external_entity_mappings` when available.
