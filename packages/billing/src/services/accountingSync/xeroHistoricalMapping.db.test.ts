/* eslint-disable custom-rules/no-feature-to-feature-imports -- DB test drives the integrations mapping action and the billing resolver together */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

/**
 * DB-backed Xero historical-mapping compatibility.
 *
 * A UI-created mapping (canonical connection id) is consumed by export
 * resolution and then reconciled by an inbound payment. Pre-unification
 * organisation-keyed rows stay visible and editable for the owning connection
 * only, and deleting a mapping tombstones the whole identity group so a hidden
 * historical row can never resurface as the export fallback.
 */

const xeroListItems = vi.hoisted(() => vi.fn());
const recordExternalPaymentMock = vi.hoisted(() => vi.fn());
const reverseExternalPaymentMock = vi.hoisted(() => vi.fn());

const connectionsState = vi.hoisted(() => ({
  value: {
    'conn-review': { connectionId: 'conn-review', xeroTenantId: 'org-review' },
    'conn-other': { connectionId: 'conn-other', xeroTenantId: 'org-other' }
  } as Record<string, { connectionId: string; xeroTenantId: string }>
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/xero/xeroClientService')>()),
  getStoredXeroConnections: async () => connectionsState.value,
  XeroClientService: {
    create: vi.fn(async () => ({
      listItems: xeroListItems,
      listAccounts: vi.fn(async () => []),
      listTaxRates: vi.fn(async () => []),
      listTrackingCategories: vi.fn(async () => []),
      createInvoices: vi.fn(async () => [])
    }))
  }
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: unknown) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));
vi.mock('./recordExternalPayment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./recordExternalPayment')>()),
  recordExternalPayment: recordExternalPaymentMock,
  reverseExternalPayment: reverseExternalPaymentMock
}));

import * as dbModule from '@alga-psa/db';
import {
  getExternalEntityMappings,
  createExternalEntityMapping,
  deleteExternalEntityMapping
} from '@alga-psa/integrations/actions';
import { AccountingMappingResolver } from '../accountingMappingResolver';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';
import { applyExternalPaymentChange } from './paymentApplier';
import { SyncMappingLedger } from './syncMappingLedger';
import { wireLocalTestDbEnv, createTestDbConnection } from '../../actions/_dbTestUtils';

const tenantA = randomUUID();
const tenantB = randomUUID();
let db: Knex;

function makeStats() {
  return {
    paymentsApplied: 0,
    paymentsReversed: 0,
    paymentsSkipped: 0,
    driftFound: 0,
    customersUpdated: 0,
    opsProcessed: 0,
    opsFailed: 0,
    unmappedIgnored: 0,
    exceptionsCreated: 0,
    refundReceiptsSeen: 0,
    truncated: false
  };
}

function makeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: db, tenant: tenantA } as any);
  vi.spyOn(dbModule, 'writeAccountingAudit').mockResolvedValue(undefined);
  vi.spyOn(dbModule, 'auditLog').mockResolvedValue(undefined);

  for (const tenant of [tenantA, tenantB]) {
    await db('tenants').insert({
      tenant,
      client_name: `Xero historical ${tenant.slice(0, 8)}`,
      email: `xero-hist-${tenant.slice(0, 8)}@example.com`
    });
  }
});

afterAll(async () => {
  await db('tenant_external_entity_mappings').whereIn('tenant', [tenantA, tenantB]).del();
  await db('service_catalog').whereIn('tenant', [tenantA, tenantB]).del();
  await db('tenants').whereIn('tenant', [tenantA, tenantB]).del();
  await db.destroy().catch(() => undefined);
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db('tenant_external_entity_mappings').whereIn('tenant', [tenantA, tenantB]).del();
  await db('service_catalog').whereIn('tenant', [tenantA, tenantB]).del();
  connectionsState.value = {
    'conn-review': { connectionId: 'conn-review', xeroTenantId: 'org-review' },
    'conn-other': { connectionId: 'conn-other', xeroTenantId: 'org-other' }
  };
  xeroListItems.mockReset();
  xeroListItems.mockResolvedValue([
    { itemId: 'item-1', code: 'REVENUE', name: 'Revenue', status: 'ACTIVE' }
  ]);
  recordExternalPaymentMock.mockReset();
  recordExternalPaymentMock.mockResolvedValue({
    success: true,
    paymentRecorded: true,
    paymentId: randomUUID()
  });
  reverseExternalPaymentMock.mockReset();
  reverseExternalPaymentMock.mockResolvedValue({ success: true });
});

async function ensureServiceType(tenant: string): Promise<string> {
  const existing = await db('service_types').where({ tenant, name: 'Fixed Service Type' }).first('id');
  if (existing?.id) {
    return existing.id;
  }
  const id = randomUUID();
  await db('service_types').insert({ id, tenant, name: 'Fixed Service Type' });
  return id;
}

async function seedService(tenant: string): Promise<string> {
  const serviceId = randomUUID();
  const serviceTypeId = await ensureServiceType(tenant);
  await db('service_catalog').insert({
    tenant,
    service_id: serviceId,
    service_name: 'Managed Endpoint',
    billing_method: 'fixed',
    default_rate: 5000,
    custom_service_type_id: serviceTypeId
  });
  return serviceId;
}

async function seedMapping(overrides: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await db('tenant_external_entity_mappings').insert({
    id,
    tenant: tenantA,
    integration_type: 'xero',
    alga_entity_type: 'service',
    alga_entity_id: randomUUID(),
    external_entity_id: 'REVENUE',
    external_realm_id: 'conn-review',
    sync_status: 'manual_link',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides
  });
  return id;
}

describe('Xero historical mapping identity (DB-backed)', () => {
  it('shows an organisation-keyed mapping through the canonical connection read and resolves it for export', async () => {
    const serviceId = await seedService(tenantA);
    await seedMapping({ alga_entity_id: serviceId, external_realm_id: 'org-review' });

    const currentView = await (getExternalEntityMappings as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      {
        integrationType: 'xero',
        algaEntityType: 'service',
        algaEntityId: serviceId,
        externalRealmId: 'conn-review'
      }
    );
    expect(currentView).toHaveLength(1);
    expect(currentView[0].external_realm_id).toBe('org-review');

    const resolver = new AccountingMappingResolver(db, undefined, tenantA);
    expect(
      await resolver.resolveServiceMapping({ adapterType: 'xero', serviceId, targetRealm: 'conn-review' })
    ).toMatchObject({ external_entity_id: 'REVENUE' });
  });

  it('never exposes another organisation or tenant through the alias', async () => {
    const serviceA = await seedService(tenantA);
    await seedMapping({ alga_entity_id: serviceA, external_realm_id: 'org-other' });
    await seedMapping({ tenant: tenantB, alga_entity_id: serviceA, external_realm_id: 'org-review' });

    const read = await (getExternalEntityMappings as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      {
        integrationType: 'xero',
        algaEntityType: 'service',
        algaEntityId: serviceA,
        externalRealmId: 'conn-review'
      }
    );
    expect(read).toHaveLength(0);
  });

  it('creates through the UI action, resolves for export, and reconciles an inbound payment', async () => {
    const serviceId = await seedService(tenantA);

    const created = await (createExternalEntityMapping as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId,
        external_entity_id: 'REVENUE',
        external_realm_id: 'conn-review',
        metadata: { xeroTargetKind: 'item' }
      }
    );
    expect(created.external_realm_id).toBe('conn-review');
    expect(created.sync_status).toBe('manual_link');

    const resolver = new AccountingMappingResolver(db, undefined, tenantA);
    expect(
      await resolver.resolveServiceMapping({ adapterType: 'xero', serviceId, targetRealm: 'conn-review' })
    ).toMatchObject({ external_entity_id: 'REVENUE' });

    // The export writes the invoice mapping; inbound reconciliation applies a
    // payment against it through the same ledger.
    const invoiceId = randomUUID();
    const invoiceExternalId = 'xero-inv-uimap';
    await new KnexInvoiceMappingRepository(db).upsertInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'xero',
      invoiceId,
      externalInvoiceId: invoiceExternalId,
      targetRealm: 'conn-review'
    });

    await applyExternalPaymentChange(
      {
        knex: db,
        tenantId: tenantA,
        adapterType: 'xero',
        targetRealm: 'conn-review',
        ledger: new SyncMappingLedger(db, tenantA, 'xero'),
        exceptions: makeExceptions(),
        stats: makeStats()
      } as any,
      {
        entityType: 'Payment',
        externalId: 'xero-pay-ui',
        syncToken: 'tok-ui',
        deleted: false,
        normalized: {
          reference: 'UI-MAP',
          totalCents: 5000,
          allocations: [{ externalInvoiceId: invoiceExternalId, amountCents: 5000 }],
          isCreditApplication: false,
          providerMetadata: { xero_status: 'AUTHORISED' }
        }
      } as any
    );

    expect(recordExternalPaymentMock).toHaveBeenCalledTimes(1);
    const paymentMapping = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA, integration_type: 'xero', alga_entity_type: 'invoice_payment' })
      .first();
    expect(paymentMapping.external_realm_id).toBe('conn-review');
  });

  it('deleting the canonical mapping tombstones the hidden organisation-keyed sibling', async () => {
    const serviceId = await seedService(tenantA);
    const canonicalId = await seedMapping({
      alga_entity_id: serviceId,
      external_realm_id: 'conn-review',
      external_entity_id: 'REVENUE'
    });
    await seedMapping({
      alga_entity_id: serviceId,
      external_realm_id: 'org-review',
      external_entity_id: 'STALE'
    });

    const result = await (deleteExternalEntityMapping as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      canonicalId
    );
    expect(result).toEqual({ success: true });

    const live = await db('tenant_external_entity_mappings')
      .where({
        tenant: tenantA,
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId
      })
      .whereNull('deleted_at');
    expect(live).toHaveLength(0);

    const resolver = new AccountingMappingResolver(db, undefined, tenantA);
    expect(
      await resolver.resolveServiceMapping({ adapterType: 'xero', serviceId, targetRealm: 'conn-review' })
    ).toBeNull();
  });

  it('rejects a second live mapping for the same entity under the historical alias', async () => {
    const serviceId = await seedService(tenantA);
    await seedMapping({ alga_entity_id: serviceId, external_realm_id: 'org-review' });

    const created = await (createExternalEntityMapping as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId,
        external_entity_id: 'REVENUE',
        external_realm_id: 'conn-review',
        metadata: { xeroTargetKind: 'item' }
      }
    );

    expect(created.actionError).toContain('already exists');
    const live = await db('tenant_external_entity_mappings')
      .where({
        tenant: tenantA,
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId
      })
      .whereNull('deleted_at');
    expect(live).toHaveLength(1);
  });

  it('does not bypass alias conflict detection when a canonical tombstone exists', async () => {
    const serviceId = await seedService(tenantA);
    // Canonical representation unlinked earlier...
    await seedMapping({
      alga_entity_id: serviceId,
      external_realm_id: 'conn-review',
      deleted_at: db.fn.now(),
      sync_status: 'unlinked'
    });
    // ...while a live historical organisation-keyed representation remains.
    await seedMapping({
      alga_entity_id: serviceId,
      external_realm_id: 'org-review',
      external_entity_id: 'OLD'
    });

    const created = await (createExternalEntityMapping as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId,
        external_entity_id: 'REVENUE',
        external_realm_id: 'conn-review',
        metadata: { xeroTargetKind: 'item' }
      }
    );

    // The whole identity group is checked before relink/insert: two live
    // representations must never coexist.
    expect(created.actionError).toContain('already exists');
    const live = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA, alga_entity_type: 'service', alga_entity_id: serviceId })
      .whereNull('deleted_at');
    expect(live).toHaveLength(1);
    expect(live[0].external_realm_id).toBe('org-review');
  });

  it('recreates a mapping after both historical and canonical representations were deleted', async () => {
    const serviceId = await seedService(tenantA);
    await seedMapping({ alga_entity_id: serviceId, external_realm_id: 'org-review', external_entity_id: 'OLD' });
    const canonicalId = await seedMapping({ alga_entity_id: serviceId, external_realm_id: 'conn-review' });

    await (deleteExternalEntityMapping as any)({ user_id: 'u1' }, { tenant: tenantA }, canonicalId);

    const recreated = await (createExternalEntityMapping as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId,
        external_entity_id: 'REVENUE',
        external_realm_id: 'conn-review',
        metadata: { xeroTargetKind: 'item' }
      }
    );

    expect(recreated.actionError).toBeUndefined();
    expect(recreated.external_realm_id).toBe('conn-review');
    const live = await db('tenant_external_entity_mappings')
      .where({ tenant: tenantA, alga_entity_type: 'service', alga_entity_id: serviceId })
      .whereNull('deleted_at');
    expect(live).toHaveLength(1);
  });

  it("preserves another organisation's tombstones when creating for this organisation", async () => {
    const serviceId = await seedService(tenantA);
    const otherTombstoneId = await seedMapping({
      alga_entity_id: serviceId,
      external_realm_id: 'org-other',
      external_entity_id: 'OTHER',
      deleted_at: db.fn.now(),
      sync_status: 'unlinked'
    });

    const created = await (createExternalEntityMapping as any)(
      { user_id: 'u1' },
      { tenant: tenantA },
      {
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId,
        external_entity_id: 'REVENUE',
        external_realm_id: 'conn-review',
        metadata: { xeroTargetKind: 'item' }
      }
    );

    expect(created.actionError).toBeUndefined();
    expect(created.external_realm_id).toBe('conn-review');

    // The other organisation's tombstone is untouched, not relinked.
    const other = await db('tenant_external_entity_mappings').where({ id: otherTombstoneId }).first();
    expect(other.deleted_at).not.toBeNull();
    expect(other.external_realm_id).toBe('org-other');
    expect(other.external_entity_id).toBe('OTHER');
  });
});
