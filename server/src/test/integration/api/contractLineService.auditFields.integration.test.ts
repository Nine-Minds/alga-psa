import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { BaseService, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ContractLineService } from '@/lib/api/services/ContractLineService';
import { PermissionRoleService } from '@/lib/api/services/PermissionRoleService';

// The CONTRACT_LINE_CREATED publish is a known defect (alga-2026-0002675) and is
// out of scope here; neutralize the transport so these tests exercise the write
// path without depending on a running event bus.
vi.mock('server/src/lib/eventBus/publishers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('server/src/lib/eventBus/publishers')>();
  return { ...actual, publishUnregisteredEventType: vi.fn(async () => undefined) };
});

// assignPlanToClient delegates service/config cloning to this helper; the write
// path under test is the audit-stamped contract_lines insert itself.
vi.mock('@alga-psa/billing/lib/billing/utils/templateClone', () => ({
  cloneTemplateContractLine: vi.fn(async () => ({ appliedCustomRate: null })),
}));

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let contractColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'contract_line_service_configuration').del();
  await tenantTable(tenantId, 'contract_line_services').del();
  await tenantTable(tenantId, 'contract_lines').del();
  await tenantTable(tenantId, 'client_contracts').del();
  await tenantTable(tenantId, 'contracts').del();
  await tenantTable(tenantId, 'contract_templates').del();
  await tenantTable(tenantId, 'role_permissions').del();
  await tenantTable(tenantId, 'roles').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenant(): Promise<string> {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Audit Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  return tenantId;
}

async function createClient(tenantId: string): Promise<string> {
  const clientId = uuidv4();
  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Owner Client ${clientId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });
  return clientId;
}

function serviceFor(tenantId: string): ContractLineService {
  const service = new ContractLineService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

/**
 * A bare BaseService on `contract_lines`, which has created_at/updated_at but no
 * created_by/updated_by. Exercises the base create/update/bulk paths directly.
 */
class ContractLineBaseService extends BaseService<any> {
  constructor() {
    super({ tableName: 'contract_lines', primaryKey: 'contract_line_id' });
  }
}

function baseServiceFor(tenantId: string): ContractLineBaseService {
  const service = new ContractLineBaseService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

async function insertContract(
  tenantId: string,
  ownerClientId: string | null,
  isTemplate = false,
): Promise<string> {
  const contractId = uuidv4();
  await tenantTable(tenantId, 'contracts').insert({
    tenant: tenantId,
    contract_id: contractId,
    contract_name: `Contract ${contractId.slice(0, 8)}`,
    billing_frequency: 'monthly',
    ...(hasColumn(contractColumns, 'owner_client_id') && ownerClientId ? { owner_client_id: ownerClientId } : {}),
    ...(hasColumn(contractColumns, 'is_template') ? { is_template: isTemplate } : {}),
    ...(hasColumn(contractColumns, 'status') ? { status: 'draft' } : {}),
    ...(hasColumn(contractColumns, 'is_active') ? { is_active: true } : {}),
  });
  return contractId;
}

async function insertContractLine(tenantId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const contractLineId = uuidv4();
  await tenantTable(tenantId, 'contract_lines').insert({
    tenant: tenantId,
    contract_line_id: contractLineId,
    contract_line_name: `Line ${contractLineId.slice(0, 8)}`,
    billing_frequency: 'monthly',
    contract_line_type: 'Fixed',
    ...overrides,
  });
  return contractLineId;
}

describe('contract line audit-field persistence (real schema)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantColumns = await schemaTable('tenants').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
    contractColumns = await schemaTable('contracts').columnInfo();
  });

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  describe('BaseService on contract_lines (no created_by/updated_by)', () => {
    it('creates and updates without writing the missing audit columns', async () => {
      const tenantId = await createTenant();
      const service = baseServiceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const created = await service.create({ contract_line_name: 'Base create' }, context);
      expect(created.contract_line_id).toBeTruthy();
      expect(created).not.toHaveProperty('created_by');

      const row = await tenantTable(tenantId, 'contract_lines')
        .where({ contract_line_id: created.contract_line_id })
        .first();
      expect(row.contract_line_name).toBe('Base create');
      expect(row).not.toHaveProperty('created_by');

      const updated = await service.update(created.contract_line_id, { contract_line_name: 'Base update' }, context);
      expect(updated.contract_line_name).toBe('Base update');
      expect(updated).not.toHaveProperty('updated_by');
    });

    it('bulk-creates and bulk-updates without writing the missing audit columns', async () => {
      const tenantId = await createTenant();
      const service = baseServiceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const created = await service.bulkCreate(
        [{ contract_line_name: 'Bulk one' }, { contract_line_name: 'Bulk two' }],
        context,
      );
      expect(created).toHaveLength(2);
      expect(created.every(row => !('created_by' in row))).toBe(true);

      const updated = await service.bulkUpdate(
        created.map(row => ({ id: row.contract_line_id, data: { contract_line_name: `Edited ${row.contract_line_name}` } })),
        context,
      );
      expect(updated).toHaveLength(2);
      expect(updated.every(row => !('updated_by' in row))).toBe(true);
    });

    it('filters created_/updated_ ranges against the real timestamps', async () => {
      const tenantId = await createTenant();
      const service = baseServiceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const created = await service.create({ contract_line_name: 'Range row' }, context);
      const row = await tenantTable(tenantId, 'contract_lines')
        .where({ contract_line_id: created.contract_line_id })
        .first();
      const updatedAt = new Date(row.updated_at).getTime();

      const within = await service.list(
        { page: 1, limit: 25, filters: { updated_from: new Date(updatedAt - 60_000).toISOString() } },
        context,
      );
      expect(within.data.map((r: any) => r.contract_line_id)).toContain(created.contract_line_id);

      const after = await service.list(
        { page: 1, limit: 25, filters: { updated_from: new Date(updatedAt + 60_000).toISOString() } },
        context,
      );
      expect(after.data.map((r: any) => r.contract_line_id)).not.toContain(created.contract_line_id);
    });
  });

  describe('ContractLineService write paths', () => {
    // Regression alga-2026-0002721: POST /api/v1/contract-lines stamped
    // created_by/updated_by, columns contract_lines has never had, so every
    // create 500'd with 42703.
    it('creates a contract line (POST /api/v1/contract-lines)', async () => {
      const tenantId = await createTenant();
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const created = await service.create(
        { contract_line_name: 'API created line', billing_frequency: 'monthly', contract_line_type: 'Fixed' } as any,
        context,
      );

      expect(created.contract_line_id).toBeTruthy();
      const row = await tenantTable(tenantId, 'contract_lines')
        .where({ contract_line_id: created.contract_line_id })
        .first();
      expect(row).toBeTruthy();
      expect(row.contract_line_name).toBe('API created line');
    });

    it('updates a contract line (PUT /api/v1/contract-lines/{id})', async () => {
      const tenantId = await createTenant();
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;
      const contractLineId = await insertContractLine(tenantId);

      const updated = await service.update(contractLineId, { contract_line_name: 'Updated line' } as any, context);
      expect(updated.contract_line_name).toBe('Updated line');
    });

    it('updates a contract line through updatePlan', async () => {
      const tenantId = await createTenant();
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;
      const contractLineId = await insertContractLine(tenantId);

      const updated = await service.updatePlan(contractLineId, { contract_line_name: 'Plan updated' } as any, context);
      expect(updated.contract_line_name).toBe('Plan updated');
      expect((updated as any)._links).toBeTruthy();
    });

    it('sets contract line activation (PUT /api/v1/contract-lines/{id}/activation)', async () => {
      const tenantId = await createTenant();
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;
      const contractLineId = await insertContractLine(tenantId);

      const updated = await service.setPlanActivation(contractLineId, { is_active: false } as any, context);
      expect(updated.is_active).toBe(false);
    });

    it('bulk-creates contract lines (POST /api/v1/contract-lines/bulk/create)', async () => {
      const tenantId = await createTenant();
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const created = await service.bulkCreateContractLines(
        {
          plans: [
            { contract_line_name: 'Bulk A', billing_frequency: 'monthly', contract_line_type: 'Fixed' },
            { contract_line_name: 'Bulk B', billing_frequency: 'monthly', contract_line_type: 'Hourly' },
          ],
        } as any,
        context,
      );
      expect(created).toHaveLength(2);
      expect(created.every(line => (line as any).contract_line_id)).toBe(true);
    });

    it('copies a contract line', async () => {
      const tenantId = await createTenant();
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;
      const sourceId = await insertContractLine(tenantId, { contract_line_name: 'Source line' });

      const copy = await service.copyPlan(
        {
          source_contract_line_id: sourceId,
          new_contract_line_name: 'Copied line',
          copy_services: false,
          copy_configurations: false,
        } as any,
        context,
      );
      expect(copy.contract_line_id).toBeTruthy();
      expect(copy.contract_line_id).not.toBe(sourceId);
      const row = await tenantTable(tenantId, 'contract_lines')
        .where({ contract_line_id: copy.contract_line_id })
        .first();
      expect(row.contract_line_name).toBe('Copied line');
    });

    it('assigns a contract line to a client', async () => {
      const tenantId = await createTenant();
      const clientId = await createClient(tenantId);
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const targetContractId = await insertContract(tenantId, clientId);
      const templateContractId = await insertContract(tenantId, null, true);
      // client_contracts.template_contract_id is a contract_templates.template_id
      // (Contract.getAllWithClients joins it that way), and the assignment now
      // resolves the template's amounts for the target contract's currency through
      // it, so the template row has to exist and carry a base currency.
      const templateId = uuidv4();
      await tenantTable(tenantId, 'contract_templates').insert({
        tenant: tenantId,
        template_id: templateId,
        template_name: `Assignable template ${templateId.slice(0, 8)}`,
        currency_code: 'USD',
      });
      const clientContractId = uuidv4();
      await tenantTable(tenantId, 'client_contracts').insert({
        tenant: tenantId,
        client_contract_id: clientContractId,
        client_id: clientId,
        contract_id: targetContractId,
        template_contract_id: templateId,
        start_date: '2026-01-01',
        is_active: true,
      });
      const templateLineId = await insertContractLine(tenantId, {
        contract_line_name: 'Assignable template line',
        contract_id: templateContractId,
      });

      const assigned = await service.assignPlanToClient(
        {
          client_contract_id: clientContractId,
          client_id: clientId,
          contract_line_id: templateLineId,
          start_date: '2026-01-01',
          end_date: null,
          custom_rate: null,
        } as any,
        context,
      );

      expect(assigned.contract_line_id).toBeTruthy();
      const row = await tenantTable(tenantId, 'contract_lines')
        .where({ contract_line_id: assigned.contract_line_id })
        .first();
      expect(row).toBeTruthy();
      expect(row.contract_line_name).toBe('Assignable template line');
    });

    it('unassigns a client contract line by deactivating it', async () => {
      const tenantId = await createTenant();
      const clientId = await createClient(tenantId);
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const contractId = await insertContract(tenantId, clientId);
      const contractLineId = await insertContractLine(tenantId, { contract_id: contractId, is_active: true });

      // validateSafeUnassignment reads invoices.client_contract_line_id, a column
      // the current schema does not have (pre-existing, unrelated to audit
      // fields). Stub the guard so the audit-stamped deactivation runs for real.
      vi.spyOn(service as any, 'validateSafeUnassignment').mockResolvedValue(undefined);

      await service.unassignPlanFromClient(contractLineId, context);

      const row = await tenantTable(tenantId, 'contract_lines')
        .where({ contract_line_id: contractLineId })
        .first();
      expect(row.is_active).toBe(false);
    });

    // PermissionRoleService no longer overrides the audit helpers; roles has
    // created_at/updated_at but not created_by/updated_by, so this proves the
    // base filter drops the missing columns for it too.
    it('creates and updates a role without writing the missing audit columns', async () => {
      const tenantId = await createTenant();
      const service = new PermissionRoleService();
      vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
      const context = { tenant: tenantId, userId: uuidv4() } as any;

      const role = await service.createRole({ role_name: `Role ${uuidv4().slice(0, 8)}` } as any, context);
      expect(role.role_id).toBeTruthy();

      const updated = await service.updateRole(role.role_id, { description: 'updated role' } as any, context);
      expect(updated.description).toBe('updated role');
    });

    it('filters contract lines by updated_from (GET ...?updated_from=)', async () => {
      const tenantId = await createTenant();
      const service = serviceFor(tenantId);
      const context = { tenant: tenantId, userId: uuidv4() } as any;
      const contractLineId = await insertContractLine(tenantId, { contract_line_name: 'Filtered line' });

      const row = await tenantTable(tenantId, 'contract_lines')
        .where({ contract_line_id: contractLineId })
        .first();
      const updatedAt = new Date(row.updated_at).getTime();

      const included = await service.list(
        { page: 1, limit: 25, filters: { updated_from: new Date(updatedAt - 60_000).toISOString() } },
        context,
      );
      expect(included.data.map((line: any) => line.contract_line_id)).toContain(contractLineId);

      const excluded = await service.list(
        { page: 1, limit: 25, filters: { updated_from: new Date(updatedAt + 60_000).toISOString() } },
        context,
      );
      expect(excluded.data.map((line: any) => line.contract_line_id)).not.toContain(contractLineId);
    });
  });
});
