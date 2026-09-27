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
const isolateDefinitionsMigration = require(path.resolve(__dirname, '../20260927030000_isolate_contract_discount_definitions.cjs')) as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
};
const lineOwnershipMigration = require(path.resolve(__dirname, '../20260927060000_scope_line_discounts_to_client_contracts.cjs')) as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
};

const createAssignmentsMigration = require(path.resolve(__dirname, '../20260927010000_add_contract_discount_assignments.cjs')) as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
};

const copyLedgerMigration = require(path.resolve(__dirname, '../20260927050000_track_contract_template_discount_copies.cjs')) as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
};
const copyLedgerRepair = require(path.resolve(__dirname, '../20260927070000_distribute_contract_template_discount_copies.cjs')) as {
  up: (knex: Knex | Knex.Transaction) => Promise<void>;
};

let db: Knex;

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
}, 300_000);

afterAll(async () => { await db?.destroy().catch(() => undefined); });

describe('contract discount assignment client-scope migration', () => {
  it('creates attachment foreign keys after table creation and safely reruns after client scoping', async () => {
    const rollback = new Error('rollback assignment creation fixture');
    await expect(db.transaction(async (trx) => {
      await trx.schema.dropTable('contract_discount_assignments');
      await createAssignmentsMigration.up(trx);
      await createAssignmentsMigration.up(trx);
      const foreignKeys = await trx.raw("SELECT conname FROM pg_constraint WHERE conrelid = 'contract_discount_assignments'::regclass AND contype = 'f'");
      expect(foreignKeys.rows).toHaveLength(3);
      await migration.up(trx);
      await createAssignmentsMigration.up(trx);
      expect(await trx.schema.hasColumn('contract_discount_assignments', 'client_contract_id')).toBe(true);
      expect(await trx.schema.hasColumn('contract_discount_assignments', 'contract_id')).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it('creates and repairs the copy ledger without losing identities and cascades parent deletion', async () => {
    const rollback = new Error('rollback copy ledger fixture');
    await expect(db.transaction(async (trx) => {
      await trx.schema.dropTableIfExists('contract_template_discount_copies');
      await copyLedgerMigration.up(trx);
      const client = await trx('clients').first('tenant', 'client_id');
      const tenant = client.tenant;
      const contractId = randomUUID();
      const ownerId = randomUUID();
      const discountId = randomUUID();
      const key = randomUUID();
      await trx('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Copy ledger', billing_frequency: 'monthly', is_active: true });
      await trx('client_contracts').insert({ tenant, client_contract_id: ownerId, client_id: client.client_id, contract_id: contractId, start_date: '2026-01-01', is_active: true });
      await trx('discounts').insert({ tenant, discount_id: discountId, discount_name: 'Copied', discount_type: 'fixed', value: 10, start_date: '2026-01-01', is_active: true });
      const row = { tenant, client_contract_id: ownerId, discount_id: discountId, template_discount_key: key };
      await trx('contract_template_discount_copies').insert(row);
      await copyLedgerMigration.up(trx);
      await copyLedgerRepair.up(trx);
      expect(await trx('contract_template_discount_copies').where({ tenant, client_contract_id: ownerId })).toEqual([row]);
      const foreignKeys = await trx.raw("SELECT conname FROM pg_constraint WHERE conrelid = 'contract_template_discount_copies'::regclass AND contype = 'f'");
      expect(foreignKeys.rows).toHaveLength(2);
      await trx('client_contracts').where({ tenant, client_contract_id: ownerId }).delete();
      expect(await trx('contract_template_discount_copies').where({ tenant, discount_id: discountId })).toEqual([]);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it('splits legacy line definitions per client-contract and safely reruns', async () => {
    const rollback = new Error('rollback line ownership fixture');
    await expect(db.transaction(async (trx) => {
      const tenantWithClient = await trx('tenants as t').join('clients as c', 'c.tenant', 't.tenant').first('t.tenant', 'c.client_id');
      const tenant = String(tenantWithClient.tenant);
      const clientId = String(tenantWithClient.client_id);
      const contractId = randomUUID();
      const lineId = randomUUID();
      const owners = [randomUUID(), randomUUID()];
      const discountId = randomUUID();
      await trx('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Legacy line terms', billing_frequency: 'monthly', is_active: true });
      await trx('contract_lines').insert({ tenant, contract_line_id: lineId, contract_id: contractId, contract_line_name: 'Line', billing_frequency: 'monthly', contract_line_type: 'fixed', is_active: true });
      await trx('client_contracts').insert(owners.map((clientContractId) => ({ tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId, start_date: '2026-01-01', is_active: true })));
      await trx('discounts').insert({ tenant, discount_id: discountId, discount_name: 'Legacy 10%', discount_type: 'percentage', value: 0.1, start_date: '2026-01-01', is_active: true, scope: 'line' });
      await trx('contract_line_discounts').insert({ tenant, discount_id: discountId, contract_line_id: lineId, client_id: clientId, client_contract_id: null });
      await lineOwnershipMigration.up(trx);
      const first = await trx('contract_line_discounts').where({ tenant, contract_line_id: lineId }).orderBy('client_contract_id');
      expect(first).toHaveLength(2);
      expect(new Set(first.map((row) => row.discount_id)).size).toBe(2);
      expect(first.map((row) => row.client_contract_id).sort()).toEqual([...owners].sort());
      await lineOwnershipMigration.up(trx);
      const rerun = await trx('contract_line_discounts').where({ tenant, contract_line_id: lineId }).orderBy('client_contract_id');
      expect(rerun.map((row) => [row.discount_id, row.client_contract_id])).toEqual(first.map((row) => [row.discount_id, row.client_contract_id]));
      throw rollback;
    })).rejects.toBe(rollback);
  });

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
      expect(firstPass.find((row) => row.client_contract_id === clientContracts.slice(1).sort()[0])?.assignment_id).toBe(multiAssignment);
      expect(firstPass.map((row) => row.discount_id)).toEqual(expect.arrayContaining([oneDiscount, multiDiscount, multiDiscount]));
      expect(new Set(firstPass.map((row) => row.assignment_id)).size).toBe(3);
      await migration.up(trx);
      const rerun = await trx('contract_discount_assignments').where({ tenant: realTenant }).orderBy('client_contract_id');
      expect(rerun.map((row) => [row.assignment_id, row.discount_id, row.client_contract_id]))
        .toEqual(firstPass.map((row) => [row.assignment_id, row.discount_id, row.client_contract_id]));
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it('splits already-shared discount definitions and keeps assignment settlement UUIDs', async () => {
    const rollback = new Error('rollback shared-definition fixture');
    await expect(db.transaction(async (trx) => {
      const tenantWithClient = await trx('tenants as t').join('clients as c', 'c.tenant', 't.tenant').first('t.tenant', 'c.client_id');
      const tenant = String(tenantWithClient.tenant);
      const clientId = String(tenantWithClient.client_id);
      const contractId = randomUUID();
      const clientContractIds = [randomUUID(), randomUUID()];
      const discountId = randomUUID();
      const assignmentIds = [randomUUID(), randomUUID()];
      await trx('contracts').insert({ tenant, contract_id: contractId, contract_name: 'Shared definition fixture', billing_frequency: 'monthly', is_active: true });
      await trx('client_contracts').insert(clientContractIds.map((clientContractId) => ({ tenant, client_contract_id: clientContractId, client_id: clientId, contract_id: contractId, start_date: '2026-01-01', is_active: true })));
      await trx('discounts').insert({ tenant, discount_id: discountId, discount_name: 'Shared old definition', discount_type: 'percentage', value: 0.125, start_date: '2026-01-01', is_active: true, scope: 'contract' });
      await trx('contract_discount_assignments').insert(clientContractIds.map((clientContractId, index) => ({ tenant, client_contract_id: clientContractId, assignment_id: assignmentIds[index], discount_id: discountId, created_at: '2026-02-01' })));
      await isolateDefinitionsMigration.up(trx);
      const assignments = await trx('contract_discount_assignments').where({ tenant }).whereIn('assignment_id', assignmentIds).orderBy('assignment_id');
      expect(assignments).toHaveLength(2);
      expect(new Set(assignments.map((row) => row.discount_id)).size).toBe(2);
      expect(assignments.map((row) => row.assignment_id).sort()).toEqual([...assignmentIds].sort());
      const definitions = await trx('discounts').whereIn('discount_id', assignments.map((row) => row.discount_id)).where({ tenant });
      expect(definitions).toHaveLength(2);
      expect(definitions.every((row) => row.discount_name === 'Shared old definition' && Number(row.value) === 0.125)).toBe(true);
      await isolateDefinitionsMigration.up(trx);
      const rerun = await trx('contract_discount_assignments').where({ tenant }).whereIn('assignment_id', assignmentIds).orderBy('assignment_id');
      expect(rerun.map((row) => row.discount_id)).toEqual(assignments.map((row) => row.discount_id));
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
