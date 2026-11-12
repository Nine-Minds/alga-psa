import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20261028193400_create_ticket_fixed_fee_services.cjs');

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

describe('ticket fixed-fee migration foreign keys', () => {
  it('creates all foreign keys on PostgreSQL and can be retried', async () => {
    const db = migrationDatabase(false);
    await migration.up(db.knex);
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
    await migration.up(db.knex);
    expect(db.statements).toHaveLength(4);
  });

  it('distributes first and removes an incompatible Citus foreign key on retry', async () => {
    const db = migrationDatabase(true, ['ticket_fixed_fee_client_fk']);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await migration.up(db.knex);
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
