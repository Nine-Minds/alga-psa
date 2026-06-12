import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const migrationPath = path.resolve(
  testDir,
  '../../../../../ee/server/migrations/20260601120200_add_online_meeting_capture_settings_to_teams_integrations.cjs',
);

const migration = require(migrationPath) as {
  up: (knex: MockKnex) => Promise<void>;
  down: (knex: MockKnex) => Promise<void>;
};

type Operation =
  | { type: 'text'; column: string; nullable?: boolean }
  | { type: 'boolean'; column: string; notNullable?: boolean; defaultValue?: boolean }
  | { type: 'drop'; column: string };

type MockKnex = {
  schema: {
    hasTable: (tableName: string) => Promise<boolean>;
    hasColumn: (tableName: string, columnName: string) => Promise<boolean>;
    alterTable: (tableName: string, callback: (table: MockTableBuilder) => void) => Promise<void>;
  };
};

type MockTableBuilder = {
  text: (column: string) => { nullable: () => void };
  boolean: (column: string) => { notNullable: () => { defaultTo: (value: boolean) => void } };
  dropColumn: (column: string) => void;
};

function createMockKnex(existingColumns = new Set<string>()): { knex: MockKnex; operations: Operation[] } {
  const operations: Operation[] = [];
  const knex: MockKnex = {
    schema: {
      hasTable: vi.fn(async (tableName: string) => tableName === 'teams_integrations'),
      hasColumn: vi.fn(async (_tableName: string, columnName: string) => existingColumns.has(columnName)),
      alterTable: vi.fn(async (_tableName: string, callback: (table: MockTableBuilder) => void) => {
        const table: MockTableBuilder = {
          text: (column: string) => {
            const op: Operation = { type: 'text', column };
            operations.push(op);
            return {
              nullable: () => {
                op.nullable = true;
              },
            };
          },
          boolean: (column: string) => {
            const op: Operation = { type: 'boolean', column };
            operations.push(op);
            return {
              notNullable: () => {
                op.notNullable = true;
                return {
                  defaultTo: (value: boolean) => {
                    op.defaultValue = value;
                  },
                };
              },
            };
          },
          dropColumn: (column: string) => {
            operations.push({ type: 'drop', column });
          },
        };

        callback(table);
      }),
    },
  };

  return { knex, operations };
}

describe('Teams integration online meeting capture settings migration', () => {
  it('T071 adds organizer object id and recording visibility/download toggles with false defaults', async () => {
    const { knex, operations } = createMockKnex();

    await migration.up(knex);

    expect(operations).toEqual([
      { type: 'text', column: 'default_meeting_organizer_object_id', nullable: true },
      { type: 'boolean', column: 'download_recordings', notNullable: true, defaultValue: false },
      { type: 'boolean', column: 'expose_recordings_in_portal', notNullable: true, defaultValue: false },
    ]);

    const source = readFileSync(migrationPath, 'utf-8');
    expect(source).toContain("hasTable('teams_integrations')");
    expect(source).toContain("hasColumn('teams_integrations', column.name)");
  });

  it('T071 rolls back the added columns idempotently', async () => {
    const { knex, operations } = createMockKnex(new Set([
      'default_meeting_organizer_object_id',
      'download_recordings',
      'expose_recordings_in_portal',
    ]));

    await migration.down(knex);

    expect(operations).toEqual([
      { type: 'drop', column: 'expose_recordings_in_portal' },
      { type: 'drop', column: 'download_recordings' },
      { type: 'drop', column: 'default_meeting_organizer_object_id' },
    ]);
  });
});
