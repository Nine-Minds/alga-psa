import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const schemaMigrationPath = path.resolve(
  testDir,
  '../../../../migrations/20260601120000_create_online_meetings.cjs',
);
const typeMigrationPath = path.resolve(
  testDir,
  '../../../../migrations/20260601120100_add_online_meeting_interaction_type.cjs',
);

const schemaMigration = require(schemaMigrationPath) as {
  up: (knex: { raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: Array<Record<string, unknown>> }> }) => Promise<void>;
  down: (knex: { raw: (sql: string) => Promise<unknown> }) => Promise<void>;
  config?: Record<string, unknown>;
};
const typeMigration = require(typeMigrationPath) as {
  up: (knex: MockSystemInteractionKnex) => Promise<void>;
};

function readSchemaMigration(): string {
  return readFileSync(schemaMigrationPath, 'utf8');
}

function createTableSql(tableName: string): string {
  const migration = readSchemaMigration();
  const match = migration.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName} \\([\\s\\S]*?\\n\\s*\\);`));
  if (!match) {
    throw new Error(`Could not find CREATE TABLE statement for ${tableName}`);
  }

  return match[0].replace(/\s+/g, ' ');
}

async function runSchemaMigrationUp(options: {
  citusAvailable: boolean;
  alreadyDistributedTables?: Set<string>;
}): Promise<Array<{ sql: string; bindings?: unknown[] }>> {
  const rawCalls: Array<{ sql: string; bindings?: unknown[] }> = [];

  const knex = {
    raw: vi.fn(async (sql: string, bindings?: unknown[]) => {
      rawCalls.push({ sql, bindings });
      if (sql.includes("proname = 'create_distributed_table'")) {
        return { rows: [{ exists: options.citusAvailable }] };
      }
      if (sql.includes('FROM pg_dist_partition')) {
        const tableName = String(bindings?.[0] ?? '');
        return { rows: [{ is_distributed: options.alreadyDistributedTables?.has(tableName) ?? false }] };
      }
      return { rows: [] };
    }),
  };

  await schemaMigration.up(knex);
  return rawCalls;
}

type MockSystemInteractionKnex = {
  schema: { hasTable: (tableName: string) => Promise<boolean> };
  (tableName: 'system_interaction_types'): {
    where: (column: string, value: string) => { first: () => Promise<Record<string, unknown> | undefined>; delete: () => Promise<number> };
    insert: (row: { type_name: string; icon: string }) => Promise<void>;
  };
};

function createSystemInteractionKnex(rows: Array<{ type_name: string; icon: string }> = []): {
  knex: MockSystemInteractionKnex;
  rows: Array<{ type_name: string; icon: string }>;
} {
  const knex = ((tableName: 'system_interaction_types') => {
    if (tableName !== 'system_interaction_types') {
      throw new Error(`Unexpected table ${tableName}`);
    }

    return {
      where: (_column: string, value: string) => ({
        first: async () => rows.find((row) => row.type_name === value),
        delete: async () => {
          const before = rows.length;
          for (let index = rows.length - 1; index >= 0; index -= 1) {
            if (rows[index].type_name === value) {
              rows.splice(index, 1);
            }
          }
          return before - rows.length;
        },
      }),
      insert: async (row: { type_name: string; icon: string }) => {
        rows.push(row);
      },
    };
  }) as MockSystemInteractionKnex;

  knex.schema = {
    hasTable: vi.fn(async () => true),
  };

  return { knex, rows };
}

describe('online meetings migrations', () => {
  it('T001 creates online_meetings with the required tenant-scoped primary key and columns', () => {
    const sql = createTableSql('online_meetings');

    expect(sql).toContain('tenant uuid NOT NULL');
    expect(sql).toContain('meeting_id uuid NOT NULL DEFAULT gen_random_uuid()');
    expect(sql).toContain('provider text NOT NULL DEFAULT');
    expect(sql).toContain('provider_meeting_id text NOT NULL');
    expect(sql).toContain('provider_event_id text');
    expect(sql).toContain('organizer_upn text');
    expect(sql).toContain('organizer_user_id text');
    expect(sql).toContain('subject text NOT NULL');
    expect(sql).toContain('join_url text NOT NULL');
    expect(sql).toContain('start_time timestamptz NOT NULL');
    expect(sql).toContain('end_time timestamptz NOT NULL');
    expect(sql).toContain('appointment_request_id uuid');
    expect(sql).toContain('interaction_id uuid');
    expect(sql).toContain('schedule_entry_id uuid');
    expect(sql).toContain('CONSTRAINT online_meetings_pk PRIMARY KEY (tenant, meeting_id)');
  });

  it('T002 distributes online_meetings on tenant when Citus is available', async () => {
    const rawCalls = await runSchemaMigrationUp({ citusAvailable: true });

    expect(rawCalls).toContainEqual({
      sql: `SELECT create_distributed_table(?, 'tenant', colocate_with => ?)`,
      bindings: ['online_meetings', 'tenants'],
    });
    expect(readSchemaMigration()).toContain('exports.config = { transaction: false }');
  });

  it('T003 drops online_meeting_artifacts before online_meetings on rollback', async () => {
    const rawCalls: string[] = [];

    await schemaMigration.down({
      raw: vi.fn(async (sql: string) => {
        rawCalls.push(sql);
        return {};
      }),
    });

    expect(rawCalls).toEqual([
      'DROP TABLE IF EXISTS online_meeting_artifacts CASCADE;',
      'DROP TABLE IF EXISTS online_meetings CASCADE;',
    ]);
  });

  it('T004/T005 constrains online_meetings status to the PRD enum values', async () => {
    const rawCalls = await runSchemaMigrationUp({ citusAvailable: false });
    const sql = rawCalls.find((call) => call.sql.includes('CREATE TABLE IF NOT EXISTS online_meetings'))?.sql ?? '';

    expect(sql).toContain('CONSTRAINT online_meetings_status_check');
    for (const status of [
      'scheduled',
      'ended',
      'recording_pending',
      'recording_ready',
      'no_recording',
      'cancelled',
      'failed',
    ]) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).not.toContain("'unknown'");
  });

  it('T006 adds the tenant/provider/provider_meeting_id uniqueness constraint and lookup indexes', () => {
    const migration = readSchemaMigration();

    expect(createTableSql('online_meetings')).toContain(
      'CONSTRAINT online_meetings_provider_meeting_uk UNIQUE (tenant, provider, provider_meeting_id)',
    );
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS online_meetings_interaction_idx');
    expect(migration).toContain('ON online_meetings (tenant, interaction_id)');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS online_meetings_appointment_request_idx');
    expect(migration).toContain('ON online_meetings (tenant, appointment_request_id)');
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS online_meetings_status_end_time_idx');
    expect(migration).toContain('ON online_meetings (tenant, status, end_time)');
  });

  it('T007 creates online_meeting_artifacts with idempotency constraints and Citus colocation', async () => {
    const rawCalls = await runSchemaMigrationUp({ citusAvailable: true });
    const sql = rawCalls.find((call) => call.sql.includes('CREATE TABLE IF NOT EXISTS online_meeting_artifacts'))?.sql.replace(/\s+/g, ' ') ?? '';

    expect(sql).toContain('CONSTRAINT online_meeting_artifacts_pk PRIMARY KEY (tenant, artifact_id)');
    expect(sql).toContain('meeting_id uuid NOT NULL');
    expect(sql).toContain('artifact_type text NOT NULL');
    expect(sql).toContain('provider_artifact_id text NOT NULL');
    expect(sql).toContain('content_url text');
    expect(sql).toContain('document_id uuid');
    expect(sql).toContain('file_id uuid');
    expect(sql).toContain('created_date_time timestamptz');
    expect(sql).toContain(
      'CONSTRAINT online_meeting_artifacts_meeting_type_provider_uk UNIQUE (tenant, meeting_id, artifact_type, provider_artifact_id)',
    );
    expect(sql).toContain("CHECK (artifact_type IN ('recording', 'transcript'))");
    expect(readSchemaMigration()).toContain('ON online_meeting_artifacts (tenant, meeting_id)');
    expect(rawCalls).toContainEqual({
      sql: `SELECT create_distributed_table(?, 'tenant', colocate_with => ?)`,
      bindings: ['online_meeting_artifacts', 'online_meetings'],
    });
  });

  it('skips Citus distribution cleanly when create_distributed_table is unavailable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const rawCalls = await runSchemaMigrationUp({ citusAvailable: false });

      expect(rawCalls.some((call) => call.sql.includes('FROM pg_dist_partition'))).toBe(false);
      expect(rawCalls.some((call) => call.sql.includes('create_distributed_table(?)'))).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        '[create_online_meetings] Skipping create_distributed_table for online_meetings (function unavailable)',
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[create_online_meetings] Skipping create_distributed_table for online_meeting_artifacts (function unavailable)',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('T009/T010 inserts Online Meeting with the video icon idempotently', async () => {
    const { knex, rows } = createSystemInteractionKnex();

    await typeMigration.up(knex);
    await typeMigration.up(knex);

    expect(rows).toEqual([{ type_name: 'Online Meeting', icon: 'video' }]);
  });
});
