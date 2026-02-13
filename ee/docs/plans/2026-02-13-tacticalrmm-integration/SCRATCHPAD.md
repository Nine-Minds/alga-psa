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
