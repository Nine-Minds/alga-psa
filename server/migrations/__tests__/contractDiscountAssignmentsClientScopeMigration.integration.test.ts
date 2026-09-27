import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20260927020000_scope_contract_discount_assignments_to_client_contracts.cjs')) as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
};

let db: Knex;

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
}, 300_000);

afterAll(async () => { await db?.destroy().catch(() => undefined); });

describe('contract discount assignment client-scope migration', () => {
  it('expands populated legacy rows to one and multiple client assignments, preserves the original settlement identity, and reruns safely', async () => {
    const rollback = new Error('rollback migration fixture');
    await expect(db.transaction(async (trx) => {
      const tenant = randomUUID();
      const tenantWithClient = await trx('tenants as t')
        .join('clients as c', 'c.tenant', 't.tenant')
        .first('t.tenant', 'c.client_id');
      // The migration fixture uses a real tenant/client pair but rolls back all
      // DDL and data after assertions so it cannot disturb the shared DB lane.
      const realTenant = String(tenantWithClient?.tenant ?? tenant);
      const clientId = String(tenantWithClient?.client_id);
      const oneContract = randomUUID();
      const multiContract = randomUUID();
      const oneAssignment = randomUUID();
      const multiAssignment = randomUUID();
      const oneDiscount = randomUUID();
      const multiDiscount = randomUUID();
      const clientContracts = [randomUUID(), randomUUID(), randomUUID()];

      // Reconstruct the old persisted table shape inside this transaction.
      const { rows: constraints } = await trx.raw(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'contract_discount_assignments'::regclass
          AND contype IN ('f', 'u')
      `);
      for (const row of constraints) {
        await trx.raw('ALTER TABLE contract_discount_assignments DROP CONSTRAINT ??', [row.conname]);
      }
      await trx.raw('DROP INDEX IF EXISTS idx_contract_discount_assignments_client_contract');
      await trx.schema.alterTable('contract_discount_assignments', (table) => {
        table.dropColumn('client_contract_id');
        table.uuid('contract_id').nullable();
        table.foreign(['tenant']).references(['tenant']).inTable('tenants').onDelete('CASCADE');
        table.foreign(['tenant', 'contract_id']).references(['tenant', 'contract_id']).inTable('contracts').onDelete('CASCADE');
        table.foreign(['tenant', 'discount_id']).references(['tenant', 'discount_id']).inTable('discounts').onDelete('CASCADE');
        table.unique(['tenant', 'contract_id', 'discount_id'], 'uq_contract_discount_assignments');
      });
      await trx('contract_discount_assignments').del();

      await trx('contracts').insert([
        { tenant: realTenant, contract_id: oneContract, contract_name: 'One client', billing_frequency: 'monthly', is_active: true },
        { tenant: realTenant, contract_id: multiContract, contract_name: 'Two clients', billing_frequency: 'monthly', is_active: true },
      ]);
      await trx('discounts').insert([
        { tenant: realTenant, discount_id: oneDiscount, discount_name: 'One', discount_type: 'fixed', value: 12.5, start_date: '2026-01-01', is_active: true },
        { tenant: realTenant, discount_id: multiDiscount, discount_name: 'Multi', discount_type: 'percentage', value: 0.1, start_date: '2026-01-01', is_active: true },
      ]);
      await trx('client_contracts').insert([
        { tenant: realTenant, client_contract_id: clientContracts[0], client_id: clientId, contract_id: oneContract, start_date: '2026-01-01', is_active: true },
        { tenant: realTenant, client_contract_id: clientContracts[1], client_id: clientId, contract_id: multiContract, start_date: '2026-01-01', is_active: true },
        { tenant: realTenant, client_contract_id: clientContracts[2], client_id: clientId, contract_id: multiContract, start_date: '2026-01-01', is_active: true },
      ]);
      await trx('contract_discount_assignments').insert([
        { tenant: realTenant, assignment_id: oneAssignment, contract_id: oneContract, discount_id: oneDiscount, created_at: '2026-02-01' },
        { tenant: realTenant, assignment_id: multiAssignment, contract_id: multiContract, discount_id: multiDiscount, created_at: '2026-02-02' },
      ]);

      await migration.up(trx);
      const firstPass = await trx('contract_discount_assignments').where({ tenant: realTenant }).orderBy('client_contract_id');
      expect(firstPass).toHaveLength(3);
      expect(firstPass.find((row) => row.client_contract_id === clientContracts[0])?.assignment_id).toBe(oneAssignment);
      expect(firstPass.find((row) => row.client_contract_id === clientContracts[1])?.assignment_id).toBe(multiAssignment);
      expect(firstPass.map((row) => row.discount_id)).toEqual(expect.arrayContaining([oneDiscount, multiDiscount, multiDiscount]));
      expect(new Set(firstPass.map((row) => row.assignment_id)).size).toBe(3);
      await migration.up(trx);
      const rerun = await trx('contract_discount_assignments').where({ tenant: realTenant }).orderBy('client_contract_id');
      expect(rerun.map((row) => [row.assignment_id, row.discount_id, row.client_contract_id]))
        .toEqual(firstPass.map((row) => [row.assignment_id, row.discount_id, row.client_contract_id]));
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
