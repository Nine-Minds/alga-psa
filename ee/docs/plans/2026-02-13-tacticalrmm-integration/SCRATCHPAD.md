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
