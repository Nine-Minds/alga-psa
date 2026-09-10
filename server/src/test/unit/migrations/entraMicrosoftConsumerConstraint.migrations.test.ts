import { beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');

const migration = require(
  path.resolve(repoRoot, 'server/migrations/20260825120000_add_entra_microsoft_consumer.cjs')
) as {
  up: (knex: any) => Promise<void>;
  down: (knex: any) => Promise<void>;
  config?: { transaction?: boolean };
};

type Operation =
  | { kind: 'raw'; sql: string }
  | { kind: 'delete'; table: string; where: Record<string, unknown> };

function createMigrationKnex(): { knex: any; operations: Operation[] } {
  const operations: Operation[] = [];

  const knex: any = (table: string) => ({
    where(where: Record<string, unknown>) {
      return {
        async delete() {
          operations.push({ kind: 'delete', table, where });
          return 0;
        },
      };
    },
  });
  knex.raw = async (sql: string) => {
    operations.push({ kind: 'raw', sql });
  };

  return { knex, operations };
}

function constraintValues(sql: string): string[] {
  return [...sql.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe('20260825120000_add_entra_microsoft_consumer', () => {
  let knex: any;
  let operations: Operation[];

  beforeEach(() => {
    ({ knex, operations } = createMigrationKnex());
  });

  it('runs without a wrapping transaction, matching its constraint-rewrite siblings', () => {
    expect(migration.config?.transaction).toBe(false);
  });

  it('up rewrites the consumer-type CHECK to accept entra alongside the existing consumers', async () => {
    await migration.up(knex);

    const raws = operations.filter((op): op is Extract<Operation, { kind: 'raw' }> => op.kind === 'raw');
    expect(raws).toHaveLength(2);
    expect(raws[0].sql).toContain('DROP CONSTRAINT IF EXISTS microsoft_profile_consumer_bindings_consumer_type_check');
    expect(raws[1].sql).toContain('ADD CONSTRAINT microsoft_profile_consumer_bindings_consumer_type_check');
    expect(constraintValues(raws[1].sql)).toEqual(['msp_sso', 'email', 'calendar', 'teams', 'entra']);
  });

  it('down deletes entra bindings before restoring the four-value constraint', async () => {
    await migration.down(knex);

    expect(operations[0]).toEqual({
      kind: 'delete',
      table: 'microsoft_profile_consumer_bindings',
      where: { consumer_type: 'entra' },
    });

    const raws = operations.filter((op): op is Extract<Operation, { kind: 'raw' }> => op.kind === 'raw');
    expect(raws).toHaveLength(2);
    expect(raws[0].sql).toContain('DROP CONSTRAINT IF EXISTS microsoft_profile_consumer_bindings_consumer_type_check');
    expect(constraintValues(raws[1].sql)).toEqual(['msp_sso', 'email', 'calendar', 'teams']);
    expect(raws[1].sql).not.toContain("'entra'");
  });
});
