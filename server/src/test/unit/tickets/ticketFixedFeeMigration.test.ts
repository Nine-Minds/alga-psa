import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20261113000000_create_ticket_fixed_fee_services.cjs');
const originalMigration = require('../../../../migrations/20261028193400_create_ticket_fixed_fee_services.cjs');

function migrationDatabase(citus: boolean, existingConstraints: string[] = []) {
  const constraints = new Set(existingConstraints);
  const distributed = new Set(['tenants', 'tickets', 'service_catalog']);
  const statements: string[] = [];
  const events: string[] = [];
  const raw = vi.fn(async (sql: string, bindings: string[] = []) => {
    if (sql.includes('pg_proc')) return { rows: [{ exists: citus }] };
    if (sql.includes('pg_dist_partition')) return { rows: [{ is_distributed: distributed.has(bindings[0]) }] };
    if (sql.includes('create_distributed_table')) {
      events.push('distribute');
      distributed.add('ticket_fixed_fee_services');
      return { rows: [] };
    }
    if (sql.includes('pg_constraint')) {
      events.push('check-constraint');
      return { rows: [{ present: constraints.has(bindings[0]) }] };
    }
    if (sql.includes('pg_extension')) return { rows: [{ has_citus: citus }] };
    const add = /ADD CONSTRAINT (\w+)/.exec(sql);
    if (add) {
      constraints.add(add[1]);
      statements.push(sql);
      return { rows: [] };
    }
    const drop = /DROP CONSTRAINT (\w+)/.exec(sql);
    if (drop) {
      constraints.delete(drop[1]);
      statements.push(sql);
      return { rows: [] };
    }
    throw new Error(`Unexpected migration SQL: ${sql}`);
  });
  return { knex: { schema: { hasTable: vi.fn().mockResolvedValue(true) }, raw }, constraints, events, statements };
}

describe.each([
  ['original', originalMigration],
  ['renamed', migration],
])('ticket fixed-fee %s migration foreign keys', (_name, migrationUnderTest) => {
  it('creates all foreign keys on PostgreSQL and can be retried', async () => {
    const db = migrationDatabase(false);
    await migrationUnderTest.up(db.knex);
    expect(db.constraints).toEqual(new Set([
      'ticket_fixed_fee_tenant_fk',
      'ticket_fixed_fee_ticket_fk',
      'ticket_fixed_fee_client_fk',
      'ticket_fixed_fee_service_fk',
    ]));
    expect(db.statements).toEqual(expect.arrayContaining([
      expect.stringContaining('FOREIGN KEY (tenant, ticket_id) REFERENCES tickets (tenant, ticket_id) ON DELETE CASCADE'),
      expect.stringContaining('FOREIGN KEY (tenant, client_id) REFERENCES clients (tenant, client_id) ON DELETE RESTRICT'),
      expect.stringContaining('FOREIGN KEY (tenant, service_id) REFERENCES service_catalog (tenant, service_id) ON DELETE RESTRICT'),
    ]));
    await migrationUnderTest.up(db.knex);
    expect(db.statements).toHaveLength(4);
  });

  it('distributes first and removes an incompatible Citus foreign key on retry', async () => {
    const db = migrationDatabase(true, ['ticket_fixed_fee_client_fk']);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await migrationUnderTest.up(db.knex);
      expect(db.events.indexOf('distribute')).toBeLessThan(db.events.indexOf('check-constraint'));
      expect(db.constraints).toEqual(new Set([
        'ticket_fixed_fee_tenant_fk',
        'ticket_fixed_fee_ticket_fk',
        'ticket_fixed_fee_service_fk',
      ]));
      expect(db.statements).toContain(
        'ALTER TABLE ticket_fixed_fee_services DROP CONSTRAINT ticket_fixed_fee_client_fk',
      );
    } finally {
      log.mockRestore();
    }
  });
});

describe('renamed ticket fixed-fee migration rollback', () => {
  function rollbackDatabase(originalApplied: boolean) {
    const first = vi.fn().mockResolvedValue(originalApplied ? { id: 1 } : undefined);
    const where = vi.fn().mockReturnValue({ first });
    const dropTable = vi.fn().mockResolvedValue(undefined);
    const knex = Object.assign(vi.fn((table: string) => {
      if (table !== 'knex_migrations') throw new Error(`Unexpected table: ${table}`);
      return { where };
    }), { schema: { dropTable } });
    return { knex, where, dropTable };
  }

  it('preserves the table when the original migration is still applied', async () => {
    const db = rollbackDatabase(true);
    await migration.down(db.knex);
    expect(db.where).toHaveBeenCalledWith({ name: '20261028193400_create_ticket_fixed_fee_services.cjs' });
    expect(db.dropTable).not.toHaveBeenCalled();
  });

  it('drops the table when only the renamed migration was applied', async () => {
    const db = rollbackDatabase(false);
    await migration.down(db.knex);
    expect(db.dropTable).toHaveBeenCalledWith('ticket_fixed_fee_services');
  });
});
