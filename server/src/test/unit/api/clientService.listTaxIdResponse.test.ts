import { describe, expect, it, vi } from 'vitest';

const listRows = [{
  client_id: '11111111-1111-4111-8111-111111111111',
  client_name: 'Acme',
  tax_id_number: 'canonical',
  client_since: new Date(2021, 4, 17),
  properties: { tax_id: 'legacy', industry: 'IT' },
}];

function fakeQuery(result: unknown) {
  const query: any = {
    orderBy: () => query,
    limit: () => query,
    offset: () => query,
    select: () => query,
    count: () => Promise.resolve([{ count: '1' }]),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) =>
      callback({ raw: (sql: string) => sql }),
    tenantDb: () => ({
      table: () => fakeQuery(listRows),
      tenantJoin: () => undefined,
      tenantJoinFirstMatching: () => undefined,
    }),
  };
});

vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue('https://logo.example/acme.png'),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

describe('ClientService.list response rows', () => {
  it('keeps the canonical Tax ID, drops legacy properties.tax_id and returns client_since as a date string', async () => {
    const { ClientService } = await import('../../../lib/api/services/ClientService');
    const service = new ClientService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service as any, 'applyClientFilters').mockImplementation((query: unknown) => query);

    const result = await service.list({ page: 1, limit: 25 } as any, { tenant: 'tenant-1' } as any);

    expect(result.total).toBe(1);
    expect(result.data).toEqual([{
      client_id: '11111111-1111-4111-8111-111111111111',
      client_name: 'Acme',
      tax_id_number: 'canonical',
      client_since: '2021-05-17',
      properties: { industry: 'IT' },
      logoUrl: 'https://logo.example/acme.png',
    }]);
  });
});
