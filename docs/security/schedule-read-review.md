# Schedule read security review

The published PR includes historical smoke evidence at `/tmp/alga-smoke-evidence/security-dos-native-schedules-20261103-1242`. Its README records a prior isolated-tenant restoration on the original PR revision. Treat it as historical evidence only.

## PSA UI fixture

The SQL fixture prepares the `/msp/schedule` UI replay for an isolated **PSA** tenant. It creates an ordinary appointment, a recurring master with a selectable occurrence, a ticket-linked appointment for the owner’s dispatch/activity feed, and two out-of-window appointments for SQL filtering inspection. It intentionally creates no 501-entry continuation set: the PSA native read path does not return continuation metadata. Continuation is exercised only by the co-managed provider harness below.

The setup script does not create users, change product routing, grant permissions, or create calendar shares. It requires:

- `SCHEDULE_REVIEW_OWNER_USER_ID`: an existing internal owner with `user_schedule:read`, no `user_schedule` write permissions, `technician_dispatch:read`, and `ticket:read`. The owner’s rows are assigned to them so they appear in that owner’s activity feed. The product permits sole assignees to edit their own entries with `user_schedule:read`, so this principal is minimum-permission for these owned rows, not a read-only viewer.
- `SCHEDULE_REVIEW_VIEWER_USER_ID`: a distinct internal user with `user_schedule:read`, no `user_schedule` write permissions, and an existing `read` share to the owner’s personal calendar. The viewer is not assigned to fixture rows, so the shared rows resolve with `can_edit: false`.
- One existing ticket assigned to the owner. The owner’s `technician_dispatch:read`, `ticket:read`, and `user_schedule:read` permissions are checked before setup. Activity feed data is self-scoped; there is no separate activity permission checked by this fixture.

```bash
export DATABASE_URL='postgres://.../isolated_test_database'
export SCHEDULE_REVIEW_TENANT_ID='<isolated-psa-tenant-uuid>'
export SCHEDULE_REVIEW_OWNER_USER_ID='<internal-minimum-permission-owner-uuid>'
export SCHEDULE_REVIEW_VIEWER_USER_ID='<internal-read-only-shared-calendar-viewer-uuid>'
export SCHEDULE_REVIEW_BASE_URL='http://<review-host>:<port>'
node scripts/security-dos-schedule-review-fixture.mjs setup
node scripts/security-dos-schedule-review-fixture.mjs setup
```

Each setup emits the ordinary appointment URL and recurring occurrence URL. Copy those generated URLs verbatim into review notes; they depend on the isolated tenant and review host. Repeated setup is idempotent: it replaces only rows with this fixture’s deterministic IDs and `Review fixture:` title prefix.

During this repair, setup was run twice against a disposable PostgreSQL database and emitted these exact links twice. They are validation artifacts only: the database was cleaned twice and removed, and no app server is listening at this host.

- `http://127.0.0.1:3000/msp/schedule?entryId=65496818-411d-5671-90d8-f0979b2dc8b1&scheduleDate=2026-11-22&scheduleView=day`
- `http://127.0.0.1:3000/msp/schedule?entryId=46f7b75f-2faa-5a6f-afa2-e7ad91f4e95a&occurrenceStart=2026-11-24T09%3A00%3A00.000Z&scheduleDate=2026-11-24&scheduleView=day`

Cleanup is tenant scoped and idempotent:

```bash
node scripts/security-dos-schedule-review-fixture.mjs cleanup
node scripts/security-dos-schedule-review-fixture.mjs cleanup
```

The script only deletes this fixture’s schedule entries and their assignees. It leaves both users, permissions, calendar shares, tenant routing, tickets, and unrelated records unchanged. The fixture does not create overload recurrence data.

## Co-managed provider continuation harness

`packages/co-managed/src/__tests__/sharedWorkSchedule.behaviour.test.ts` runs the real `readCoManagedNativeSchedules` provider against its deterministic in-memory tenant/authorization store. The test named `provider review fixture returns a bounded page and keyset continuation for 501 eligible candidates` seeds exactly 501 eligible rows plus two out-of-window rows, reads page one, follows the returned keyset cursor, and verifies that only the final eligible row remains. Run it with:

```bash
cd packages/co-managed
npx vitest run src/__tests__/sharedWorkSchedule.behaviour.test.ts -t 'provider review fixture'
```

This is a provider-level behavioral harness, not a signed-in PSA UI fixture and not a live database continuation replay. The dispatch and activity consumer tests separately supply bounded continuation and rejected action results to the real rendered consumers. They verify visible incomplete/error behavior without implying that the PSA native provider supplies `hasMore`.

The co-managed `/msp/schedule` route remains restricted. Do not change product routing or route guards to make the UI available. Use provider tests for co-managed continuation behavior.

## Signed-in replay after review app preparation

The app server remained stopped during implementation. During later review preparation, use the emitted PSA links and preserve the route guard:

1. Sign in as the **read-only viewer**. Open the ordinary link, reload, then use browser Back and Forward. Confirm the same entry opens and editing is unavailable. Repeat for the recurring occurrence link and confirm its exact occurrence time. With a saved Week or Month preference, confirm the link still opens in Day view after preferences load. A manual view change must remain selected if preferences finish loading afterward.
2. Try an invalid, off-pattern, excluded, or deleted occurrence URL as the viewer. Confirm the generic unavailable behavior exposes no entry details. A valid busy-only selection should show only the occurrence’s time; closing it must remove the selection URL.
3. Sign in as the **minimum-permission owner** for Dispatch and activity replay. The owner has the read permissions checked above, can read the assigned ticket, and may edit their own sole-assignee schedule entries by product design. Confirm the ticket-linked fixture appointment appears in dispatch and the owner’s activity feed.
4. Do not use the PSA UI fixture to claim 501-row continuation or an incomplete dispatch/activity read. Those bounded-result paths are covered offline by the co-managed provider harness and rendered consumer tests; signed-in consumer replay at the published revision remains separate review work.
5. Inspect the two out-of-window rows against the bounded schedule query, then run cleanup twice and verify that only fixture-owned rows were removed.

The app server was not started for this assignment. Fixture setup, emitted-link capture, cleanup, and signed-in replay remain subsequent review-preparation tasks.
