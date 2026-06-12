# Scratchpad — RMM Alert Handling

- Plan slug: `2026-06-12-rmm-alert-handling`
- Created: 2026-06-12

## What This Is

Working memory for the RMM alert handling effort. Approved design lives at
`docs/plans/2026-06-12-rmm-alert-handling-design.md` (commit `c717a4fd50`).

## Decisions

- (2026-06-11) Dedup is one open ticket per (device, condition). Repeats append a comment and bump `occurrence_count`. Always on, not per-rule configurable.
- (2026-06-11) Auto-close on alert reset: always comment; close only if no human touched the ticket (no human comments, no time entries, no manual status change). Rule-driven auto-assignment does not count as touched.
- (2026-06-11) Outbound reset on ticket close is a per-rule `actions.resetAlertOnTicketClose` flag, default true.
- (2026-06-11) Pipeline is provider-generic in `shared/rmm/alerts/`; NinjaOne and TacticalRMM both wired this branch.
- (2026-06-11) Processing runs synchronously in the webhook request (Approach A). All ingest work is local DB; the only external call (outbound reset) happens on the ticket-close bus subscriber.
- (2026-06-11) Schema direction: rules use JSONB `conditions`/`actions` (the alertProcessor model wins). One additive corrective migration; the deployed `20251124000001` migration is never rewritten. Deployed data is negligible — no backfill.
- (2026-06-11) Raw alert payload standardizes on the existing `metadata` jsonb column; code that wrote `source_data` changes to `metadata`.
- (2026-06-11) `rmm_organization_mappings.auto_create_tickets` is deprecated; rules with `organizationIds` conditions are the single source of truth.

## Discoveries / Constraints

- (2026-06-11) Alert ingestion is broken on main today: `webhookHandler.ts:671-674` inserts `activity_type` and `source_data` into `rmm_alerts`, but the only migration creating that table (`server/migrations/20251124000001_create_rmm_integration_tables.cjs`) has neither column.
- (2026-06-11) `alertProcessor.ts` reads JSONB `conditions`/`actions` from `rmm_alert_rules`; the migration created flat `text[]`/scalar columns instead. The processor is imported only by tests — never called from the webhook path.
- (2026-06-11) `ticketCreator.ts` works (manual button in `AssetAlertsSection.tsx` uses it) and is the basis for the shared creator.
- (2026-06-11) TacticalRMM's webhook (`server/src/app/api/webhooks/tacticalrmm/route.ts`) writes `rmm_alerts` directly, including the nonexistent columns — same schema bug.
- (2026-06-11) NinjaOne condition identity for dedup: `statusCode`, falling back to `activityType`. NinjaOne sends a fresh CONDITION TRIGGERED per firing, so a flapping check fires many times a day.
- (2026-06-11) NinjaOne webhook returns 200 for unmapped orgs (suppresses retries), 500 for unexpected errors (NinjaOne retries). Keep this; idempotent ingest makes at-least-once safe.
- (2026-06-11) `NinjaOneClient.resetAlert()` exists (`POST /api/v2/alert/{uid}/reset`); the only caller today is the `ninjaone.alerts.reset` workflow action.
- (2026-06-11) Known TODOs in adjacent code: CSRF validation in the NinjaOne OAuth callback; `resetInNinjaOne` in `alertProcessor.resolveAlert()` (superseded by the outbound adapter).
- (2026-06-11) Precedent for shared provider-agnostic RMM code: `shared/rmm/contracts.ts` + `shared/rmm/sharedAssetIngestionService.ts` (used by Tanium and Tactical device sync). The alert pipeline mirrors this layout.
- (2026-06-11) Legacy-bus events `RMM_ALERT_TRIGGERED`/`RMM_ALERT_RESOLVED` are published today but have no subscribers and are not in the workflow v2 catalog. Workflow v2 currently only sees `INTEGRATION_WEBHOOK_RECEIVED`.

## Commands / Runbooks

- Run server migrations: from `server/`, `npx knex migrate:latest` (see existing env scripts; use the worktree's compose stack via the alga-env-manager skill).
- Webhook entry for local testing: `POST /api/webhooks/ninjaone?tenant=<tenantId>` with `X-Alga-Webhook-Secret` header (secret in `rmm_integrations.settings.webhookSecret`).

## Links / References

- Design doc: `docs/plans/2026-06-12-rmm-alert-handling-design.md`
- Migration with current (broken) schema: `server/migrations/20251124000001_create_rmm_integration_tables.cjs`
- NinjaOne webhook: `ee/server/src/app/api/webhooks/ninjaone/route.ts`, handler `ee/server/src/lib/integrations/ninjaone/webhooks/webhookHandler.ts`
- Rules engine to move: `ee/server/src/lib/integrations/ninjaone/alerts/alertProcessor.ts`
- Ticket creator to move: `ee/server/src/lib/integrations/ninjaone/alerts/ticketCreator.ts`
- Tactical webhook: `server/src/app/api/webhooks/tacticalrmm/route.ts`
- Shared device-ingest precedent: `shared/rmm/sharedAssetIngestionService.ts`
- Provider registry (capability flags): `packages/integrations/src/lib/rmm/providerRegistry.ts`
- Asset alert UI: `ee/server/src/components/assets/AssetAlertsSection.tsx`
- NinjaOne client (resetAlert): `ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`

## Open Questions

- Does TacticalRMM's API expose alert resolution for the outbound adapter? If not, ship the adapter for NinjaOne only and mark the capability off for Tactical (pipeline skips it cleanly).
- Exact event-bus event name for ticket closure (TICKET_UPDATED with closed status vs. a dedicated TICKET_CLOSED) — confirm against `server/src/lib/eventBus/` when wiring the subscriber.
