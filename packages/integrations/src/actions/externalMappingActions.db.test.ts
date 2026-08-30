import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from './_dbTestUtils';

// ── Module mocks (hoisted before imports) ───────────────────────────────────

const qboReadMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => any) => async (...args: any[]) => fn(...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('../lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: vi.fn(),
  QboClientService: {
    create: vi.fn(async () => ({ read: qboReadMock })),
  },
}));

vi.mock('../lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: vi.fn(),
}));

import { getStoredQboCredentialsMap } from '../lib/qbo/qboClientService';
import {
  createExternalEntityMapping,
  updateExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
} from './externalMappingActions';

const realmA = 'realm-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const tenantA = uuidv4();
const tenantB = uuidv4();

let db: Knex;
let serviceA: string;
let serviceB: string;
let clientA: string;

async function seedTenant(tenantId: string): Promise<void> {
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Action Test ${tenantId.slice(0, 8)}`,
    email: `action-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function seedService(tenantId: string): Promise<string> {
  const serviceId = uuidv4();
  const serviceTypeId = uuidv4();
  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: `Service Type ${serviceId.slice(0, 8)}`,
    is_active: true,
    order_number: 1,
  });
  await db('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: `Service ${serviceId.slice(0, 8)}`,
    is_active: true,
    billing_method: 'fixed',
    item_kind: 'service',
    custom_service_type_id: serviceTypeId,
  });
  return serviceId;
}

async function seedClient(tenantId: string): Promise<string> {
  const clientId = uuidv4();
  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${clientId.slice(0, 8)}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return clientId;
}

async function seedMapping(overrides: Record<string, unknown> = {}): Promise<{ id: string; alga_entity_id: string }> {
  const row = {
    tenant: tenantA,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'service',
    alga_entity_id: uuidv4(),
    external_entity_id: uuidv4(),
    external_realm_id: realmA,
    sync_status: 'synced',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  };
  const [inserted] = await db('tenant_external_entity_mappings').insert(row).returning(['id', 'alga_entity_id']);
  return inserted;
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  await seedTenant(tenantA);
  await seedTenant(tenantB);
  serviceA = await seedService(tenantA);
  serviceB = await seedService(tenantB);
  clientA = await seedClient(tenantA);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('audit_logs').where({ tenant: tenantA }).del();
  vi.mocked(getStoredQboCredentialsMap).mockResolvedValue({ [realmA]: { realmId: realmA } } as any);
  qboReadMock.mockReset();
  // By default the remote entity exists; individual tests override to ghost it.
  qboReadMock.mockImplementation(async (_type: string, id: string) => ({ Id: id }));
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('audit_logs').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('service_types').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('clients').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('tenants').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db.destroy().catch(() => undefined);
});

async function lastAudit(tenantId: string, operation: string) {
  return db('audit_logs')
    .where({ tenant: tenantId, operation, table_name: 'tenant_external_entity_mappings' })
    .orderBy('timestamp', 'desc')
    .first();
}

describe('createExternalEntityMapping — the generic surface is constrained', () => {
  it('rejects money-moving entity types (invoice / payment / credit) before any write', async () => {
    for (const entityType of ['invoice', 'invoice_payment', 'credit_application']) {
      const result = await (createExternalEntityMapping as any)(
        { user_id: 'u' },
        { tenant: tenantA },
        {
          integration_type: 'quickbooks_online',
          alga_entity_type: entityType,
          alga_entity_id: uuidv4(),
          external_entity_id: uuidv4(),
          external_realm_id: realmA,
        }
      );
      expect(result).toMatchObject({ actionError: expect.stringContaining('cannot be edited here') });
    }
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);
  });

  it('rejects an unknown provider', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'some_other_erp',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: uuidv4(),
      }
    );
    expect(result).toMatchObject({ actionError: expect.stringContaining('Unknown accounting provider') });
  });

  it('rejects a realm that is not a connected QuickBooks company', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: uuidv4(),
        external_realm_id: 'realm-not-connected',
      }
    );
    expect(result).toMatchObject({ actionError: expect.stringContaining('not a connected') });
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);
  });

  it('rejects a local entity that belongs to another tenant', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        // serviceB lives in tenantB
        alga_entity_id: serviceB,
        external_entity_id: uuidv4(),
        external_realm_id: realmA,
      }
    );
    expect(result).toMatchObject({ actionError: expect.stringContaining('does not exist for this tenant') });
  });

  it('rejects an external id that does not exist in the connected company', async () => {
    qboReadMock.mockImplementation(async () => null);
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'item-ghost',
        external_realm_id: realmA,
      }
    );
    expect(result).toMatchObject({ actionError: expect.stringContaining('does not exist in the connected company') });
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);
  });

  it('accepts a valid catalog mapping and writes a CREATE audit event', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'item-42',
        external_realm_id: realmA,
        metadata: { note: 'mapped' },
      }
    );

    expect(result).toMatchObject({ id: expect.any(String), alga_entity_id: serviceA, external_entity_id: 'item-42' });
    const rows = await db('tenant_external_entity_mappings').where({ tenant: tenantA, alga_entity_id: serviceA });
    expect(rows).toHaveLength(1);

    const audit = await lastAudit(tenantA, 'CREATE');
    expect(audit).toBeTruthy();
    expect(audit.details).toMatchObject({ provider: 'quickbooks_online', entity_type: 'service', realm: realmA });
    // No OAuth tokens or raw provider payloads in the audit event.
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toMatch(/accessToken|refreshToken|clientSecret/i);
  });
});

describe('updateExternalEntityMapping — retarget rules', () => {
  it('rejects retargeting a money-moving mapping through the generic action', async () => {
    const { id } = await seedMapping({ alga_entity_type: 'invoice' });
    const result = await (updateExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      id,
      { external_entity_id: uuidv4() }
    );
    expect(result).toMatchObject({ actionError: expect.stringContaining('cannot be edited here') });
  });

  it('accepts a catalog retarget, revalidates the remote, and audits the change', async () => {
    const { id } = await seedMapping({ alga_entity_id: serviceA });
    const result = await (updateExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      id,
      { external_entity_id: 'item-99' }
    );
    expect(result).toMatchObject({ id, external_entity_id: 'item-99' });
    expect(qboReadMock).toHaveBeenCalledWith('Item', 'item-99');

    const audit = await lastAudit(tenantA, 'UPDATE');
    expect(audit).toBeTruthy();
    expect(audit.changed_data.external_entity_id).toMatchObject({ to: 'item-99' });
  });

  it('rejects a catalog retarget to a remote id that does not exist', async () => {
    const { id } = await seedMapping({ alga_entity_id: serviceA });
    qboReadMock.mockImplementation(async () => null);
    const result = await (updateExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      id,
      { external_entity_id: 'item-ghost' }
    );
    expect(result).toMatchObject({ actionError: expect.stringContaining('does not exist in the connected company') });
    const row = await db('tenant_external_entity_mappings').where({ id }).first();
    expect(row.external_entity_id).not.toBe('item-ghost');
  });
});

describe('unlink (tombstone) and explicit relink', () => {
  it('unlink tombstones the row, hides it from reads, and writes an UNLINK audit', async () => {
    const { id } = await seedMapping({ alga_entity_id: serviceA });
    const result = await (deleteExternalEntityMapping as any)({ user_id: 'u' }, { tenant: tenantA }, id);
    expect(result).toEqual({ success: true });

    const row = await db('tenant_external_entity_mappings').where({ id }).first();
    expect(row.deleted_at).not.toBeNull();
    expect(row.sync_status).toBe('unlinked');

    const listed = await (getExternalEntityMappings as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      { integrationType: 'quickbooks_online' }
    );
    expect(listed.find((m: any) => m.id === id)).toBeUndefined();

    const audit = await lastAudit(tenantA, 'UNLINK');
    expect(audit).toBeTruthy();
  });

  it('re-creating the same mapping relinks the tombstone in place and audits the relink', async () => {
    const { id } = await seedMapping({ alga_entity_id: serviceA });
    await (deleteExternalEntityMapping as any)({ user_id: 'u' }, { tenant: tenantA }, id);

    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'item-relinked',
        external_realm_id: realmA,
      }
    );

    expect(result.id).toBe(id);
    expect(result.external_entity_id).toBe('item-relinked');

    const rows = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA, alga_entity_type: 'service', alga_entity_id: serviceA })
      .whereNull('deleted_at');
    expect(rows).toHaveLength(1);

    const audit = await lastAudit(tenantA, 'CREATE');
    expect(audit.details).toMatchObject({ relinked: true });
  });
});
