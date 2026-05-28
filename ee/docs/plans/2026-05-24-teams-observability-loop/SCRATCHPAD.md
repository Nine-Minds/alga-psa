# SCRATCHPAD — Teams Observability Loop

## Verified file paths (2026-05-24)

- **Source plan:** `.ai/teams_improvements/microsoft-teams-addon-competitive-parity-plan.md`
- **Notification entry point:** `ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts`
  - Exports `TeamsNotificationDeliveryResult` discriminated union (`skipped` | `delivered` | `failed`). The plan's "sent" status is implicit (intermediate). We persist as separate `sent_at`/`delivered_at` timestamps rather than a separate row.
- **Action registry:** `ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionRegistry.ts`
- **Action errors helper:** `ee/packages/microsoft-teams/src/lib/teams/actions/teamsActionErrors.ts` — reuse its error codes when mapping to the audit `error_code` column.
- **EE migrations dir:** `ee/server/migrations/`
  - Most recent Teams migration: `20260423131000_add_default_meeting_organizer_to_teams_integrations.cjs`
  - Reference for the distribution pattern: `20260307153000_create_teams_integrations.cjs` (uses `colocate_with => 'microsoft_profiles'`; ours uses `colocate_with => 'teams_integrations'`).
- **Citus-specific migrations dir:** `ee/server/migrations/citus/` — use ONLY if CE migration cannot satisfy Citus path (e.g., distribution-outside-transaction requirements).
- **Tenant deletion activity:** `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts`
  - Target constant: `TENANT_TABLES_DELETION_ORDER` (starts line 36).
  - Existing Teams row: line 94 — `'microsoft_profile_consumer_bindings', 'teams_integrations', 'microsoft_profiles',`
  - Insert new tables **before** `teams_integrations` to keep the dependents-first ordering convention.

## Decisions made

1. **Three separate tables, not one super-table.** Deliveries, audit, and conversation references have different retention shapes and read patterns. Bundling them is convenient now, painful in Phase 2.
2. **Conversation references = separate table, not JSON on `teams_integrations`.** Proactive messaging needs per-user/per-conversation indexing. JSON column doesn't index well, and `teams_integrations` is one-row-per-tenant.
3. **No partitioning on `teams_audit_events` in this PR.** Audit retention is typically multi-year and audit volume is much lower than delivery volume. Cleanup function exists; partition migration deferred.
4. **Range partitioning on deliveries (monthly), Citus distributed on tenant.** Citus supports partitioned distributed tables but requires verification — flagged as risk #1 in PRD.
5. **Idempotency key for deliveries:** SHA-256 over `notification_id|tenant|destination_type|destination_id|attempt_number`. Stored as text. UNIQUE per tenant.
6. **Payload hash for audit:** SHA-256 over canonicalized JSON. No raw payload persistence.
7. **`error_code` as CHECK-constrained text, not Postgres ENUM type.** ENUM types in Citus distributed tables are awkward to ALTER; CHECK lets us add new codes via simple migration.
8. **`internal_notification_id` is NOT a hard FK.** Cross-shard FK cost on Citus + that table's size makes a soft reference better.

## Commands

```bash
# Run migrations
npm run migrate

# Rebuild the package after changes
npx nx build microsoft-teams

# Inspect Citus distribution status
psql -c "SELECT logicalrelid::regclass, partmethod, repmodel FROM pg_dist_partition WHERE logicalrelid::text LIKE 'teams_%';"

# Inspect partitions of deliveries table
psql -c "SELECT relname FROM pg_class WHERE relname LIKE 'teams_notification_deliveries%' AND relkind IN ('r','p');"

# Run tenant deletion integration test (existing harness)
npm run test:integration -- tenant-deletion

# Grep for raw payload anti-patterns in new code
rg "raw_payload|payload_text|payload_json" ee/packages/microsoft-teams/src/lib/

# Grep workflow-worker for teams notification import
rg "deliverTeamsNotificationImpl|teamsActionRegistry" services/workflow-worker/
```

## Gotchas

- **`teams_integrations` migration uses `exports.config = { transaction: false }`** because `create_distributed_table` cannot run inside a transaction on Citus. Mirror that for our migrations.
- **Existing `teams_integrations` is colocated with `microsoft_profiles`.** New tables must colocate with `teams_integrations` (which transitively colocates with `microsoft_profiles`).
- **`createTenantKnex()` returns `{ knex, tenant }`** — use the destructured `tenant` to write rows; do NOT trust client-supplied tenant.
- **Bot Framework `serviceUrl`** must be trusted only after Bot Framework JWT validation. We rely on existing bot middleware for this (out of scope to re-verify in this PR, but assumed).
- **Citus partitioned tables:** `create_distributed_table` on the parent automatically distributes child partitions, but new partitions added later must also be distributed. The cleanup function should NOT drop the parent; only child partitions.
- **`ee/temporal-workflows/dist/`** contains built artifacts. Do not edit there — edit `src/`. Build step regenerates dist.

## Open questions to confirm in PR review

1. Permission key — does `teams_integration:read` already exist? Check `server/src/lib/auth/permissions.ts` (or wherever the seeder lives) before adding.
2. Cursor pagination encoding — confirm there isn't an existing cursor helper in the codebase to reuse rather than rolling our own base64 tuple.
3. Should `cleanup_*` functions be called from anywhere in this PR (e.g., a workflow trigger), or is creating-the-function-only acceptable? PRD currently says function-only; reaffirm during review.

## 2026-05-24 schema batch notes

- Added migrations:
  - `ee/server/migrations/20260524090000_create_teams_notification_deliveries.cjs`
  - `ee/server/migrations/20260524090100_create_teams_audit_events.cjs`
  - `ee/server/migrations/20260524090200_create_teams_conversation_references.cjs`
- Important Postgres constraint: declarative `PARTITION BY RANGE (created_at)` cannot support a parent-level `PRIMARY KEY (tenant, delivery_id)` or `UNIQUE (tenant, idempotency_key)` because every unique constraint on a partitioned table must include the partition key (`created_at`). To keep monthly delivery partitions and still make idempotent inserts deterministic, the migration adds `teams_notification_delivery_idempotency` with `PRIMARY KEY (tenant, idempotency_key)`. `teams_notification_deliveries` therefore uses `PRIMARY KEY (tenant, delivery_id, created_at)` and the recorder will reserve the idempotency key before writing the partitioned row.
- Tenant deletion registration includes the idempotency guard table before the Teams integration row:
  - `teams_notification_delivery_idempotency`
  - `teams_notification_deliveries`
  - `teams_audit_events`
  - `teams_conversation_references`
- Migrations use `exports.config = { transaction: false }` and skip Citus distribution with a warning when `create_distributed_table` is unavailable, matching the existing Teams migration pattern.
- `node -c` passes for all three new migrations.
- Added static contract tests:
  - `server/src/test/unit/migrations/teamsObservabilityMigrations.test.ts`
  - `server/src/test/unit/temporal/teamsObservabilityTenantDeletionOrder.test.ts`
  These cover migration shape, partition creation, cleanup function presence, Citus hooks, CE-only migration placement, and tenant deletion ordering. Real DB migration/run tests still need the local test database or Citus environment.
- Test command: `cd server && npx vitest run src/test/unit/migrations/teamsObservabilityMigrations.test.ts src/test/unit/temporal/teamsObservabilityTenantDeletionOrder.test.ts` → passed 9 tests. Root `npm run test:local -- ...` failed because the `dotenv` binary was not available in this checkout.

## 2026-05-24 delivery recorder notes

- Added `ee/packages/microsoft-teams/src/lib/notifications/teamsDeliveryRecorder.ts`.
  - Computes idempotency key as SHA-256 over `internal_notification_id|tenant|destination_type|destination_id|attempt_number`.
  - Reserves `(tenant, idempotency_key)` in `teams_notification_delivery_idempotency` and inserts into `teams_notification_deliveries` only when reservation succeeds.
  - Truncates `error_message` to 1024 characters.
  - Uses `createTenantKnex(input.tenant)` and logs/swallows persistence failures so notification delivery behavior is not blocked by observability writes.
- Instrumented `deliverTeamsNotificationImpl()`:
  - skipped paths write `status='skipped'` with mapped error codes where the taxonomy has one;
  - delivered path writes `status='delivered'`, `sent_at`, `delivered_at`, `provider_message_id`, and `provider_request_id`;
  - Graph failure path maps HTTP status to the delivery error taxonomy and persists `provider_request_id`;
  - thrown/network failure path persists `error_code='transient'`.
- Added tests:
  - `server/src/test/unit/internal-notifications/teamsDeliveryRecorder.test.ts`
  - `server/src/test/unit/internal-notifications/teamsNotificationDeliveryObservability.test.ts`
- Test command: `cd server && npx vitest run src/test/unit/internal-notifications/teamsDeliveryRecorder.test.ts src/test/unit/internal-notifications/teamsNotificationDeliveryObservability.test.ts` → passed 6 tests.
- Typecheck: `npm -w @alga-psa/ee-microsoft-teams run typecheck` → passed.

## 2026-05-24 action audit notes

- Added `ee/packages/microsoft-teams/src/lib/teams/actions/teamsAuditRecorder.ts`.
  - Stores only metadata plus `payload_hash`; no raw action payload columns or text are persisted.
  - `payload_hash` is SHA-256 over canonical JSON with sorted object keys.
  - Persistence failures are logged and swallowed so Teams actions keep their existing behavior.
- Instrumented `teamsActionRegistry.ts` at the mutation boundary:
  - audited action set: `assign_ticket`, `add_note`, `reply_to_contact`, `log_time`, `approval_response`, `create_ticket_from_message`, `update_from_message`;
  - success, availability failure, authorization failure, and caught execution failure paths call `recordTeamsMutationAudit`;
  - target metadata is derived from result target, resolved target, request target, or normalized input.
- Added `microsoftUserId?: string | null` to `TeamsActionRequest` and threaded it from bot, message-extension, and quick-action handlers via their Teams activity `from.aadObjectId`/`from.id` helpers.
- Added tests:
  - `server/src/test/unit/lib/teams/actions/teamsAuditRecorder.test.ts`
  - `server/src/test/unit/lib/teams/actions/teamsAuditInstrumentation.contract.test.ts`
- Test command: `cd server && npx vitest run src/test/unit/lib/teams/actions/teamsAuditRecorder.test.ts src/test/unit/lib/teams/actions/teamsAuditInstrumentation.contract.test.ts` → passed 5 tests.
- Grep: `rg "raw_payload|payload_text|JSON\\.stringify.*payload" ee/packages/microsoft-teams/src/lib/teams/actions/teamsAuditRecorder.ts || true` → no matches.
- Broader direct run attempted: `cd server && npx vitest run src/test/unit/lib/teams/actions/teamsAuditRecorder.test.ts src/test/unit/lib/teams/actions/teamsActionRegistry.test.ts src/test/unit/lib/teams/bot/teamsBotHandler.test.ts src/test/unit/lib/teams/messageExtension/teamsMessageExtensionHandler.test.ts src/test/unit/lib/teams/quickActions/teamsQuickActionHandler.test.ts`. Existing Teams handler/action tests failed on legacy/incomplete mocks and real tenant-resolution DB paths (e.g. `getTenantIdBySlug` missing from `@alga-psa/db` mock, invalid UUID `tenant-1` in a real query). Kept new coverage focused on recorder behavior and source-level instrumentation contracts.

## 2026-05-24 conversation reference notes

- Added `ee/packages/microsoft-teams/src/lib/teams/bot/teamsConversationReferences.ts`.
  - Extracts Microsoft user id from `from.aadObjectId` with fallback to `from.id`.
  - Requires `conversation.id` and `serviceUrl`; incomplete activities are skipped without opening a DB handle.
  - Upserts into `teams_conversation_references` on `(tenant, microsoft_user_id, conversation_id)` and updates `service_url`, `conversation_type`, `tenant_id_aad`, `channel_id_bot_framework`, `last_activity_at`, and `updated_at`.
  - Uses `createTenantKnex(input.tenantId)` and logs/swallows write failures so inbound bot handling remains unchanged if observability persistence fails.
- Instrumented `handleTeamsBotActivity()` after tenant resolution so message, invoke, and conversationUpdate activities all pass through the capture helper before the existing conversation-type support gate.
- Exported the helper from the microsoft-teams package index.
- Added `server/src/test/unit/lib/teams/bot/teamsConversationReferences.test.ts` for insert/update/no-duplicate behavior, incomplete activity skips, and conversation type normalization.
- Test command: `cd server && npx vitest run src/test/unit/lib/teams/bot/teamsConversationReferences.test.ts` -> passed 3 tests.
- Typecheck: `npm -w @alga-psa/ee-microsoft-teams run typecheck` -> passed.

## 2026-05-24 server action notes

- Added `ee/packages/microsoft-teams/src/lib/actions/integrations/teamsObservabilityActions.ts`.
  - Exports `listTeamsDeliveries` and `listTeamsAuditEvents` wrapped in `withAuth`.
  - Gates both reads through `hasPermission(user, 'teams_integration', 'read', knex)`.
  - Uses `createTenantKnex(tenant)` and every query starts with `.where({ tenant })`.
  - Supports documented filters plus stable descending cursor pagination over `(created_at, delivery_id)` / `(created_at, event_id)`.
  - Cursor is opaque base64 JSON of `[created_at_iso, id]`; malformed cursors throw `Malformed Teams observability cursor`.
  - Limit defaults to 50 and clamps to 200.
- Exported observability actions through both `src/actions/index.ts` and `src/lib/index.ts`. Existing `TeamsDeliveryRow` and `TeamsAuditEventRow` types are public through the package index exports.
- Added `teams_integration:read` to:
  - `server/seeds/dev/47_permissions.cjs`
  - `ee/server/seeds/onboarding/psa/02_permissions.cjs`
  Admin role seed behavior grants all MSP permissions, so new PSA onboarding/dev admin roles receive it automatically.
- Added `server/src/test/unit/lib/teams/actions/teamsObservabilityActions.test.ts` for tenant scoping, permission rejection, limit clamp, cursor validation/pagination, and audit filters.
- Static grep: `rg "teams_notification_deliveries|teams_audit_events|teams_conversation_references|teams_notification_delivery_idempotency" ee/packages/microsoft-teams/src/lib -n` -> all package code paths include `tenant` in insert columns or query WHERE.
- Permission grep: `rg "teams_integration.*read|resource: 'teams_integration'|teams_integration', action: 'read'" server/seeds ee/server/seeds ee/packages/microsoft-teams/src server/src/test/unit/lib/teams/actions/teamsObservabilityActions.test.ts -n` -> permission and gate present.
- Test command: `cd server && npx vitest run src/test/unit/lib/teams/actions/teamsObservabilityActions.test.ts` -> passed 5 tests.
- Typecheck: `npm -w @alga-psa/ee-microsoft-teams run typecheck` -> passed.

## 2026-05-24 final verification batch

- Added `server/src/test/unit/internal-notifications/teamsNotificationDeliveryImplObservability.test.ts`.
  - Covers skipped rows for inactive add-on, inactive integration, unmapped user, and package misconfiguration.
  - Covers delivered rows with `providerMessageId` and `providerRequestId` from Graph `request-id`.
  - Covers Graph 429/401/403/404/500 mappings plus transient thrown errors.
  - Test command: `cd server && npx vitest run src/test/unit/internal-notifications/teamsNotificationDeliveryImplObservability.test.ts` -> passed 11 tests.
- Extended migration contract tests:
  - Delivery partitioned PK is asserted as `(tenant, delivery_id, created_at)` with tenant-scoped idempotency sidecar `(tenant, idempotency_key)`.
  - Delivery cleanup function assertions cover `pg_inherits`, parent table filtering, retention cutoff, and partition `DROP TABLE`.
  - Audit cleanup function assertions cover range delete and returned row count.
  - Test command: `cd server && npx vitest run src/test/unit/migrations/teamsObservabilityMigrations.test.ts src/test/unit/temporal/teamsObservabilityTenantDeletionOrder.test.ts` -> passed 11 tests.
- Tenant deletion verification:
  - Static contract confirms all observability tables are listed before `teams_integrations`.
  - Static contract confirms the deletion loop resolves the tenant column and deletes every listed table via `.where({ [tenantColumn]: tenantId })`, which deletes from the partitioned parent table and lets Postgres prune child partitions.
  - Zero-row safety is covered by the same deletion-loop contract: delete is skipped when `count === 0`, so empty observability tables are no-ops.
- Migration syntax verification: `node -c` passed for all three observability migrations.
- Package rebuild: `npm -w @alga-psa/ee-microsoft-teams run build` -> passed; dist outputs regenerated in ignored package build output.
- Workflow worker grep: `rg "deliverTeamsNotificationImpl|teamsActionRegistry" services/workflow-worker -n` -> no matches. Deployment note: workflow-worker rebuild is not required by these imports.
- Added `ee/packages/microsoft-teams/CHANGELOG.md` with the internal one-line observability entry.
- Local environment note: live CE/Citus migration and tenant-deletion integration tests were not run against a database here; `.env.localtest` points at `/run/secrets/...` files that are not present in this checkout, and `pg_isready` is unavailable. Coverage for those checklist items is static contract/syntax verification in this workspace.

## Things explicitly out of scope (do not let scope creep in)

- Channel mapping table (`teams_channel_mappings`) — Phase 2.
- Setup wizard UI — Phase 1.5.
- Group/channel tab — Phase 3.
- 402/403 entitlement response — separate decision.
- Trial flow / per-seat metering — billing decision.
- Health dashboard UI — Phase 2 (reads from tables we're creating here).
- Bot SSO token exchange — Phase 4.
- LLM intent matching — Phase 4.

## References

- Source plan: `.ai/teams_improvements/microsoft-teams-addon-competitive-parity-plan.md`
- Related: `.ai/tenant-deletion-temporal-workflow-plan.md`
- Citus migration workflow: `.ai/citus_migrations_workflow.md`
- Similar precedent (audit table): `ee/server/migrations/20251217120000_create_extension_audit_logs.cjs`
