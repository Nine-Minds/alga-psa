# SCRATCHPAD: Teams Diagnostics + Proactive Test Message

Plan slug: `2026-05-29-teams-diagnostics-test-message`
Created: 2026-05-29

## Why this is the next PR (rationale)

- Observability loop (`2026-05-24-teams-observability-loop`, PR #2562, F001–F050) shipped the data substrate: `teams_notification_deliveries`, `teams_audit_events`, `teams_conversation_references`. Nothing *reads* deliveries or conversation references yet.
- Diagnostics + test message is the natural consumer of that substrate, and it's the gating blocker for charging (admin self-verification without logs).
- The test message is built on the **proactive bot path**, which lights up the dormant `teams_conversation_references` table and validates the exact transport Phase 2 channel delivery will reuse — so a cheap Phase 1 win also de-risks Phase 2.

## Key code discoveries (verified)

### Proactive send already exists
- `ee/packages/microsoft-teams/src/lib/teams/bot/teamsBotConnector.ts`
  - `sendBotActivity({ serviceUrl, conversationId, replyToId?, activity })` — POSTs to `{serviceUrl}/v3/conversations/{id}/activities`. THE proactive primitive. Already used for synchronous bot replies at `teamsBotHandler.ts:1219`.
  - `isBotConnectorConfigured()` / `readBotCredentialsFromEnv()` — creds from env `TEAMS_BOT_APP_ID`, `TEAMS_BOT_APP_TENANT_ID`, `TEAMS_BOT_APP_PASSWORD`.
  - `isTrustedServiceUrl()` — suffix allowlist guard, applied inside sendBotActivity.
  - Token: client-credentials grant, scope `https://api.botframework.com/.default`, cached.
  - Returns `{status:'sent'|'skipped', reason?}`; throws on non-OK HTTP. **Decision:** test message treats `skipped` as a skip outcome and a thrown error as a `failed` delivery row.
- Env vars already wired in `helm/templates/deployment.yaml` and `helm/templates/secret.yaml`.

### Conversation references: written, never read
- `ee/packages/microsoft-teams/src/lib/teams/bot/teamsConversationReferences.ts`
  - `upsertTeamsConversationReference(...)` — only writer. Called from `teamsBotHandler.ts:988` on every inbound activity.
  - Type `TeamsConversationReferenceType = 'personal' | 'groupChat' | 'channel'`.
  - NO reader exists yet → F001 adds it (first consumer of the table).
- Table (`ee/server/migrations/20260524090200_create_teams_conversation_references.cjs`):
  - PK `(tenant, microsoft_user_id, conversation_id)`; cols `service_url`, `conversation_type`, `tenant_id_aad`, `channel_id_bot_framework`, `last_activity_at`, timestamps.
  - Distributed on `tenant`, colocated with `teams_integrations`.

### Deliveries table — reusable, no migration needed
- `ee/server/migrations/20260524090000_create_teams_notification_deliveries.cjs`
  - `category` is **nullable, no CHECK** → `category='test'` is safe.
  - `status` CHECK ∈ {skipped, sent, delivered, failed}. Test uses skipped/sent/failed.
  - `destination_type` free text NOT NULL. Existing real value is `'user_activity'` (`teamsNotificationDelivery.ts:261`). Test uses `'bot_test'`.
  - `error_code` CHECK against `DELIVERY_ERROR_CODES` enum — **check whether 'transient'/existing codes cover test failures, or whether error_code should be left NULL for test sends.** (Recorder: `teamsDeliveryRecorder.ts`.)
  - UNIQUE `(tenant, idempotency_key)` → include attempt nonce for repeated tests (F012/T017).
- Recorder: `ee/packages/microsoft-teams/src/lib/notifications/teamsDeliveryRecorder.ts` — reuse `recordTeamsNotificationDelivery`-style insert; check its exact input shape (`destinationType`, `category`, `status`, `idempotencyKey`).

### Delivery / mapping helpers
- `teamsNotificationDelivery.ts:321 resolveTeamsRecipientLink(tenant, userId)` → `{ providerAccountId }` (the Microsoft account-link `provider_account_id`). Used as the Graph `users/{id}` id.

### Diagnostics pattern to mirror
- `shared/services/email/providers/MicrosoftGraphAdapter.ts:745 runMicrosoft365Diagnostics()`:
  - `runStep(id, title, fn)` → pushes `{id, title, startedAt, durationMs, status, http?, data?, error?}`; statuses `pass|fail|warn|skip`.
  - `recommendations` is a `Set<string>`; report has `createdAt`, `steps[]`, `overallStatus`, recommendations.
  - Reference test: `shared/services/email/providers/__tests__/MicrosoftGraphAdapter.diagnostics.test.ts`.
  - UI reference: `packages/integrations/src/components/email/admin/Microsoft365DiagnosticsDialog.tsx` (badge rendering pattern for steps).

### Availability / entitlement
- `ee/packages/microsoft-teams/src/lib/teams/teamsAvailability.ts`
  - `getTeamsAvailability({isEnterpriseEdition?, tenantId, userId})` → `{enabled, reason}`; reasons `ce_unavailable | tenant_not_configured | addon_required | enabled`.
  - addon check = `tenant_addons` where `addon_key = ADD_ONS.TEAMS` and (`expires_at` null or future).

### Action wiring pattern
- `ee/packages/microsoft-teams/src/lib/actions/integrations/teamsObservabilityActions.ts`: `export const listTeamsDeliveries = withAuth(listTeamsDeliveriesImpl);` (`'use server'`, `@alga-psa/auth/withAuth`). Mirror for `runTeamsDiagnostics` / `sendTeamsTestMessage`.
- Existing teams settings actions: `teamsActions.ts` → `saveTeamsIntegrationSettingsImpl` (line 225). **Confirm its permission check and reuse the same gate.**

### Settings UI
- `packages/integrations/src/components/settings/integrations/TeamsIntegrationSettings.tsx`
  - Uses `Card`/`CardHeader`/`CardContent` from `@alga-psa/ui`. Existing buttons have ids `teams-save-draft`, `teams-reload`, etc. Add new card after the package card (~line 602+).
  - `canPersist` style gating already present → reuse for disabling the new buttons (F032).

## Decisions

- **No new migration.** Reuse `teams_notification_deliveries` + `teams_conversation_references`.
- **Test message = proactive bot path** (`sendBotActivity`), NOT a Graph `sendActivityNotification`. This validates the Phase 2 transport and exercises the conversation-reference table.
- `destination_type='bot_test'`, `category='test'` for test delivery rows.
- Test message degrades to a recorded `skipped` row (with reason) for every unhealthy precondition — never silently no-ops.
- Diagnostics is read-only except for the recommendations it computes; no state mutation.
- Incremental settings panel, NOT the full 4-step wizard (that's a later PR).

## Resolved questions

1. **AAD object id vs bot `from.id` — RESOLVED (verified in code 2026-05-29).** The mapping aligns by design:
   - Write side: `teamsConversationReferences.ts:48-50` stores `microsoft_user_id = from.aadObjectId || from.id`. For a real Teams user, `aadObjectId` (AAD object id GUID) is populated.
   - Link side: `nextAuthOptions.ts:881-882` `extractProviderAccountId` returns `claims.oid` for Microsoft, with an explicit comment (878-883): "oid is the Azure AD object ID — the value Bot Framework sends as activity.from.aadObjectId ... prefer oid". So Microsoft `provider_account_id == oid == aadObjectId == microsoft_user_id`.
   - The bot's existing `resolveTeamsLinkedUser.ts:51` already depends on this (`findOAuthAccountLink('microsoft', aadObjectId)`), and it's shipped.
   - **Consequence:** drop the planned `resolveTeamsMicrosoftUserId` helper. Just reuse `resolveTeamsRecipientLink(tenant, userId).providerAccountId` (export it; currently file-private in `teamsNotificationDelivery.ts:321`) and key the F001 reader by it. (F003 updated.)
   - **Residual edge:** `ssoActions.ts:308` bulk email-backfill sets `provider_account_id = lowerEmail`. Microsoft links created that way won't match a conversation reference — but the bot already can't resolve those users. Diagnostics surfaces this via the F021/F022 warnings; out of scope to fix.

## Open questions (resolve during implementation)

1. **Permission gate** — exact permission enforced by `saveTeamsIntegrationSettingsImpl`; reuse verbatim.
3. **error_code for test failures** — reuse an existing `DELIVERY_ERROR_CODES` value or leave NULL? (CHECK constraint forbids arbitrary codes.)
4. **Where packages/integrations imports EE teams actions** — confirm the existing boundary/registry used so F037 follows it (CE has no EE package; check the stub pattern).

## Commands / runbook

```bash
# Worktree note: this tree is /Users/natalliabukhtsik/Desktop/projects/bigmac (NOT alga-psa).
# Inspect existing pieces
grep -rn "sendBotActivity\|isBotConnectorConfigured" ee/packages/microsoft-teams/src
grep -rn "recordTeamsNotificationDelivery\|TeamsDeliveryDestinationType\|DELIVERY_ERROR_CODES" ee/packages/microsoft-teams/src/lib/notifications

# Rebuild the EE package so server resolves new exports (F038)
# (mirror observability-loop F045 — confirm exact build script for @alga-psa/microsoft-teams)
npm run build -w @alga-psa/microsoft-teams   # verify the workspace/script name

# Run the new unit tests (server unit suite location used by prior loop)
# prior loop tests live under server/src/test/unit/internal-notifications/
```

## Out of scope (Phase 2+ — do NOT bundle)

- `teams_channel_mappings`, channel routing/delivery, expanded categories.
- `teams_user_preferences` / quiet hours / mention-only.
- Full setup wizard, configurable channel tab.
- 402/403 entitlement-response standardization.
- Trial flow / metering / billing.
- LLM/fuzzy bot intent, SSO token exchange.

## Suggested commit groups (≈7 commits)

`conversation-reader` → `test-message` → `diagnostics` → `settings-ui` → `i18n` → `wiring` → (tests land in each group's commit).
