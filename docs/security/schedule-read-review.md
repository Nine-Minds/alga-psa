# Schedule read security review

The published PR includes historical smoke evidence at `/tmp/alga-smoke-evidence/security-dos-native-schedules-20261103-1242`. Its README records that the isolated tenant was restored and the worktree was clean on 2026-11-03. Treat that as prior evidence only; it does not verify this repair revision.

## Reproducible fixture

Use an isolated test database and an isolated PSA tenant. The setup script does not create users, change tenant product routing, or grant permissions. It requires an existing internal user with `user_schedule:read` and without `user_schedule:update`, and one existing ticket in that tenant. It uses deterministic entry UUIDs and only cleans rows whose tenant, deterministic IDs, and `Review fixture:` title prefix all match.

```bash
export DATABASE_URL='postgres://.../isolated_test_database'
export SCHEDULE_REVIEW_TENANT_ID='<isolated-psa-tenant-uuid>'
export SCHEDULE_REVIEW_READONLY_USER_ID='<internal-user-with-read-only-schedule-access>'
export SCHEDULE_REVIEW_BASE_URL='http://<review-host>:<port>'
node scripts/security-dos-schedule-review-fixture.mjs setup
```

Setup emits the generated ordinary appointment URL and recurring occurrence URL, plus the fixture entry ID for the dispatch/activity ticket. Copy those emitted links verbatim into review notes; links depend on the selected isolated tenant and review host, so none are published here as if they had been generated during this app-server-off assignment.

Fixture rows include one ordinary appointment, one daily recurring master with a selectable occurrence, 501 same-window eligible entries for calendar continuation, two out-of-window entries for SQL date-filter inspection, and a ticket-linked schedule record for dispatch and activity consumers. It does not create expensive recurrence overload rows. The generated 501-row set is the ordinary continuation fixture.

Cleanup is idempotent and tenant scoped:

```bash
node scripts/security-dos-schedule-review-fixture.mjs cleanup
```

Cleanup only deletes records owned by this fixture. It leaves canonical QA accounts, tenant settings, permissions, tickets, and all unrelated schedule records alone.

## Signed-in replay after review app preparation

The app server remained stopped for this implementation task. During subsequent review preparation, use an approved isolated review app and do not change the tenant's product route guard.

1. Sign in as the fixture's read-only user. Confirm the visible calendar loads while schedule editing controls remain unavailable.
2. Open the exact ordinary link emitted by setup, reload it, then use browser Back to dismiss the selection and Forward to reopen it. Confirm the URL selects the emitted day and opens the same appointment.
3. Open the exact recurring occurrence link emitted by setup and reload. Confirm the occurrence date is selected and the appointment popup shows that occurrence. Dismiss it, then repeat with an invalid or deleted occurrence URL; it must show the normal unavailable behavior without record details.
4. In the same isolated tenant, open Dispatch for the fixture day and confirm the ticket-linked schedule item appears. Open its related activity detail and confirm a bounded incomplete read is reported as incomplete rather than presented as a complete result. Also exercise the consumer with a rejected schedule action if review instrumentation permits it.
5. In Schedule, load the fixture day and continue through the 501 candidates. Confirm entries do not duplicate or disappear. Inspect the action's SQL/logged query to confirm the two outside-window rows are filtered before the candidate limit.
6. Change the date and an overlay filter while a continuation or entry selection response is pending. Confirm the old response does not update the active calendar or reopen a dismissed selection.
7. Run the cleanup command and verify only the fixture-owned IDs were removed.

The co-managed `/msp/schedule` route remains restricted. Co-managed native access and permission behavior are covered by offline provider tests; signed-in product replay must use the product surface permitted for the selected tenant, without changing route guards to make this path available.

The overload probes from the historical smoke are not part of the normal review fixture. If later review needs those probes, create and clean them as a separate explicit fixture and verify cleanup before restoring the tenant.
