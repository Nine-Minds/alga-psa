import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const xeroCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XeroClientService: {
    create: xeroCreateMock
  }
}));

import {
  CompanyAccountingSyncService,
  KnexCompanyMappingRepository,
  XeroCompanyAdapter
} from '@alga-psa/billing/services';
import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

describe('Live Xero company sync integration', () => {
  let ctx: TestContext;
  let service: CompanyAccountingSyncService;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: ['tenant_external_entity_mappings']
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    vi.clearAllMocks();

    await ctx.db('tenant_external_entity_mappings').where({ tenant: ctx.tenantId }).del();

    service = CompanyAccountingSyncService.create({
      mappingRepository: new KnexCompanyMappingRepository(ctx.db),
      adapterFactory: (adapterType) => (adapterType === 'xero' ? new XeroCompanyAdapter() : null)
    });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  it('T019: DB-backed company sync resolves the default Xero connection and persists the mapped contact', async () => {
    xeroCreateMock.mockResolvedValue({
      findContactByName: vi.fn(async () => null),
      createOrUpdateContact: vi.fn(async () => ({
        externalId: 'CONTACT-001',
        displayName: 'Acme Holdings',
        raw: { contactId: 'CONTACT-001', name: 'Acme Holdings' }
      }))
    });

    const result = await service.ensureCompanyMapping({
      tenantId: ctx.tenantId,
      adapterType: 'xero',
      companyId: ctx.clientId,
      payload: {
        companyId: ctx.clientId,
        name: 'Acme Holdings',
        primaryEmail: 'billing@acme.test'
      },
      targetRealm: null
    });

    expect(result).toEqual({
      externalCompanyId: 'CONTACT-001',
      metadata: { contactId: 'CONTACT-001', name: 'Acme Holdings' }
    });
    expect(xeroCreateMock).toHaveBeenCalledWith(ctx.tenantId, null);

    const mapping = await ctx.db('tenant_external_entity_mappings')
      .where({
        tenant: ctx.tenantId,
        integration_type: 'xero',
        alga_entity_type: 'client',
        alga_entity_id: ctx.clientId
      })
      .first();

    expect(mapping.external_entity_id).toBe('CONTACT-001');
    expect(mapping.external_realm_id).toBeNull();
    expect(mapping.metadata).toEqual({ contactId: 'CONTACT-001', name: 'Acme Holdings' });
  }, HOOK_TIMEOUT);
});
