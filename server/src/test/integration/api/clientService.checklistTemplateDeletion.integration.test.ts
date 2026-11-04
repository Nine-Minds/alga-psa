import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ClientService } from '@/lib/api/services/ClientService';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;

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
  await tenantTable(tenantId, 'checklist_template_items').del();
  await tenantTable(tenantId, 'checklist_templates').del();
  await tenantTable(tenantId, 'contacts').del();
  await tenantTable(tenantId, 'client_contracts').del();
  await tenantTable(tenantId, 'contract_lines').del();
  await tenantTable(tenantId, 'contracts').del();
  // Billing profiles reference clients (NO ACTION); the service under test
  // provisions one per client it creates, so clear them before the clients.
  await tenantTable(tenantId, 'client_billing_profiles').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenant(): Promise<string> {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Currency Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return tenantId;
}

async function seedClient(tenantId: string): Promise<string> {
  const clientId = uuidv4();

  await tenantTable(tenantId, 'clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${clientId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return clientId;
}

function serviceFor(tenantId: string): ClientService {
  const service = new ClientService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

describe('client deletion releases client-scoped checklist templates (API service path)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    tenantColumns = await schemaTable('tenants').columnInfo();
    clientColumns = await schemaTable('clients').columnInfo();
  });

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('deactivates and detaches scoped templates, and leaves other templates alone', async () => {
    const tenantId = await createTenant();
    const doomedClient = await seedClient(tenantId);
    const otherClient = await seedClient(tenantId);
    const insertTemplate = async (clientId: string | null) => {
      const templateId = uuidv4();
      await tenantTable(tenantId, 'checklist_templates').insert({
        tenant: tenantId,
        template_id: templateId,
        name: `Template ${templateId.slice(0, 6)}`,
        description: null,
        is_active: true,
        client_id: clientId,
      });
      return templateId;
    };
    const scoped = await insertTemplate(doomedClient);
    const other = await insertTemplate(otherClient);
    const wide = await insertTemplate(null);

    await serviceFor(tenantId).delete(doomedClient, { tenant: tenantId, userId: uuidv4() } as any);

    expect(await tenantTable(tenantId, 'clients').where({ client_id: doomedClient }).first()).toBeUndefined();
    const row = await tenantTable(tenantId, 'checklist_templates').where({ template_id: scoped }).first();
    expect(row).toMatchObject({ is_active: false, client_id: null });
    expect(row.description).toContain('was deleted');
    expect(await tenantTable(tenantId, 'checklist_templates').where({ template_id: other }).first())
      .toMatchObject({ is_active: true, client_id: otherClient });
    expect(await tenantTable(tenantId, 'checklist_templates').where({ template_id: wide }).first())
      .toMatchObject({ is_active: true, client_id: null });
  });
});
