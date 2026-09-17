import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { ClientService } from '@/lib/api/services/ClientService';
import { createClientSchema, updateClientSchema } from '@/lib/api/schemas/client';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
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
    client_name: `Client ${tenantId.slice(0, 8)}`,
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

describe('client currency and billing-profile lifecycle integration', () => {
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
    if (db) {
      await db.destroy();
    }
  });

  // Regression: the field was absent from the request schema, so Zod stripped it
  // and the write returned 200 with the currency silently discarded.
  it('survives request-schema validation instead of being stripped', () => {
    const updateParsed = updateClientSchema.parse({ default_currency_code: 'eur' });
    expect(updateParsed.default_currency_code).toBe('EUR');

    const createParsed = createClientSchema.parse({
      client_name: 'Schema Client',
      billing_cycle: 'monthly',
      default_currency_code: 'gbp',
    });
    expect(createParsed.default_currency_code).toBe('GBP');
  });

  it('rejects a currency code that is not three characters', () => {
    expect(() => updateClientSchema.parse({ default_currency_code: 'EURO' })).toThrow();
    expect(() => updateClientSchema.parse({ default_currency_code: 'EU' })).toThrow();
  });

  it('persists default_currency_code on update and reflects it in the response', async () => {
    const tenantId = await createTenant();
    const clientId = await seedClient(tenantId);
    const service = serviceFor(tenantId);

    const payload = updateClientSchema.parse({ default_currency_code: 'eur' });
    const updated = await service.update(clientId, payload as any, {
      tenant: tenantId,
      userId: uuidv4(),
    } as any);

    expect(updated.default_currency_code).toBe('EUR');

    const persisted = await tenantTable(tenantId, 'clients').where({ client_id: clientId }).first();
    expect(persisted.default_currency_code).toBe('EUR');
  });

  it('persists default_currency_code on create and defaults to USD when omitted', async () => {
    const tenantId = await createTenant();
    const service = serviceFor(tenantId);

    const created = await service.create(
      createClientSchema.parse({
        client_name: 'Explicit Currency Client',
        billing_cycle: 'monthly',
        default_currency_code: 'jpy',
      }) as any,
      { tenant: tenantId, userId: uuidv4() } as any,
    );
    expect(created.default_currency_code).toBe('JPY');

    const defaulted = await service.create(
      createClientSchema.parse({
        client_name: 'Default Currency Client',
        billing_cycle: 'monthly',
      }) as any,
      { tenant: tenantId, userId: uuidv4() } as any,
    );
    expect(defaulted.default_currency_code).toBe('USD');
  });

  it('deletes a newly created client and its billing profile while preserving a neighboring client', async () => {
    const tenantId = await createTenant();
    const service = serviceFor(tenantId);
    const context = { tenant: tenantId, userId: uuidv4() };
    const created = await service.create({ client_name: 'Delete me', billing_cycle: 'monthly' } as any, context);
    const neighbor = await service.create({ client_name: 'Keep me', billing_cycle: 'monthly' } as any, context);
    const profiles = () => tenantTable(tenantId, 'client_billing_profiles');
    expect(await profiles().where({ client_id: created.client_id })).toHaveLength(1);
    const neighborProfiles = await profiles().where({ client_id: neighbor.client_id });
    expect(neighborProfiles).toHaveLength(1);

    await service.delete(created.client_id, context);

    expect(await tenantTable(tenantId, 'clients').where({ client_id: created.client_id }).first()).toBeUndefined();
    expect(await profiles().where({ client_id: created.client_id })).toEqual([]);
    expect(await profiles().where({ client_id: neighbor.client_id })).toEqual(neighborProfiles);
    expect(await tenantTable(tenantId, 'clients').where({ client_id: neighbor.client_id }).first()).toBeDefined();
  });

  it('preserves the client and billing profile when a contact blocks deletion', async () => {
    const tenantId = await createTenant();
    const service = serviceFor(tenantId);
    const context = { tenant: tenantId, userId: uuidv4() };
    const created = await service.create({ client_name: 'Blocked deletion', billing_cycle: 'monthly' } as any, context);
    const contactId = uuidv4();
    await tenantTable(tenantId, 'contacts').insert({
      tenant: tenantId, client_id: created.client_id, contact_name_id: contactId,
      full_name: 'Blocking contact', email: 'blocking@example.test',
    });
    const profiles = await tenantTable(tenantId, 'client_billing_profiles').where({ client_id: created.client_id });
    expect(profiles).toHaveLength(1);

    await expect(service.delete(created.client_id, context)).rejects.toMatchObject({ statusCode: 400 });

    expect(await tenantTable(tenantId, 'client_billing_profiles').where({ client_id: created.client_id })).toEqual(profiles);
    expect(await tenantTable(tenantId, 'clients').where({ client_id: created.client_id }).first()).toBeDefined();
    expect(await tenantTable(tenantId, 'contacts').where({ contact_name_id: contactId }).first()).toBeDefined();
  });
});
