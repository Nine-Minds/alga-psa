# PRD: Teams Admin Diagnostics and Proactive Test Message

**Plan slug:** `2026-05-29-teams-diagnostics-test-message`
**Owning area:** EE / Microsoft Teams addon (`ee/packages/microsoft-teams`) + `packages/integrations` settings UI
**Related plans:**
- `.ai/teams_improvements/microsoft-teams-addon-competitive-parity-plan.md` (Phase 1: "Setup Wizard, Diagnostics, and Test Message")
- `ee/docs/plans/2026-05-24-teams-observability-loop/` (completed, PR #2562, F001–F050) — built the `teams_notification_deliveries`, `teams_audit_events`, and `teams_conversation_references` tables this plan consumes.

## Problem Statement

The Teams addon is a functional v0 (bot, message extension, quick actions, meetings, package generation, entitlement gating, and — as of the observability loop — persisted delivery/audit records). But an admin still has **no way to confirm a tenant is correctly wired up** except by reading server logs. There is no diagnostics surface and no test-message path. This is the gating blocker for charging: a non-developer admin cannot self-verify that profile, Graph token, bot credentials, user linkage, and delivery all work end-to-end.

Separately, the observability loop added `teams_conversation_references` (written on every inbound bot activity) and the repo already has `sendBotActivity()` — the full Bot Framework proactive-send primitive. **Neither is consumed by anything yet.** Building the test message on the proactive path lights up both, and validates the exact mechanism Phase 2 channel delivery will depend on.

## User Value

- **MSP admins** can run one-click diagnostics and a test message to confirm Teams is working, without engineering.
- **Diagnostics distinguish failure classes** (missing addon, inactive integration, unready profile, missing package/base URL, missing bot credentials, missing user linkage, missing conversation reference, recent Graph delivery failure) so the fix is obvious.
- **Engineers** get a proven proactive-send path (the building block for Phase 2 channel notifications) exercised in production.
- **Sales/demo risk drops** — the addon becomes self-verifiable, which is the precondition for packaging it as paid.

## Goals

1. A `runTeamsDiagnostics()` server action returns a structured, step-based report (pass/warn/fail/skip per check + aggregated recommendations), modeled on `runMicrosoft365Diagnostics()`.
2. A `sendTeamsTestMessage()` server action delivers a synthetic message to the calling admin **via the proactive bot path** (`sendBotActivity` against the admin's stored `teams_conversation_references` row) and records a `teams_notification_deliveries` row.
3. A diagnostics + test-message panel is added to `TeamsIntegrationSettings.tsx` (incremental — not a full wizard rebuild).
4. A read helper for `teams_conversation_references` exists (the table's first consumer).
5. All new DB reads are tenant-scoped; both actions are wrapped in `withAuth` and gated on the same permission as `saveTeamsIntegrationSettings`.
6. No new migration — reuse `teams_notification_deliveries` (test row) and `teams_conversation_references` (lookup).

## Non-Goals (Explicit)

- No `teams_channel_mappings`, channel routing, or channel delivery. (Phase 2.)
- No expanded notification categories (`ticket_created`, etc.). (Phase 2.)
- No `teams_user_preferences` / quiet hours / mention-only. (Phase 2.)
- No full 4-step setup wizard restructure — only add a diagnostics/test panel to the existing settings page.
- No 402/403 entitlement-response standardization. (Open Decision, separate PR.)
- No configurable channel tab, no trial flow, no metering.
- No LLM/fuzzy bot intent, no SSO token exchange.
- No new metrics export / Prometheus / log shipping.
- No change to existing notification delivery or bot reply behavior — diagnostics/test are additive read + a new send path.

## Target Users

- **MSP admins** in Settings → Integrations → Teams.
- **Engineers** debugging a tenant's Teams setup in staging/production.

## Primary Flows

### Flow A: Run diagnostics
1. Admin clicks "Run diagnostics" in Teams settings.
2. `runTeamsDiagnostics()` executes ordered checks, each producing `{status: pass|warn|fail|skip, detail, data?, error?}`:
   - addon entitlement active (`getTeamsAvailability`)
   - integration row exists + `install_status = 'active'`
   - capabilities include `personal_bot` + `activity_notifications`
   - selected Microsoft profile exists, not archived, has client secret ref
   - package metadata present + base URL resolvable
   - bot connector credentials configured (`isBotConnectorConfigured`)
   - calling admin's Microsoft user linkage present
   - conversation reference present for that admin
   - recent delivery health: most recent success + most recent failure (tenant-scoped read of `teams_notification_deliveries`)
3. Report aggregates `overallStatus` (fail if any fail; warn if any warn; else pass) and a deduped recommendations list.
4. UI renders the step list with status badges + recommendations.

### Flow B: Send test message (proactive)
1. Admin clicks "Send test message".
2. `sendTeamsTestMessage()` resolves availability → admin Microsoft link → latest personal conversation reference.
3. If addon inactive / integration inactive / bot not configured / no linkage / no conversation reference → returns a **skipped** result with an actionable reason (e.g. "message the bot once first") and records a `skipped` delivery row.
4. Otherwise builds a test activity and calls `sendBotActivity({serviceUrl, conversationId, activity})`.
5. Records a `teams_notification_deliveries` row (`status` sent/failed, `destination_type = 'bot_test'`, `category = 'test'`, actor metadata, idempotency key with attempt nonce).
6. UI shows success or the mapped skip/failure reason.

## Data Model / Integration Notes

- **No schema migration.** Reuse:
  - `teams_notification_deliveries` — `category` is nullable, no CHECK; `status` CHECK ∈ {skipped,sent,delivered,failed}; `destination_type` is free text NOT NULL. Test rows use `category='test'`, `destination_type='bot_test'`, `status ∈ {skipped,sent,failed}`.
  - `teams_conversation_references` — PK `(tenant, microsoft_user_id, conversation_id)`; columns include `service_url`, `conversation_type`, `last_activity_at`. Reader selects newest `personal` row per `(tenant, microsoft_user_id)`.
- **Transport already exists:** `teamsBotConnector.ts::sendBotActivity()` (token via client-credentials → `https://api.botframework.com/.default`; trusted-serviceUrl suffix check; POST to `/v3/conversations/{id}/activities`). Credentials from env `TEAMS_BOT_APP_ID` / `TEAMS_BOT_APP_TENANT_ID` / `TEAMS_BOT_APP_PASSWORD` (already in `helm/templates/{deployment,secret}.yaml`).
- **PSA-user → Microsoft-user mapping (VERIFIED):** `resolveTeamsRecipientLink(tenant, userId)` returns `{providerAccountId}`, and `providerAccountId` is the AAD **oid**. Conversation references are keyed by `microsoft_user_id = activity.from.aadObjectId` (`teamsConversationReferences.ts:48-50`). `nextAuthOptions.ts:881-882` deliberately stores `claims.oid` as the Microsoft link's `provider_account_id` *because* it equals `aadObjectId` (explicit comment at 878-883). The bot's existing `resolveTeamsLinkedUser` already relies on this. So the test message can feed `providerAccountId` straight into the conversation-reference reader — no normalization helper needed. **Known edge (pre-existing, not introduced here):** the admin bulk backfill flow (`ssoActions.ts:308`) stores `provider_account_id = lowerEmail`; Microsoft links created that way won't match a bot conversation reference (the bot already can't resolve them). Diagnostics should *surface* this (F021/F022 warnings), not fix it.
- **Diagnostics report shape:** mirror `Microsoft365DiagnosticsReport` / `...Step` (`shared/services/email/providers/MicrosoftGraphAdapter.ts:745+`) — step `id/title/status/durationMs/data/error`, `recommendations: string[]`, `overallStatus`.
- **Action wiring:** mirror `teamsObservabilityActions.ts` (`export const x = withAuth(impl)`). Rebuild the package (tsup → dist) so the server picks up new exports (prior loop F045).

## UX / UI Notes

- New Card in `TeamsIntegrationSettings.tsx` below the existing config/package cards: title "Diagnostics & Test Message".
- "Run diagnostics" button → step list, each row: status badge (pass=green / warn=amber / fail=red / skip=grey) + title + detail; recommendations rendered as a bullet list below.
- "Send test message" button → success or friendly skip/error message; the `missing_conversation_reference` skip maps to "Open the Alga PSA bot in Teams and send it any message first, then retry."
- Both buttons disabled when addon missing or integration not active (reuse existing `canPersist`-style gating).
- All strings i18n'd with `defaultValue` fallbacks, mirroring existing `integrations.teams.settings.*` keys.

## Risks / Open Questions

- **Mapping risk — RESOLVED (verified in code):** `provider_account_id` (Microsoft) = AAD `oid` = `microsoft_user_id` by design (`nextAuthOptions.ts:881-882` + `teamsConversationReferences.ts:48-50`). No normalization needed. Residual edge is the email-backfill linking path, which diagnostics surfaces rather than fixes.
- **Bot credentials in dev:** `isBotConnectorConfigured()` is false without env creds, so test message is a no-op locally — diagnostics must report this clearly rather than appearing broken.
- **Permission gate:** confirm the exact permission `saveTeamsIntegrationSettingsImpl` enforces and reuse it.
- **Idempotency for repeated tests:** include an attempt nonce in the test delivery idempotency key so each click records a distinct row (the table has a UNIQUE on `(tenant, idempotency_key)`).

## Acceptance Criteria / Definition of Done

- `runTeamsDiagnostics()` returns all listed checks with correct pass/warn/fail/skip classification and an accurate `overallStatus` + recommendations; tenant-scoped; permission-gated; covered by unit tests.
- `sendTeamsTestMessage()`:
  - on a healthy tenant, sends via `sendBotActivity` and records a `sent` delivery row;
  - on each unhealthy precondition, returns the correct skip reason and records a `skipped` row;
  - on transport failure, records a `failed` row;
  - all writes tenant-scoped; covered by unit/integration tests.
- The reader returns the newest personal conversation reference per `(tenant, microsoft_user_id)`, tenant-scoped, null-safe.
- Settings panel renders diagnostics steps + recommendations and the test-message result, with correct disabled states.
- No new migration; no change to existing delivery/bot-reply behavior.
- `@alga-psa/microsoft-teams` rebuilt so the server resolves the new exports.
