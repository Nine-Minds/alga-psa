import { describe, expect, it, vi } from 'vitest';

import { clientIndexer } from '../../lib/search/indexers/client';

function createFirstRowKnex(row: unknown) {
  const queryBuilder = {
    select: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(row),
  };
  const knex = vi.fn().mockReturnValue(queryBuilder);
  return { knex, queryBuilder };
}

describe('search entity indexers', () => {
  it('T027 client loadOne maps client fields into a SearchDoc', async () => {
    const { knex, queryBuilder } = createFirstRowKnex({
      client_id: 'client-1',
      client_name: 'ACME Corp',
      email: 'support@acme.example',
      phone_no: '555-0100',
      notes: 'Managed firewall customer',
      created_at: '2026-05-12T10:00:00.000Z',
      updated_at: '2026-05-13T10:00:00.000Z',
    });

    const doc = await clientIndexer.loadOne(
      knex as never,
      '11111111-1111-4111-8111-111111111111',
      'client-1',
    );

    expect(knex).toHaveBeenCalledWith('clients');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'tenant',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('client_id', 'client-1');
    expect(doc).toMatchObject({
      tenant: '11111111-1111-4111-8111-111111111111',
      objectType: 'client',
      objectId: 'client-1',
      title: 'ACME Corp',
      subtitle: 'support@acme.example | 555-0100',
      body: 'Managed firewall customer',
      url: '/msp/clients/client-1',
      acl: { requiredPermission: 'client:read' },
    });
    expect(doc?.sourceUpdatedAt.toISOString()).toBe('2026-05-13T10:00:00.000Z');
  });
});
