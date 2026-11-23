import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import knexFactory from 'knex';
import { buildScheduleEntryLink } from '@alga-psa/core/scheduleEntryLinks';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261123120000_repair_schedule_entry_search_docs.cjs'));

/** Records the SQL the migration would run, rendered by the real pg dialect (no connection). */
const recordingKnex = () => {
  const pg = knexFactory({ client: 'pg' });
  const statements: string[] = [];
  const native: Array<{ sql: string; bindings: readonly unknown[] }> = [];
  const knex: any = {
    schema: { hasTable: vi.fn().mockResolvedValue(true) },
    raw: (sql: string, bindings?: readonly unknown[]) => {
      const raw = pg.raw(sql, bindings as any);
      statements.push(raw.toQuery());
      native.push(raw.toSQL().toNative() as any);
      return Promise.resolve();
    },
  };
  return { knex, statements, native };
};

describe('repair schedule entry search docs migration', () => {
  it('rewrites the dead /msp/schedule/{id} URL to the same deep link the indexer builds', async () => {
    const { knex, statements, native } = recordingKnex();
    await migration.up(knex);

    expect(statements).toHaveLength(2);
    // What the pg driver receives: no `?` inside SQL text, where pg would rewrite it to `$n`.
    expect(native[0].sql).not.toMatch(/'[^']*\$\d[^']*'/);
    expect(native[0].bindings).toEqual(['/msp/schedule?entryId=', '/msp/schedule/']);
    const sql = statements[0];
    // The literal must survive knex's `?` placeholder handling intact.
    expect(sql).toContain(`'/msp/schedule?entryId='::text || object_id`);
    expect(sql).toContain(`url = '/msp/schedule/'::text || object_id`);
    expect(sql).toContain(`object_type = 'schedule_entry'`);

    const entryId = '8cbc41b4-0274-4b5e-9c9c-fcfe5f07dfbb';
    expect(`/msp/schedule?entryId=${entryId}`).toBe(buildScheduleEntryLink(entryId));
  });

  it('replaces the schedule:read permission no role grants with user_schedule:read', async () => {
    const { knex, statements, native } = recordingKnex();
    await migration.up(knex);

    expect(native[1].bindings).toEqual(['user_schedule:read', 'schedule:read']);
    expect(statements[1]).toContain(`SET required_permission = 'user_schedule:read'::text`);
    expect(statements[1]).toContain(`object_type = 'schedule_entry'`);
    expect(statements[1]).toContain(`required_permission = 'schedule:read'::text`);
  });

  it('does nothing when the search index table does not exist', async () => {
    const { knex, statements } = recordingKnex();
    knex.schema.hasTable.mockResolvedValue(false);
    await migration.up(knex);
    expect(statements).toHaveLength(0);
  });
});
