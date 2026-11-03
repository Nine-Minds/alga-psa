import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ decision: { allowed: true, redactedFields: [] as string[] }, items: [] as Record<string, any>[], versions: [] as Record<string, any>[] }));
vi.mock('@/lib/api/controllers/authorizationKernel', () => ({ authorizeApiResourceRead: vi.fn(async () => state.decision) }));
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
      expect(body.data[0]).not.toHaveProperty('client_name');
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
});
