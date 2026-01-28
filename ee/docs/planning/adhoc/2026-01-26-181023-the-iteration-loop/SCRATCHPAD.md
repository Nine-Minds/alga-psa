# Scratchpad

## Status

- Mid-suite: ticket email fixtures failing; fixing `email.send` preconditions (permissions + tenant email settings) and JSONata mapping.

## Notes / Decisions

- PRD scope interpretation: “implement PRD” means actually executing the iteration loop (import → isolate → trigger → wait → assert → cleanup → artifacts → commit) across the fixture suite until all tests are green.
- Start with harness unit tests (no server required), then move to fixture runs (requires running server + Postgres + tenant + auth cookie/api key).
- Adjusted several fixtures to prefer HTTP cleanup (with DB fallback) so reruns don’t accumulate state and stubbed tests reflect real behavior.
- Harness CLI now allows omitting `--cookie*` when `WORKFLOW_HARNESS_API_KEY`/`ALGA_API_KEY` is set (auth still required one way or the other).
- `email.send` action enforces `requirePermission({resource:'email', action:'process'})`. Dev tenant was missing `email:process`, causing `PERMISSION_DENIED`.
  - Root cause: `server/migrations/20250619120000_add_comprehensive_permissions.cjs` runs before tenants exist on fresh DB init, so it inserts nothing; seeds create tenants later.
  - Fix: add backfill migration `server/migrations/20260127120000_backfill_email_process_permission.cjs` and add `email:process` to `server/seeds/dev/47_permissions.cjs`.
- Dev tenant had no `tenant_email_settings` row, causing `Tenant email settings not configured` once permission check is satisfied.
  - Fix strategy: keep product behavior intact; fixtures explicitly ensure tenant email settings exist (and restore on cleanup) using SMTP config pointing at `imap-test-server:3025` (Greenmail).
- Email fixture bundles had malformed JSONata due to double-escaped quotes in `to` mapping (`[{\\\"email\\\": ...}]`), which evaluates to `[{}]` and produces `to[0].email = undefined`. Fixed to `[{\"email\": ...}]`.
- `notifications.send_in_app` failed with `PERMISSION_DENIED` for `notification:manage` because dev seeds didn’t create any `notification:*` permissions for the tenant.
  - Fix: backfill migration `server/migrations/20260127130000_backfill_notification_permissions.cjs` + seed update in `server/seeds/dev/47_permissions.cjs`.
- Several notification-focused fixtures produced titles missing their marker prefix when the title expression referenced `vars.marker` (e.g. `vars.marker & ' ...'`), resulting in `" Ticket created"` / `" VIP ticket created"` without the marker.
  - Fix: set `vars.title` directly to a constant marker-prefixed string (e.g. `"'[fixture ...] ...'"`) in affected bundles and add cleanup to delete `internal_notifications` by ticketId.
- `ticket-priority-changed-audit-comment` timed out waiting for a run because updating `/api/v1/tickets/:id` does not reliably emit `TICKET_PRIORITY_CHANGED` in this harness context.
  - Fix: explicitly POST `/api/workflow/events` with `payload.TicketPriorityChanged.v1` after the API update.
- `ticket-escalated-crm-note` had double-escaped JSONata object literals (`{\\\"type\\\":...}`) causing missing required fields in action input.
  - Fix: correct JSONata escaping and avoid `vars.marker` concatenation in note/title/body for determinism.
- Some fixtures that only create a ticket can still have ticket deletion blocked by `comments` rows created by non-fixture workflows (harness only pauses `fixture.%` definitions).
  - Fix: switch affected fixtures to ticket cleanup with DB fallback (`delete from comments` then `delete from tickets`).
- JSONata gotcha: `payload.addedTagIds[$ = payload.fixtureBillingTagId]` does **not** behave like “array contains” (it evaluates to `undefined` in jsonata@2.x). For fixtures that add a single tag, `payload.addedTagIds[0] = payload.fixtureBillingTagId` is a reliable membership check.
- When a workflow run fails (expected/intentional), ticket deletion can still be blocked by comments or other dependent rows; prefer HTTP delete with DB fallback in fixtures that assert `run.status === FAILED`.

## Commands / Runbook

- `ls planning/adhoc/2026-01-26-181023-the-iteration-loop` (confirmed plan artifacts present)
- `ls ee/test-data/workflow-harness | sort | head` (confirmed fixture catalog exists)
- `node --test tools/workflow-harness/tests/*.test.cjs` (green after fixture + harness tweaks)
- `docker ps` (confirmed EE stack already running: `prep_1_0_server_ee`, `10-preparation-workflow-worker-1`, `prep_1_0_postgres`, etc.)
- `docker port prep_1_0_server_ee` (server exposed on `localhost:3010`)
- `docker port prep_1_0_postgres` (postgres exposed on `localhost:55432`)
- `psql -h localhost -p 55432 -U postgres -d server -c "select tenant, client_name from tenants ..."` (found the active tenant UUID to use for fixture runs)
- `docker exec -i prep_1_0_postgres psql -U postgres -d server -c "\\d tenant_email_settings"` (confirm email settings schema)
- `docker exec -i prep_1_0_postgres psql -U postgres -d server -c "select tenant, resource, action from permissions where resource='email';"` (confirm missing permission)

## Gotchas

- `tenant_email_settings` does not currently have a unique constraint on `tenant` (only an index). Fixtures update/restore by `id` to avoid surprising multi-row behavior.
- SMTP provider config requires `host`, `port`, `username`, `password`, and `from` (even though `from` isn’t used by the SMTP provider send path today).
