import { beforeEach, describe, expect, it, vi } from 'vitest';

const existingClient = {
  client_id: '11111111-1111-4111-8111-111111111111',
  client_name: 'Acme',
  url: 'https://acme.example',
  tax_id_number: null,
  is_inactive: false,
  properties: { industry: 'IT', website: 'https://acme.example', defaultLocale: 'en' },
};

const updates: Array<Record<string, unknown>> = [];

function fakeClientsQuery() {
  const query: any = {
    where: () => query,
    first: () => Promise.resolve(existingClient),
    update: (data: Record<string, unknown>) => {
      updates.push(data);
      return { returning: () => Promise.resolve([{ ...existingClient, ...data }]) };
    },
  };
  return query;
}

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => callback({}),
    tenantDb: () => ({ table: () => fakeClientsQuery() }),
  };
});

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishWorkflowEvent: vi.fn().mockResolvedValue(undefined),
}));

async function updateClient(data: Record<string, unknown>) {
  const { ClientService } = await import('../../../lib/api/services/ClientService');
  const service = new ClientService();
  vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: { raw: (sql: string) => sql } });
  return service.update(existingClient.client_id, data as any, { tenant: 'tenant-1' } as any);
}

describe('ClientService.update properties', () => {
  beforeEach(() => {
    updates.length = 0;
  });

  it('merges provided properties into the existing JSONB properties', async () => {
    const result = await updateClient({ properties: { defaultLocale: 'fr' } });

    expect(updates).toHaveLength(1);
    expect(updates[0].properties).toEqual({
      industry: 'IT',
      website: 'https://acme.example',
      defaultLocale: 'fr',
    });
    expect(result.properties).toEqual({ industry: 'IT', website: 'https://acme.example', defaultLocale: 'fr' });
  });

  it('merges properties even when a legacy properties.tax_id is moved to tax_id_number', async () => {
    await updateClient({ properties: { defaultLocale: 'fr', tax_id: ' 12-345 ' } });

    expect(updates[0].tax_id_number).toBe('12-345');
    expect(updates[0].properties).toEqual({
      industry: 'IT',
      website: 'https://acme.example',
      defaultLocale: 'fr',
    });
  });

  it('leaves stored properties untouched when properties are omitted', async () => {
    await updateClient({ client_name: 'Acme Renamed' });

    expect(updates[0]).not.toHaveProperty('properties');
    expect(updates[0].client_name).toBe('Acme Renamed');
  });
});
