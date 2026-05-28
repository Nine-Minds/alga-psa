# PRD: Teams Notification Delivery and Action Audit Observability

**Plan slug:** `2026-05-24-teams-observability-loop`
**Owning area:** EE / Microsoft Teams addon (`ee/packages/microsoft-teams`)
**Related plan:** `.ai/teams_improvements/microsoft-teams-addon-competitive-parity-plan.md` ("Best One-PR Agent Loop")

## Problem Statement

The Microsoft Teams addon (`ADD_ONS.TEAMS`) ships functional bot, message-extension, quick-action, and meeting features, but has **no persisted record of what notifications it attempted, what mutations it performed, or why anything failed.** This is the blocker for every Phase 2+ Teams feature (health dashboard, diagnostics, channel routing) because none of them have data to read.

Additionally, proactive channel messaging (Phase 2) requires Bot Framework `ConversationReference` + `serviceUrl` to be captured on first contact. Capturing now (even if not yet consumed) means Phase 2 starts with a populated table instead of waiting for users to interact again.

## User Value

- **Admins** can diagnose failed Teams notifications without reading server logs.
- **Engineers** can answer "did this notification go out?" deterministically.
- **Security/compliance** has an attributable audit trail for every Teams-originated PSA mutation.
- **Phase 2+** features are unblocked with real production data on Day 1.

## Goals

1. Every Teams notification attempt (skipped, sent, delivered, failed) creates a row in `teams_notification_deliveries`.
2. Every Teams-originated PSA mutation creates a row in `teams_audit_events`.
3. Bot `ConversationReference` + `serviceUrl` are captured on first inbound activity per (tenant, microsoft_user_id, conversation_id).
4. All new tables follow Citus multi-tenant rules: `tenant` in PK, every WHERE, every join; distributed on `tenant`.
5. **All new tables are registered in the tenant deletion temporal workflow** so tenant offboarding is complete.
6. Read-only server actions (`listTeamsDeliveries`, `listTeamsAuditEvents`) exist behind `withAuth` + permission check.

## Non-Goals (Explicit)

- No UI changes. No health dashboard. No admin diagnostics page.
- No channel mapping table. No setup wizard. No configurable channel tab.
- No 402/403 entitlement response standardization.
- No trial flow, per-seat metering, billing changes.
- No changes to existing notification/mutation behavior — pure instrumentation.
- No LLM/fuzzy intent matching.
- No bot SSO token exchange.
- No new metrics export, no Prometheus, no log shipping changes.

## Target Users

- **MSP admins** querying the new tables via server action (for now — UI in Phase 2).
- **Engineers** debugging Teams delivery in staging/production.
- **Future Phase 2 health dashboard** as a data consumer.

## Primary Flows

### Flow A: Notification delivery (instrumented)
1. `deliverTeamsNotificationImpl()` is invoked from notification pipeline.
2. Function computes idempotency key = SHA-256(`internal_notification_id`+`tenant`+`destination_type`+`destination_id`+`attempt_number`).
3. Before returning, function writes one row to `teams_notification_deliveries` with `status ∈ {skipped, sent, delivered, failed}` and structured `error_code` enum value when applicable.
4. If a row with the same `idempotency_key` already exists, the insert is a no-op (`ON CONFLICT DO NOTHING`).

### Flow B: Teams mutation audit
1. `teamsActionRegistry` dispatches one of: `assign_ticket`, `add_note`, `reply_to_contact`, `log_time`, `approval_response`, `create_ticket_from_message`, `update_from_message`.
2. After dispatch (success or caught error), one row is written to `teams_audit_events`.
3. Payload is **not** stored — only SHA-256 hash of canonicalized JSON payload plus safe metadata (actor, target, surface, action, result, error code).

### Flow C: ConversationReference capture
1. Bot receives any inbound activity (message, invoke, conversationUpdate).
2. Handler upserts `teams_conversation_references` keyed on (`tenant`, `microsoft_user_id`, `conversation_id`) with current `service_url`, `conversation_type`, `tenant_id_aad`, `updated_at`.
3. Phase 2 proactive messaging consumes this table; this PR only writes.

### Flow D: Admin read
1. Admin calls server action `listTeamsDeliveries({ filter, limit, cursor })` or `listTeamsAuditEvents({ filter, limit, cursor })`.
2. `withAuth` resolves tenant from session; `hasPermission(user, 'teams_integration', 'read')` gates access.
3. Action returns paginated rows scoped to the authenticated tenant.

## Data Model

### Table: `teams_notification_deliveries`

| Column                | Type                          | Notes |
|-----------------------|-------------------------------|-------|
| `tenant`              | uuid NOT NULL                 | Citus distribution key; in PK |
| `delivery_id`         | uuid NOT NULL                 | In PK |
| `internal_notification_id` | uuid                     | FK to `internal_notifications.id` (tenant, id) — soft FK if cross-table cycles |
| `category`            | text                          | Enum: `assignment` / `customer_reply` / `approval_request` / `escalation` / `sla_risk` |
| `destination_type`    | text NOT NULL                 | Enum: `user_activity` / `chat` / `channel` |
| `destination_id`      | text NOT NULL                 | Microsoft user id / chat id / channel id |
| `attempt_number`      | int NOT NULL DEFAULT 1        | |
| `idempotency_key`     | text NOT NULL                 | UNIQUE per (tenant, idempotency_key) |
| `provider_message_id` | text                          | Activity feed/chat/channel message id from Graph |
| `status`              | text NOT NULL                 | Enum: `skipped` / `sent` / `delivered` / `failed` |
| `error_code`          | text                          | Enum: see below |
| `error_message`       | text                          | Free text, truncated to 1KB |
| `retryable`           | boolean                       | |
| `provider_request_id` | text                          | Graph `request-id` header when available |
| `sent_at`             | timestamptz                   | |
| `delivered_at`        | timestamptz                   | |
| `responded_at`        | timestamptz                   | |
| `created_at`          | timestamptz NOT NULL DEFAULT now() | |

**Primary key:** `(tenant, delivery_id)`.
**Unique:** `(tenant, idempotency_key)` — supports `INSERT … ON CONFLICT DO NOTHING`.
**Index:** `(tenant, internal_notification_id)`, `(tenant, status, created_at DESC)`.
**Distribution:** `create_distributed_table('teams_notification_deliveries', 'tenant', colocate_with => 'teams_integrations')`.

### Table: `teams_audit_events`

| Column            | Type                          | Notes |
|-------------------|-------------------------------|-------|
| `tenant`          | uuid NOT NULL                 | Citus distribution key; in PK |
| `event_id`        | uuid NOT NULL                 | In PK |
| `actor_user_id`   | uuid                          | PSA user id resolved from token |
| `microsoft_user_id` | text                        | Teams `aadObjectId` if available |
| `surface`         | text NOT NULL                 | Enum: `bot` / `message_extension` / `quick_action` / `tab` |
| `action_id`       | text NOT NULL                 | Enum: 7 mutation actions |
| `target_type`     | text                          | e.g., `ticket`, `time_entry`, `approval` |
| `target_id`       | text                          | |
| `idempotency_key` | text                          | Same key Teams sent (if any), used for retried invokes |
| `payload_hash`    | text                          | SHA-256 of canonicalized JSON input |
| `result_status`   | text NOT NULL                 | Enum: `success` / `failure` |
| `error_code`      | text                          | Action-error taxonomy enum |
| `created_at`      | timestamptz NOT NULL DEFAULT now() | |

**Primary key:** `(tenant, event_id)`.
**Index:** `(tenant, actor_user_id, created_at DESC)`, `(tenant, target_type, target_id)`.
**Distribution:** `create_distributed_table('teams_audit_events', 'tenant', colocate_with => 'teams_integrations')`.

### Table: `teams_conversation_references`

| Column                | Type                          | Notes |
|-----------------------|-------------------------------|-------|
| `tenant`              | uuid NOT NULL                 | Citus distribution key; in PK |
| `microsoft_user_id`   | text NOT NULL                 | `aadObjectId` from activity |
| `conversation_id`     | text NOT NULL                 | Bot Framework conversation id |
| `conversation_type`   | text NOT NULL                 | `personal` / `groupChat` / `channel` |
| `service_url`         | text NOT NULL                 | Bot Framework service URL — required for proactive messages |
| `tenant_id_aad`       | text                          | AAD tenant id (Microsoft side) |
| `channel_id_bot_framework` | text                     | Always `msteams` for our use, kept for forward-compat |
| `last_activity_at`    | timestamptz NOT NULL          | |
| `created_at`          | timestamptz NOT NULL DEFAULT now() | |
| `updated_at`          | timestamptz NOT NULL DEFAULT now() | |

**Primary key:** `(tenant, microsoft_user_id, conversation_id)`.
**Distribution:** `create_distributed_table('teams_conversation_references', 'tenant', colocate_with => 'teams_integrations')`.

### Error code taxonomy (delivery)

Single text enum constraint, no separate type:
- `graph_throttled` (429)
- `graph_unauthorized` (401/403)
- `graph_not_found` (404)
- `graph_server_error` (5xx)
- `user_not_mapped` (no Microsoft user link)
- `addon_inactive` (entitlement gate hit)
- `integration_inactive` (`teams_integrations.install_status != 'active'`)
- `package_misconfigured` (missing base URL / app id)
- `transient` (network / timeout)
- `unknown`

The migration enforces the value with a `CHECK (error_code IS NULL OR error_code IN (...))` constraint to allow forward-compat additions without an enum type rebuild.

## Retention Strategy

**Decision:** Range-partition `teams_notification_deliveries` by `created_at` (monthly).

- Migration creates the parent table partitioned by `RANGE (created_at)` plus the next 3 months of child partitions.
- A separate small migration creates `cleanup_teams_notification_deliveries(retention_interval)` PL/pgSQL function that drops partitions older than `now() - retention_interval`. Default: `90 days`.
- `teams_audit_events` is **not** partitioned in this PR. Audit retention is typically longer (1y+) and partitioning can be added later without backfill. Add a `cleanup_teams_audit_events(interval)` function with default `365 days` so the knob exists.
- `teams_conversation_references` is **not** partitioned — it's an upsert-keyed table, expected to stay small (one row per (user, conversation)).

**Citus note:** Partitioned distributed tables in Citus require each partition to also be distributed. The migration uses `create_distributed_table` on the parent and Citus auto-distributes children. We verify this with a smoke query in the migration.

## Tenant Deletion Integration (CRITICAL)

**File:** `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts`
**Constant:** `TENANT_TABLES_DELETION_ORDER` (currently line 36+).

### Required edits

Add the three new tables **before** `teams_integrations` (line 94) so FK ordering holds. Group them with the existing Microsoft profile bindings comment block.

```diff
   // Microsoft profile bindings (dependents before profile definitions)
-  'microsoft_profile_consumer_bindings', 'teams_integrations', 'microsoft_profiles',
+  'microsoft_profile_consumer_bindings',
+  'teams_notification_deliveries', 'teams_audit_events', 'teams_conversation_references',
+  'teams_integrations', 'microsoft_profiles',
```

### Why this placement
- Partitioned table deletion: when the parent (`teams_notification_deliveries`) is deleted with `WHERE tenant=?`, partition pruning handles children. No need to enumerate each monthly partition.
- All three new tables reference `(tenant, …)` from `teams_integrations` via tenant column only (no hard FK to integration row), so they can be deleted before `teams_integrations` without FK violation regardless.
- Listing them explicitly (not relying on CASCADE) matches the existing pattern in the deletion order constant.

### Verification step in the plan
A dedicated feature/test confirms a tenant-deletion dry run on a seeded tenant removes rows from all three new tables and that order conflicts are absent.

## API Surface

### Server actions (new)

Both live in `ee/packages/microsoft-teams/src/lib/actions/integrations/teamsObservabilityActions.ts`:

```ts
export const listTeamsDeliveries = withAuth(async (user, { tenant }, params: {
  status?: 'skipped' | 'sent' | 'delivered' | 'failed';
  category?: string;
  since?: string;       // ISO datetime
  limit?: number;       // default 50, max 200
  cursor?: string;      // opaque pagination cursor
}) => { /* … */ });

export const listTeamsAuditEvents = withAuth(async (user, { tenant }, params: {
  surface?: 'bot' | 'message_extension' | 'quick_action' | 'tab';
  action_id?: string;
  actor_user_id?: string;
  result_status?: 'success' | 'failure';
  since?: string;
  limit?: number;
  cursor?: string;
}) => { /* … */ });
```

Both require `hasPermission(user, 'teams_integration', 'read')`.

### No new HTTP routes
These server actions are callable from the existing settings/admin context. No `/api/teams/*` additions in this PR.

## Multi-Tenant / Citus Compliance

- All three tables include `tenant` in the primary key.
- All inserts/queries include `tenant` in WHERE.
- All tables distributed on `tenant`, colocated with `teams_integrations`.
- No cross-tenant unique constraints.
- `idempotency_key` uniqueness is scoped per-tenant via `UNIQUE (tenant, idempotency_key)`.
- Reads in server actions use `withAuth` → `runWithTenant` → `createTenantKnex()` to set tenant context automatically.

## Privacy / Security

- **No raw payloads stored.** `payload_hash` is SHA-256 of canonicalized JSON; original payload is GC'd by the action handler.
- `error_message` truncated to 1KB to avoid leaking large customer text.
- Server actions gated by `hasPermission(user, 'teams_integration', 'read')`.
- Bot Framework JWT validation is **not** part of this PR (separate audit); assumed already enforced by existing bot handler.

## Risks

1. **Citus partitioned distributed tables.** Combining `PARTITION BY RANGE` with `create_distributed_table` has known sharp edges. Mitigation: smoke-test in CE migration first (without Citus), then verify on a Citus-enabled staging environment.
2. **Insert overhead on hot notification path.** ~1 extra insert per notification. Mitigation: insert is fire-and-forget within the same transaction; failures logged but do not break delivery.
3. **Idempotency-key collisions.** SHA-256 across 5 components → collision risk negligible, but `ON CONFLICT DO NOTHING` ensures a duplicate write is safe.
4. **Tenant deletion ordering.** Documented above; verified by feature F-TD-01.
5. **Worker rebuild scope creep.** `deliverTeamsNotificationImpl` may be called from `services/workflow-worker`. PR must verify and rebuild worker if so.

## Rollout / Migration

- Migrations are forward-only. `down()` drops tables (safe — no data depends on them in CE/prod yet).
- Deploy order: run migrations → deploy `@alga-psa/microsoft-teams` rebuild → restart server → restart workflow-worker (if it imports the package).
- No feature flag needed; instrumentation is internal.
- No user-visible changes — no docs/release-notes entry required beyond a one-line internal changelog.

## Acceptance Criteria

- [ ] Three migrations land in `ee/server/migrations/` (CE-compatible) and `ee/server/migrations/citus/` (where Citus-specific logic differs).
- [ ] `deliverTeamsNotificationImpl()` writes exactly one row per terminal outcome with correct `status` and `error_code`.
- [ ] Each of the 7 mutation actions in `teamsActionRegistry.ts` writes exactly one audit row on success and one on failure.
- [ ] First inbound bot activity from a (tenant, user, conversation) tuple writes a `teams_conversation_references` row; subsequent activities upsert.
- [ ] `tenant-deletion-activities.ts` lists all three new tables in `TENANT_TABLES_DELETION_ORDER`, before `teams_integrations`.
- [ ] Tenant deletion test (existing integration test) removes all rows from new tables.
- [ ] `listTeamsDeliveries` / `listTeamsAuditEvents` return only rows for the authenticated tenant; cross-tenant attempt is rejected by query construction.
- [ ] All new queries include `tenant` in WHERE; verified by grep + code review.
- [ ] No test mocks the database — integration tests hit a real DB per project convention.
- [ ] No raw payload text is persisted; verified by grepping inserts.

## Open Questions

1. **Should `cleanup_*` functions be invoked by anything in this PR?** Default: no — just create the functions, leave invocation to an operator/cron in a follow-up. Confirmed in scope as "knob exists" only.
2. **Permission key `teams_integration:read` — does it exist?** If not, the PR adds it to the permission seeder. Action: grep first; add only if missing.
3. **Conversation reference persistence — table vs JSON on `teams_integrations`?** Decided: separate table (Phase 2 will index by user/conversation and a JSON column on a single-row-per-tenant table is the wrong shape).
4. **Should `internal_notification_id` be a hard FK?** Decided: no. `internal_notifications` is large and FK across distributed shards is expensive; rely on tenant-scoped soft reference.
