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
