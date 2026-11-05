import { describe, expect, it } from 'vitest';
import path from 'node:path';

/**
 * Logic test for 20261105120000_cleanup_calendar_recurring_instance_imports.
 *
 * The migration runs against an in-memory knex stand-in that applies the same
 * predicates Postgres would (including the `~` instance-id regex), so the three
 * contracts are checked without a database: instance-style rows and their
 * mappings/assignees go, an entry a time entry was logged against stays, and
 * the affected google provider's sync token is cleared. A provider delete is
 * never attempted — the migration never loads the sync service at all.
 */

const MIGRATION = path.resolve(
  __dirname,
  '../../../../migrations/20261105120000_cleanup_calendar_recurring_instance_imports.cjs'
);

const MASTER_ID = '2ppb6f3ftc40nggeoqtsoh743g';

type Row = Record<string, any>;

interface Fixture {
  calendar_event_mappings: Row[];
  schedule_entries: Row[];
  schedule_entry_assignees: Row[];
  calendar_providers: Row[];
  google_calendar_provider_config: Row[];
  time_entries: Row[];
}

/**
 * Knex-shaped builder over arrays. Join conditions are supplied by the
 * migration through tenantDb.tenantJoin; the only join shape this needs to
 * honour is mapping → schedule entry → provider within one tenant.
 */
function makeKnex(data: Fixture) {
  const predicates: Array<{ builder: any; checks: Array<(row: Row) => boolean> }> = [];

  /** Read a column the way Postgres would resolve it against the row/join. */
  const read = (row: Row, column: string): any => {
    if (column in row) return row[column];
    const short = column.split('.').pop()!;
    if (short in row) return row[short];
    for (const key of Object.keys(row)) {
      if (key.endsWith(`.${short}`)) return row[key];
    }
    return undefined;
  };

  const resolveRow = (base: Row, table: string): Row => {
    if (table === 'calendar_event_mappings as cem') {
      const entry = data.schedule_entries.find(
        (candidate) => candidate.entry_id === base.schedule_entry_id && candidate.tenant === base.tenant
      );
      const provider = data.calendar_providers.find(
        (candidate) => candidate.id === base.calendar_provider_id && candidate.tenant === base.tenant
      );
      if (!entry || !provider) return null as any;
      const joined: Row = { __base: base };
      for (const [key, value] of Object.entries(base)) joined[`cem.${key}`] = value;
      for (const [key, value] of Object.entries(entry)) joined[`se.${key}`] = value;
      for (const [key, value] of Object.entries(provider)) joined[`cp.${key}`] = value;
      joined['cem.id as mapping_id'] = base.id;
      joined['se.entry_id'] = entry.entry_id;
      return joined;
    }
    return base;
  };

  const builderFor = (table: string) => {
    const bare = table.split(' as ')[0] as keyof Fixture;
    const checks: Array<(row: Row) => boolean> = [];
    let limit: number | null = null;

    const rows = () =>
      (data[bare] as Row[])
        .map((row) => resolveRow(row, table))
        .filter((row) => row && checks.every((check) => check(row)));

    const builder: any = {
      where: (column: any, operatorOrValue?: any, maybeValue?: any) => {
        if (typeof column === 'object') {
          checks.push((row) => Object.entries(column).every(([key, value]) => read(row, key) === value));
        } else {
          const value = maybeValue !== undefined ? maybeValue : operatorOrValue;
          checks.push((row) => read(row, column) === value);
        }
        return builder;
      },
      andWhere: (...args: any[]) => builder.where(...args),
      whereNull: (column: string) => {
        checks.push((row) => read(row, column) === null || read(row, column) === undefined);
        return builder;
      },
      whereNotNull: (column: string) => {
        checks.push((row) => read(row, column) !== null && read(row, column) !== undefined);
        return builder;
      },
      whereIn: (column: string, values: any[]) => {
        checks.push((row) => values.includes(read(row, column)));
        return builder;
      },
      whereNotIn: (column: string, values: any[]) => {
        checks.push((row) => !values.includes(read(row, column)));
        return builder;
      },
      whereRaw: (sql: string, bindings: any[]) => {
        const column = sql.trim().split(/\s+/)[0];
        const matcher = new RegExp(bindings[0]);
        checks.push((row) => matcher.test(String(read(row, column))));
        return builder;
      },
      orderBy: () => builder,
      limit: (value: number) => { limit = value; return builder; },
      distinct: async (column: string) => {
        const seen = new Set();
        const out: Row[] = [];
        for (const row of rows()) {
          if (seen.has(row[column])) continue;
          seen.add(row[column]);
          out.push({ [column]: row[column] });
        }
        return out;
      },
      select: async (...columns: string[]) => {
        const selected = rows().map((row) => {
          const out: Row = {};
          for (const column of columns) {
            const [source, alias] = column.split(' as ');
            out[alias ?? source.split('.').pop()!] = read(row, source);
          }
          return out;
        });
        return limit === null ? selected : selected.slice(0, limit);
      },
      update: async (changes: Row) => {
        const targets = rows();
        for (const target of targets) Object.assign(target.__base ?? target, changes);
        return targets.length;
      },
      del: async () => {
        const doomed = new Set(rows().map((row) => row.__base ?? row));
        const before = (data[bare] as Row[]).length;
        data[bare] = (data[bare] as Row[]).filter((row) => !doomed.has(row)) as any;
        return before - (data[bare] as Row[]).length;
      },
      join: () => builder,
      leftJoin: () => builder,
    };

    predicates.push({ builder, checks });
    return builder;
  };

  const knex: any = (table: string) => builderFor(table);
  knex.schema = {
    hasTable: async () => true,
    hasColumn: async () => true,
  };
  knex.raw = (sql: string, bindings: any[]) => ({ sql, bindings });
  return knex;
}

function fixture(): Fixture {
  const instanceEntries = [
    { entry_id: 'entry-oct', external: `${MASTER_ID}_20261001T141500Z`, hasTime: false },
    { entry_id: 'entry-nov', external: `${MASTER_ID}_20261105T151500Z`, hasTime: false },
    { entry_id: 'entry-dec', external: `${MASTER_ID}_20261203T151500Z`, hasTime: true },
    { entry_id: 'entry-allday', external: `${MASTER_ID}_20270107`, hasTime: false },
  ];

  return {
    calendar_providers: [
      { id: 'provider-google', tenant: 'tenant-1', provider_type: 'google' },
      { id: 'provider-ms', tenant: 'tenant-1', provider_type: 'microsoft' },
    ],
    google_calendar_provider_config: [
      { tenant: 'tenant-1', calendar_provider_id: 'provider-google', sync_token: 'stale-token' },
    ],
    schedule_entries: [
      ...instanceEntries.map((instance) => ({
        tenant: 'tenant-1',
        entry_id: instance.entry_id,
        title: 'Go over advisories in Git @alga',
        is_recurring: false,
        original_entry_id: null,
        work_item_type: 'ad_hoc',
      })),
      // A properly imported master: mapped by the bare master id, so it must survive.
      {
        tenant: 'tenant-1',
        entry_id: 'entry-master',
        title: 'Go over advisories in Git @alga',
        is_recurring: true,
        original_entry_id: null,
        work_item_type: 'ad_hoc',
      },
      // A single-occurrence override of that master: not instance-shaped on its
      // own mapping key, and reached only through the master.
      {
        tenant: 'tenant-1',
        entry_id: 'entry-outlook',
        title: 'Outlook meeting @alga',
        is_recurring: false,
        original_entry_id: null,
        work_item_type: 'ad_hoc',
      },
    ],
    schedule_entry_assignees: [
      ...instanceEntries.map((instance) => ({ tenant: 'tenant-1', entry_id: instance.entry_id, user_id: 'user-1' })),
      { tenant: 'tenant-1', entry_id: 'entry-master', user_id: 'user-1' },
      { tenant: 'tenant-1', entry_id: 'entry-outlook', user_id: 'user-1' },
    ],
    calendar_event_mappings: [
      ...instanceEntries.map((instance, index) => ({
        id: `mapping-${index}`,
        tenant: 'tenant-1',
        calendar_provider_id: 'provider-google',
        schedule_entry_id: instance.entry_id,
        external_event_id: instance.external,
        sync_direction: 'from_external',
      })),
      {
        id: 'mapping-master',
        tenant: 'tenant-1',
        calendar_provider_id: 'provider-google',
        schedule_entry_id: 'entry-master',
        external_event_id: MASTER_ID,
        sync_direction: 'from_external',
      },
      {
        id: 'mapping-outlook',
        tenant: 'tenant-1',
        calendar_provider_id: 'provider-ms',
        schedule_entry_id: 'entry-outlook',
        external_event_id: 'AAMkAD_outlook_id',
        sync_direction: 'from_external',
      },
    ],
    time_entries: [
      { tenant: 'tenant-1', entry_id: 'time-1', work_item_type: 'ad_hoc', work_item_id: 'entry-dec' },
    ],
  };
}

describe('cleanup_calendar_recurring_instance_imports migration', () => {
  it('deletes instance-style imports, keeps billed and non-instance rows, and clears the sync token', async () => {
    const data = fixture();
    const knex = makeKnex(data);
    const migration = require(MIGRATION);

    await migration.up(knex);

    expect(data.schedule_entries.map((row) => row.entry_id).sort()).toEqual([
      // kept: referenced by a time entry
      'entry-dec',
      // kept: the recurring master
      'entry-master',
      // kept: a Microsoft mapping that is not instance-shaped
      'entry-outlook',
    ]);
    expect(data.calendar_event_mappings.map((row) => row.id).sort()).toEqual([
      'mapping-2',
      'mapping-master',
      'mapping-outlook',
    ]);
    expect(data.schedule_entry_assignees.map((row) => row.entry_id).sort()).toEqual([
      'entry-dec',
      'entry-master',
      'entry-outlook',
    ]);
    expect(data.google_calendar_provider_config[0].sync_token).toBeNull();
  });

  it('keeps a single-occurrence override its master claims in occurrence_index', async () => {
    // ScheduleEntry.update(…, SINGLE) writes an override standalone — non-recurring,
    // original_entry_id null — so it is instance-shaped like a pre-fix import and
    // only the master's occurrence_index tells them apart.
    const data = fixture();
    const master = data.calendar_event_mappings.find((row) => row.id === 'mapping-master')!;
    master.occurrence_index = { [`${MASTER_ID}_20261105T151500Z`]: '2026-11-05T15:15:00.000Z' };
    const knex = makeKnex(data);
    const migration = require(MIGRATION);

    await migration.up(knex);

    expect(data.schedule_entries.map((row) => row.entry_id).sort()).toEqual([
      'entry-dec',
      'entry-master',
      // kept: claimed by the master as its override for that slot
      'entry-nov',
      'entry-outlook',
    ]);
    expect(data.calendar_event_mappings.map((row) => row.id).sort()).toEqual([
      'mapping-1',
      'mapping-2',
      'mapping-master',
      'mapping-outlook',
    ]);
  });

  it('is a no-op when nothing matches the instance-id shape', async () => {
    const data = fixture();
    data.calendar_event_mappings = data.calendar_event_mappings.filter(
      (row) => row.id === 'mapping-master' || row.id === 'mapping-outlook'
    );
    const knex = makeKnex(data);
    const migration = require(MIGRATION);

    await migration.up(knex);

    expect(data.schedule_entries).toHaveLength(6);
    expect(data.google_calendar_provider_config[0].sync_token).toBe('stale-token');
  });

  it('exposes an explicitly irreversible down()', async () => {
    const migration = require(MIGRATION);
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
