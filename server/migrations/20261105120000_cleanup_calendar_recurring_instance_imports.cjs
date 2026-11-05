'use strict';

/**
 * Remove the per-occurrence schedule entries created by the pre-fix calendar
 * sync.
 *
 * Google is asked for expanded instances (`singleEvents: true`), so an
 * @alga-marked recurring series arrived as one event per occurrence, each keyed
 * by an instance id (`<masterId>_20261105T151500Z`, or `<masterId>_20261105` for
 * an all-day series). Every one of those became its own non-recurring
 * `schedule_entries` row: production held 730 rows for a single monthly series
 * running to 2087. The fixed code imports the series master once instead, so
 * these rows must go before the master can be re-imported.
 *
 * What this does, per tenant:
 *   1. selects `from_external` mappings on google providers whose
 *      `external_event_id` has the provider's instance-id shape and whose
 *      schedule entry is a plain non-recurring row (`is_recurring = false`,
 *      `original_entry_id IS NULL`) — a master mapping is keyed by the bare
 *      master id and never matches, and a single-occurrence override is reached
 *      only through its own master,
 *   2. skips (and logs) any entry a time entry was logged against, so no
 *      billable work loses its work item,
 *   3. deletes the mapping, `schedule_entry_assignees` and `schedule_entries`
 *      rows by id + tenant in plain SQL,
 *   4. nulls `sync_token` on the affected google providers so the next
 *      webhook/maintenance run performs a full list and re-imports each series
 *      as one recurring entry under the fixed code.
 *
 * Deliberately NOT done through CalendarSyncService.deleteScheduleEntry: that
 * path calls adapter.deleteEvent and would cancel the user's real Google
 * occurrences. Nothing here touches any provider.
 *
 * Citus notes: every statement carries the tenant predicate and deletes by
 * primary key, so each is router-executable. No DDL, so the default
 * transaction-per-migration is fine. down() is a no-op — the deleted rows were
 * duplicates of provider state, and re-importing them is what the bug did.
 */

const { tenantDb } = require('./utils/tenantDb.cjs');

// `<masterId>_<YYYYMMDDTHHMMSSZ>` (timed) or `<masterId>_<YYYYMMDD>` (all-day).
// A split-series master (`<base>_R<timestamp>`) deliberately does not match.
const INSTANCE_ID_REGEX = '^(.+)_([0-9]{8}T[0-9]{6}Z|[0-9]{8})$';
const BATCH_SIZE = 500;

async function tenantsWithGoogleCalendarMappings(knex) {
  const rows = await knex('calendar_event_mappings').distinct('tenant');
  return rows.map((row) => row.tenant).filter(Boolean).sort();
}

exports.up = async function up(knex) {
  const hasMappings = await knex.schema.hasTable('calendar_event_mappings');
  const hasProviders = await knex.schema.hasTable('calendar_providers');
  if (!hasMappings || !hasProviders) return;

  const hasGoogleSyncToken = await knex.schema.hasColumn('google_calendar_provider_config', 'sync_token');
  let deleted = 0;
  let skipped = 0;
  const providersToReset = new Set();

  for (const tenant of await tenantsWithGoogleCalendarMappings(knex)) {
    const db = tenantDb(knex, tenant);
    // Entries kept for a time entry stay selectable, so they are excluded
    // explicitly to keep the batch loop making progress.
    const keptEntryIds = [];

    for (;;) {
      const query = db.table('calendar_event_mappings as cem');
      db.tenantJoin(query, 'schedule_entries as se', 'se.entry_id', 'cem.schedule_entry_id');
      db.tenantJoin(query, 'calendar_providers as cp', 'cp.id', 'cem.calendar_provider_id');

      query
        .where('cem.sync_direction', 'from_external')
        .andWhere('cp.provider_type', 'google')
        .andWhere('se.is_recurring', false)
        .whereNull('se.original_entry_id')
        .whereRaw('cem.external_event_id ~ ?', [INSTANCE_ID_REGEX]);
      if (keptEntryIds.length > 0) {
        query.whereNotIn('se.entry_id', keptEntryIds);
      }

      const candidates = await query
        .orderBy('cem.id')
        .limit(BATCH_SIZE)
        .select(
          'cem.id as mapping_id',
          'cem.external_event_id',
          'cem.calendar_provider_id',
          'se.entry_id',
          'se.title'
        );

      if (candidates.length === 0) break;

      const referencedRows = await db.table('time_entries')
        .where('work_item_type', 'ad_hoc')
        .whereIn('work_item_id', candidates.map((row) => row.entry_id))
        .distinct('work_item_id');
      const referenced = new Set(referencedRows.map((row) => row.work_item_id));

      for (const candidate of candidates) {
        if (referenced.has(candidate.entry_id)) {
          keptEntryIds.push(candidate.entry_id);
          skipped += 1;
          console.log(
            '[cleanup_calendar_recurring_instance_imports] keeping entry referenced by a time entry',
            {
              tenant,
              entryId: candidate.entry_id,
              externalEventId: candidate.external_event_id,
              title: candidate.title,
            }
          );
          continue;
        }

        await db.table('calendar_event_mappings').where('id', candidate.mapping_id).del();
        await db.table('schedule_entry_assignees').where('entry_id', candidate.entry_id).del();
        await db.table('schedule_entries').where('entry_id', candidate.entry_id).del();
        providersToReset.add(`${tenant}:${candidate.calendar_provider_id}`);
        deleted += 1;
      }
    }
  }

  if (hasGoogleSyncToken) {
    for (const key of providersToReset) {
      const separator = key.indexOf(':');
      const tenant = key.slice(0, separator);
      const providerId = key.slice(separator + 1);
      await tenantDb(knex, tenant)
        .table('google_calendar_provider_config')
        .where('calendar_provider_id', providerId)
        .update({ sync_token: null });
    }
  }

  console.log('[cleanup_calendar_recurring_instance_imports] done', {
    deletedEntries: deleted,
    skippedEntries: skipped,
    providersReset: providersToReset.size,
  });
};

exports.down = async function down() {
  // Irreversible by design: the removed rows were duplicate materializations of
  // provider occurrences. Rolling the code back re-creates them on the next sync.
};
