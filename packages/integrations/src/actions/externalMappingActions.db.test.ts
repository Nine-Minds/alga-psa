import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from './_dbTestUtils';

// ── Module mocks (hoisted before imports) ───────────────────────────────────

const qboReadMock = vi.hoisted(() => vi.fn());
const xeroListItemsMock = vi.hoisted(() => vi.fn());
const xeroListTaxRatesMock = vi.hoisted(() => vi.fn());

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
  XeroClientService: {
    create: vi.fn(async () => ({
      listItems: xeroListItemsMock,
      listTaxRates: xeroListTaxRatesMock,
    })),
  },
}));

import { getStoredQboCredentialsMap } from '../lib/qbo/qboClientService';
import { getStoredXeroConnections } from '../lib/xero/xeroClientService';
import {
  createExternalEntityMapping,
  updateExternalEntityMapping,
  deleteExternalEntityMapping,
  getExternalEntityMappings,
} from './externalMappingActions';

const realmA = 'realm-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const xeroRealm = 'xero-org-11111111-1111-1111-1111-111111111111';

const tenantA = uuidv4();
const tenantB = uuidv4();

let db: Knex;
let serviceA: string;
let serviceB: string;
let clientA: string;
let taxRegionA: string;

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

async function seedTaxRegion(tenantId: string): Promise<string> {
  const regionCode = `RG-${uuidv4().slice(0, 8).toUpperCase()}`;
  await db('tax_regions')
    .insert({
      tenant: tenantId,
      region_code: regionCode,
      region_name: `Region ${regionCode}`,
      is_active: true,
    })
    .onConflict(['tenant', 'region_code'])
    .ignore();
  return regionCode;
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
  taxRegionA = await seedTaxRegion(tenantA);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('audit_logs').where({ tenant: tenantA }).del();
  vi.mocked(getStoredQboCredentialsMap).mockResolvedValue({ [realmA]: { realmId: realmA } } as any);
  qboReadMock.mockReset();
  // By default the remote entity exists; individual tests override to ghost it.
  qboReadMock.mockImplementation(async (_type: string, id: string) => ({ Id: id }));

  // The Xero organisation is connected under xeroRealm, and by default its
  // catalog holds one active item (code "XERO-ITEM-1") and one active tax rate
  // (taxType "OUTPUT2"); individual tests override to ghost or archive them.
  vi.mocked(getStoredXeroConnections).mockResolvedValue({
    'xero-conn-1': { connectionId: 'xero-conn-1', xeroTenantId: xeroRealm },
  } as any);
  xeroListItemsMock.mockReset();
  xeroListTaxRatesMock.mockReset();
  xeroListItemsMock.mockResolvedValue([
    { itemId: 'item-guid-1', code: 'XERO-ITEM-1', name: 'Managed Service', status: 'ACTIVE' },
  ]);
  xeroListTaxRatesMock.mockResolvedValue([
    { taxRateId: 'rate-guid-1', name: 'Sales Tax', taxType: 'OUTPUT2', status: 'ACTIVE' },
  ]);
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('audit_logs').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('service_types').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('clients').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
  await db('tax_regions').where({ tenant: tenantA }).orWhere({ tenant: tenantB }).del();
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

describe('createExternalEntityMapping — sync state is server-derived, not caller-supplied', () => {
  it('ignores a caller-supplied sync_status on create: stores manual_link and audits derived state', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'item-claim-1',
        external_realm_id: realmA,
        sync_status: 'synced',
      }
    );

    expect(result).toMatchObject({ id: expect.any(String), external_entity_id: 'item-claim-1' });

    const row = await db('tenant_external_entity_mappings').where({ id: result.id }).first();
    expect(row).toBeTruthy();
    expect(row.sync_status).toBe('manual_link');

    const audit = await lastAudit(tenantA, 'CREATE');
    expect(audit).toBeTruthy();
    expect(audit.changed_data.sync_status).toBe('manual_link');
    // The caller's fabricated 'synced' state appears nowhere in the trail.
    expect(JSON.stringify(audit)).not.toContain('synced');
  });

  it('ignores a caller-supplied sync_status on tombstone relink: stores manual_link and audits derived state', async () => {
    const { id } = await seedMapping({ alga_entity_id: serviceA });
    await (deleteExternalEntityMapping as any)({ user_id: 'u' }, { tenant: tenantA }, id);

    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'quickbooks_online',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'item-relinked-claim',
        external_realm_id: realmA,
        sync_status: 'synced',
      }
    );

    // Relinked in place: same row id, revived tombstone.
    expect(result.id).toBe(id);
    expect(result.external_entity_id).toBe('item-relinked-claim');

    const row = await db('tenant_external_entity_mappings').where({ id }).first();
    expect(row).toBeTruthy();
    expect(row.deleted_at).toBeNull();
    expect(row.sync_status).toBe('manual_link');

    const audit = await lastAudit(tenantA, 'CREATE');
    expect(audit).toBeTruthy();
    expect(audit.details).toMatchObject({ relinked: true });
    expect(audit.changed_data.sync_status).toBe('manual_link');
    expect(JSON.stringify(audit)).not.toContain('synced');
  });
});

describe('createExternalEntityMapping — Xero catalog links are proven against the connected org', () => {
  it('rejects a Xero service item code that is not in the connected organisation', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'XERO-ITEM-GHOST',
        external_realm_id: xeroRealm,
      }
    );
    expect(result).toMatchObject({
      actionError: expect.stringContaining('does not exist in the connected organisation'),
    });
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);
  });

  it('rejects a Xero item that exists but is archived/deleted (stale)', async () => {
    xeroListItemsMock.mockResolvedValue([
      { itemId: 'item-guid-1', code: 'XERO-ITEM-1', name: 'Managed Service', status: 'DELETED' },
    ]);
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'XERO-ITEM-1',
        external_realm_id: xeroRealm,
      }
    );
    expect(result).toMatchObject({
      actionError: expect.stringContaining('does not exist in the connected organisation'),
    });
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);
  });

  it('accepts a Xero service mapping whose item code is live in the connected org', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'XERO-ITEM-1',
        external_realm_id: xeroRealm,
      }
    );
    expect(result).toMatchObject({ id: expect.any(String), external_entity_id: 'XERO-ITEM-1' });
    expect(xeroListItemsMock).toHaveBeenCalled();
    const rows = await db('tenant_external_entity_mappings').where({ tenant: tenantA, alga_entity_id: serviceA });
    expect(rows).toHaveLength(1);
    expect(rows[0].integration_type).toBe('xero');
  });

  it('rejects a Xero tax_code whose TaxType is not in the connected org, accepts a live one', async () => {
    const ghost = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'tax_code',
        alga_entity_id: taxRegionA,
        external_entity_id: 'OUTPUT-GHOST',
        external_realm_id: xeroRealm,
      }
    );
    expect(ghost).toMatchObject({
      actionError: expect.stringContaining('does not exist in the connected organisation'),
    });
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);

    const ok = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'tax_code',
        alga_entity_id: taxRegionA,
        external_entity_id: 'OUTPUT2',
        external_realm_id: xeroRealm,
      }
    );
    expect(ok).toMatchObject({ id: expect.any(String), external_entity_id: 'OUTPUT2' });
    expect(xeroListTaxRatesMock).toHaveBeenCalled();
  });

  it('rejects a Xero mapping for a realm that is not a connected organisation', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceA,
        external_entity_id: 'XERO-ITEM-1',
        external_realm_id: 'xero-org-not-connected',
      }
    );
    expect(result).toMatchObject({ actionError: expect.stringContaining('not a connected Xero') });
    expect(xeroListItemsMock).not.toHaveBeenCalled();
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);
  });

  it('rejects a Xero catalog type with no Xero counterpart on this surface (fail closed)', async () => {
    const result = await (createExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'payment_term',
        alga_entity_id: 'net_30',
        external_entity_id: 'anything',
        external_realm_id: xeroRealm,
      }
    );
    expect(result).toMatchObject({
      actionError: expect.stringContaining('not managed by the Xero mapping screen'),
    });
    expect(xeroListItemsMock).not.toHaveBeenCalled();
    expect(xeroListTaxRatesMock).not.toHaveBeenCalled();
    expect(await db('tenant_external_entity_mappings').where({ tenant: tenantA })).toHaveLength(0);
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

  it('revalidates a Xero retarget against the connected org: rejects a stale code, accepts a live one', async () => {
    const { id } = await seedMapping({
      integration_type: 'xero',
      alga_entity_id: serviceA,
      external_entity_id: 'XERO-ITEM-1',
      external_realm_id: xeroRealm,
    });

    const ghost = await (updateExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      id,
      { external_entity_id: 'XERO-ITEM-GHOST' }
    );
    expect(ghost).toMatchObject({
      actionError: expect.stringContaining('does not exist in the connected organisation'),
    });
    const unchanged = await db('tenant_external_entity_mappings').where({ id }).first();
    expect(unchanged.external_entity_id).toBe('XERO-ITEM-1');

    xeroListItemsMock.mockResolvedValue([
      { itemId: 'item-guid-2', code: 'XERO-ITEM-2', name: 'Support', status: 'ACTIVE' },
    ]);
    const ok = await (updateExternalEntityMapping as any)(
      { user_id: 'u' },
      { tenant: tenantA },
      id,
      { external_entity_id: 'XERO-ITEM-2' }
    );
    expect(ok).toMatchObject({ id, external_entity_id: 'XERO-ITEM-2' });
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
