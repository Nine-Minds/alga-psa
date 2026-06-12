# DB transaction guardrails and after-commit work

Rules and safety nets introduced by the SLA close/reopen deadlock fix
(`.ai/sla_close_deadlock_proper_fix_plan.md` has the full investigation).

## Rules for transactional code

1. **One DB writer per ticket row per logical operation.** SLA column
   mutations happen exactly once, in the caller's transaction. The SLA
   "backend" (`ISlaBackend`) schedules external side effects only — it never
   re-does a DB write. The CE `PgBossSlaBackend` mutation hooks are no-ops.
2. **No network or cross-connection work inside an open transaction.** Event
   publishing and backend scheduling run after commit:
   - `registerAfterCommit(trx, hook, label?)` (`@alga-psa/db`) queues work
     that the transaction-owning `withTransaction` frame flushes after a
     successful commit, in registration order. Hooks are dropped on rollback.
     Nested `withTransaction` frames share the owner's `trx`, so their hooks
     flush once, at the outer commit. Pass a `label` (e.g.
     `"TICKET_CLOSED ticket=<id>"`) so a failed hook is traceable in logs.
     Hook failures are logged and swallowed: events are at-most-once — a
     publish that fails after commit is lost (no outbox), the committed write
     stands.
   - SLA write functions return `backendActions`; callers dispatch them with
     `dispatchSlaBackendActions()` (`@alga-psa/sla`) after their transaction
     resolves.
3. **SLA writes are serialized per ticket.** Every SLA write entry point
   takes `pg_advisory_xact_lock(hashtext('sla:<tenant>:<ticket>'))` first
   (`acquireTicketSlaLock`). Transaction-scoped, so it is safe under
   pgbouncer transaction pooling and self-releases at commit/rollback.

## Event bus poison resistance

- Handler success is tracked per `(event, handler)` (Redis set
  `processed_event_handlers:<tenant>`), so one failing handler's redelivery
  never re-runs co-subscribers that already succeeded (e.g. outbound
  webhooks on the shared default-channel streams). Subscribers that share a
  stream with same-named handler functions must pass a distinct
  `subscriberId` to `subscribe()`.
- Messages delivered more than `eventBus.maxDeliveries` times (default 10,
  env `REDIS_STREAM_MAX_DELIVERIES`) are moved to `<stream>:dead-letter`
  and acked. Dead-letter entries keep the original payload plus
  `sourceStream`/`sourceMessageId`/`deliveries`/`deadLetteredAt` for
  inspection and replay. The write is idempotent (marker set
  `dead_lettered_messages:<stream>`, 3-day TTL), so an xAdd-succeeded /
  xAck-failed retry does not duplicate the entry. Monitor dead-letter
  volume.
- A handler that throws gets a bounded retry (redelivery up to the cap),
  not an infinite storm.

## Postgres timeouts (defense in depth)

Migration `20260609120000_set_app_role_db_guardrail_timeouts.cjs` sets on
the app role (`DB_USER_SERVER`, default `app_user`):

- `idle_in_transaction_session_timeout = 60s` — a session idle
  mid-transaction is aborted and releases its locks. This fires on a single
  continuous 60s idle gap between statements, not on total transaction
  duration; steady statement loops are unaffected. 60s (not lower) leaves
  headroom for a slow external call awaited between statements — waiters
  are already protected by lock_timeout regardless of how long the holder
  sits.
- `lock_timeout = 8s` — statements fail fast instead of queueing behind a
  stuck lock holder.

These are role-level GUCs (not pool `afterCreate` SETs) because pgbouncer
runs `pool_mode = transaction`: session-level SETs issued at connection
creation do not reliably follow a client across backend remapping, while
role GUCs resolve server-side at backend session start. The admin/migration
role is deliberately excluded so long-running DDL stays legal.

`pgbouncer/pgbouncer.ini.template` keeps `idle_transaction_timeout = 120`
as a last-resort reaper for whatever the role GUCs don't cover. It must
stay above the role GUC so the gentler server-side abort fires before
pgbouncer kills the connection.

Verify on a deployment:

```sql
-- as the app user, through pgbouncer
SHOW idle_in_transaction_session_timeout;  -- 60s
SHOW lock_timeout;                         -- 8s
```
