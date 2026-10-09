# Shared calendar provider delivery acceptance

## Status and review order

Review the routing boundary first: `packages/event-bus/src/config/redisConfig.ts`
names streams and `processed_events` / `processed_event_handlers` from the
same `REDIS_PREFIX`; `server/src/lib/eventBus/index.ts` re-exports that package
implementation. Publishers and intended consumers in one worktree must use
the same prefix, stream prefix, and consumer group. Replicas share that route
and group. A unique consumer name alone does not isolate worktrees.

The shared-calendar PRD at
`ee/docs/plans/2026-09-22-shared-calendars/PRD.md` is marked **Draft** and
retains open questions. No approved task-specific design plan was found in
the branch's committed `docs/plans/` history; the accepted labeling behavior
for this delivery handoff is recorded below.

## Exact five-flow acceptance definitions

1. **Group delivery.** In `/msp/schedule`, create or edit an entry assigned to
   a user with connected Google and Outlook providers and select a named group
   calendar. Save once. Both external events must be created automatically;
   their titles stay equal to the Alga title, both descriptions contain
   `[Alga calendar: <name>]` while retaining the entry notes, Outlook has the
   matching group category, and one mapping per provider is persisted.
2. **Inbound notes and no rejection loop.** Edit an external copy's user-authored
   note while retaining Alga's injected marker, then allow inbound sync. The
   schedule note must retain the user-authored text and remove only metadata
   identified as Alga-injected. A marker-only provider echo on a read-only group
   entry must not be treated as a content edit that triggers an access-rejection
   re-push; title, mapping, and unrelated note text remain stable.
3. **Rename on next update.** Rename the group calendar in Alga, then make a
   normal edit to its schedule entry and save. Existing provider events are
   updated in place: title remains unchanged, the old injected marker/category
   is replaced by `[Alga calendar: <new name>]`, user notes remain, and mapping
   IDs are unchanged.
4. **Archive and restore.** Archive a group calendar with mapped entries.
   Existing external copies are removed and their mappings are removed by the
   normal sync path. Restore the calendar and perform the supported next sync;
   provider copies are recreated with the current marker/category and new
   mappings. The schedule entry itself is preserved.
5. **Personal and calendar-less control.** Edit one personal-calendar entry
   and one entry without a calendar, each assigned to a connected provider
   user. Their external titles and notes remain as authored; neither gets a
   group marker or Outlook group category. These controls must continue to use
   the existing personal-entry behavior.

## Evidence and remaining UI acceptance

The executable automatic-delivery harness is
`server/src/test/integration/calendar/automaticCalendarDelivery.integration.test.ts`.
It runs EventBus publication, the actual calendar subscriber, the real
`CalendarSyncService`, actual Google and Outlook adapters, both stateful
provider emulators, and a newly created disposable PostgreSQL database. It
asserts persisted provider mappings, unchanged titles, both body markers, and
the Outlook category. This is **Flow 1 service/emulator evidence**, not a
Schedule UI pass.

The other four flows have existing focused mapping, note-preservation,
category-consent, and access-rejection regression coverage, but none has been
accepted through `/msp/schedule` in this step. UI acceptance for all five flows
remains **blocked** while the app server is required to stay stopped.

After the authorized board startup, open `/msp/schedule`, authenticate as the
fixture provider user, perform each numbered stimulus exactly as written, and
capture the schedule save, both provider event records, and tenant-scoped
`calendar_event_mappings` rows. Keep service/emulator results separate from
screenshots or other UI evidence. For provider inspection use the fixture
runner's authenticated Google API and Graph control endpoint documented in
`shared-calendar-provider-emulator-fixtures.md`. Stop the fixture runner
cleanly afterward; do not clear its state while accepted copies exist.

## Redis ledger namespace migration

This change does not delete or rename stream data, groups, or existing ledger
sets. Old unprefixed `processed_events:*` and
`processed_event_handlers:*` sets are left in place and expire under their
existing TTL; the prefixed implementation no longer reads them. A deployment
that changes `REDIS_PREFIX` therefore starts a fresh delivery/idempotency
route. Do not replay old stream history wholesale. For a known missing entry,
save that entry once after coordinated activation to publish a fresh update.
All publishers and intended subscribers in the activated environment must
receive the same prefix together; other worktrees must keep their own prefix.

## Reproducible automatic delivery command

Run from `server/` with the local wired Redis secret available at
`../secrets/redis_password`:

```bash
REDIS_HOST=127.0.0.1 REDIS_PORT=6380 \
REDIS_PASSWORD="$(<../secrets/redis_password)" \
npm run test:calendar-routing
```

The committed `vitest.redis.config.ts` sets `REAL_REDIS=1` before loading the
standard config, bypassing its default no-op Redis alias. The integration test
creates and drops only a random database matching
`calendar_delivery_test_<12 lowercase hex digits>`; it does not recreate the
shared `test_database` or the wired app database.
