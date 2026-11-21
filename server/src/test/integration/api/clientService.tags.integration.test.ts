/**
 * Client tags written through the REST service (POST/PUT /api/v1/clients `tags`).
 *
 * Regression: a tag list that repeats a text ("vip", "vip") made the second tag_mappings insert violate
 * (tenant, tag_id, tagged_id). The service caught that error inside the client's transaction and carried on, but
 * PostgreSQL had already aborted the transaction, so the commit rolled back: the API answered 201 with a client_id
 * for a client that was never saved, and the next call on it was a 404.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createUser } from '../../../../test-utils/testDataFactory';
import { ClientService } from '@/lib/api/services/ClientService';
import { createClientSchema, updateClientSchema } from '@/lib/api/schemas/client';

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: vi.fn(async () => undefined),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));

let db: Knex;
const tenantsToCleanup = new Set<string>();

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'tag_mappings').del();
  await tenantTable(tenantId, 'tag_definitions').del();
  await tenantTable(tenantId, 'users').del();
  await tenantTable(tenantId, 'contacts').del();
  await tenantTable(tenantId, 'client_contracts').del();
  await tenantTable(tenantId, 'contract_lines').del();
  await tenantTable(tenantId, 'contracts').del();
  await tenantTable(tenantId, 'client_billing_profiles').del();
  await tenantTable(tenantId, 'client_locations').del();
  await tenantTable(tenantId, 'clients').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenant(): Promise<string> {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Tags Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
  });
  return tenantId;
}

/** A tenant and an internal user in it to act as (tag mappings record their creator). */
async function createActor(): Promise<{ tenantId: string; context: any }> {
  const tenantId = await createTenant();
  const userId = await createUser(db, tenantId);
  return { tenantId, context: { tenant: tenantId, userId } };
}

function serviceFor(tenantId: string): ClientService {
  const service = new ClientService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
  return service;
}

async function storedTagTexts(tenantId: string, clientId: string): Promise<string[]> {
  const scoped = tenantDb(db, tenantId);
  const query = scoped.table('tag_mappings as m');
  scoped.tenantJoin(query, 'tag_definitions as d', 'd.tag_id', 'm.tag_id');
  const rows = await query
    .where({ 'm.tagged_id': clientId, 'm.tagged_type': 'client' })
    .select('d.tag_text');
  return rows.map((row: { tag_text: string }) => row.tag_text).sort();
}

describe('ClientService tags', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
  }, 180_000);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    await db?.destroy();
  });

  it('saves a client created with a repeated tag, mapping each distinct tag once', async () => {
    const { tenantId, context } = await createActor();
    const data = createClientSchema.parse({
      client_name: `Tagged ${uuidv4()}`,
      billing_cycle: 'monthly',
      tags: ['vip', 'vip', ' vip ', 'priority', ''],
    });

    const created = await serviceFor(tenantId).create(data as any, context);

    const stored = await tenantTable(tenantId, 'clients').where({ client_id: created.client_id }).first();
    expect(stored?.client_name).toBe(data.client_name);
    expect(await storedTagTexts(tenantId, created.client_id)).toEqual(['priority', 'vip']);
    // The client the create answered with can be used straight away (the CI symptom was a 404 here).
    expect(await serviceFor(tenantId).getById(created.client_id, context)).toMatchObject({
      client_id: created.client_id,
    });
  });

  it('saves an update that repeats a tag, replacing the mappings with the distinct tags', async () => {
    const { tenantId, context } = await createActor();
    const created = await serviceFor(tenantId).create(
      createClientSchema.parse({ client_name: `Tagged ${uuidv4()}`, billing_cycle: 'monthly', tags: ['old'] }) as any,
      context
    );

    const updated = await serviceFor(tenantId).update(
      created.client_id,
      updateClientSchema.parse({ client_name: 'Renamed tagged client', tags: ['new', 'new'] }) as any,
      context
    );

    expect(updated.client_name).toBe('Renamed tagged client');
    const stored = await tenantTable(tenantId, 'clients').where({ client_id: created.client_id }).first();
    expect(stored?.client_name).toBe('Renamed tagged client');
    expect(await storedTagTexts(tenantId, created.client_id)).toEqual(['new']);
  });
});
