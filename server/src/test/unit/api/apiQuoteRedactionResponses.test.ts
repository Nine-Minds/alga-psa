import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ decision: { allowed: true, redactedFields: [] as string[] }, items: [] as Record<string, any>[], versions: [] as Record<string, any>[] }));
const authorizeResource = vi.hoisted(() => vi.fn(async () => state.decision));
vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({ authorizeResource, authorizeMutation: vi.fn(async () => ({ allowed: true })) })),
}));
vi.mock('@alga-psa/authorization/subject', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/authorization/subject')>()),
  resolveAuthorizationSubject: vi.fn(async (_knex: unknown, input: any) => ({
    tenant: input.tenant, userId: input.user?.user_id ?? '', userType: 'internal',
    roleIds: [], teamIds: [], managedUserIds: [], portfolioClientIds: [],
    ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
  })),
}));
vi.mock('@/lib/db', () => ({ runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/services/QuoteService', () => ({ QuoteService: class {} }));

import { ApiQuoteController } from '@/lib/api/controllers/ApiQuoteController';
const request = () => new NextRequest('http://localhost/api/v1/quotes/q1/items');
function controller() {
  const instance = new ApiQuoteController() as any;
  instance.authenticate = async () => ({ context: { tenant: 'tenant-1', user: { user_id: 'u1' }, apiKeyId: 'key' } });
  instance.checkPermission = async () => undefined;
  instance.extractIdFromPath = async () => 'q1';
  instance.quoteService = {
    getById: async () => ({ quote_id: 'q1', quote_number: 'Q-1', client_id: 'c1', client_name: 'Secret client' }),
    listItems: async () => state.items,
    listVersions: async () => state.versions,
    getConversionPreview: async () => ({
      quote_id: 'q1',
      available_actions: ['contract'],
      contract_items: [{ description: 'Confidential service', unit_price: 500 }],
      contract_discounts: [{ amount: 10 }],
      contract_monthly_before_discounts: 500,
      contract_monthly_total: 490,
      contract_blocked_item_description: 'Confidential service',
      invoice_items: [],
      sales_order_items: [],
      excluded_items: [],
    }),
  };
  return instance;
}
beforeEach(() => {
  state.decision = { allowed: true, redactedFields: ['quotes.client_name'] };
  state.items = [{ quote_id: 'q1', item_id: 'i1', description: 'Line', client_name: 'Secret client' }];
  state.versions = [{ quote_id: 'q1', version: 2, quote_number: 'Q-1', client_name: 'Secret client' }];
});

describe('quote child read responses', () => {
  it('projects list items and versions through the parent quote decision', async () => {
    const instance = controller();
    for (const response of [await instance.listItems()(request()), await instance.listVersions()(request())]) {
      const body = await response.json();
      expect(body.data[0].client_name).toBeNull();
      expect(body.data[0]).toHaveProperty('quote_id', 'q1');
    }
  });

  it('suppresses item output when the parent hides quote items or its identifier', async () => {
    state.decision = { allowed: true, redactedFields: ['quotes.quote_items'] };
    const items = await controller().listItems()(request());
    expect((await items.json()).data).toEqual([]);
    state.decision = { allowed: true, redactedFields: ['values.quote_id'] };
    const versions = await controller().listVersions()(request());
    expect(versions.status).toBe(404);
  });

  it('suppresses quote-derived preview lines when the quote item resource is hidden', async () => {
    state.decision = { allowed: true, redactedFields: ['quote_items'] };
    const response = await controller().conversionPreview()(request());
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.contract_items).toEqual([]);
    expect(data.contract_discounts).toEqual([]);
    expect(data.contract_monthly_total).toBeNull();
    expect(JSON.stringify(data)).not.toContain('Confidential service');
  });

  it('projects alternate preview lines under quote_items.description redactions', async () => {
    state.decision = { allowed: true, redactedFields: ['quotes.quote_items.description'] };
    const response = await controller().conversionPreview()(request());
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.contract_items[0]).not.toHaveProperty('description');
    expect(data.contract_blocked_item_description).toBeNull();
    expect(data.contract_monthly_total).toBe(490);
    expect(JSON.stringify(data)).not.toContain('Confidential service');
  });

  it('nulls preview calculations that depend on hidden unit prices', async () => {
    state.decision = { allowed: true, redactedFields: ['values.unit_price'] };
    const response = await controller().conversionPreview()(request());
    expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.contract_items[0]).not.toHaveProperty('unit_price');
    expect(data.contract_discounts[0].amount).toBeNull();
    expect(data.contract_monthly_before_discounts).toBeNull();
    expect(data.contract_monthly_total).toBeNull();
  });

  it('preserves unrestricted conversion previews', async () => {
    state.decision = { allowed: true, redactedFields: [] };
    const response = await controller().conversionPreview()(request());
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      contract_items: [{ description: 'Confidential service', unit_price: 500 }],
      contract_monthly_total: 490,
    });
  });
});

describe('quote create response', () => {
  const createRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost/api/v1/quotes', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const createdQuote = { quote_id: 'q-new', quote_number: 'Q-9', client_id: 'c1', client_name: 'Secret client', status: 'draft', created_by: 'u1' };
  function creatingController(onCreate: (data: any) => void = () => undefined) {
    const instance = controller();
    instance.runWithApiKeyContext = async (_req: unknown, callback: () => Promise<any>) => callback();
    instance.quoteService.create = async (data: any) => { onCreate(data); return { ...createdQuote }; };
    return instance;
  }

  it('projects the created quote through the caller\'s read decision', async () => {
    authorizeResource.mockClear();
    let persisted: any;
    const response = await creatingController((data) => { persisted = data; })
      .create()(createRequest({ client_id: '00000000-0000-4000-8000-000000000001', title: 'New', quote_date: '2026-11-14', valid_until: '2026-12-14', notes: 'n', terms: 't' }));
    expect(response.status).toBe(201);
    const data = (await response.json()).data;
    expect(data).toHaveProperty('quote_id', 'q-new');
    expect(data.client_name).toBeNull();
    expect(authorizeResource).toHaveBeenCalledWith(expect.objectContaining({ resource: { type: 'billing', action: 'read' } }));
    expect(persisted).toMatchObject({ internal_notes: 'n', terms_and_conditions: 't' });
  });

  it('answers 201 with no record when the read decision denies the created quote', async () => {
    state.decision = { allowed: false, redactedFields: [] };
    const response = await creatingController()
      .create()(createRequest({ client_id: '00000000-0000-4000-8000-000000000001', title: 'New', quote_date: '2026-11-14', valid_until: '2026-12-14' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toBeNull();
    expect(JSON.stringify(body)).not.toContain('Secret client');
  });
});
