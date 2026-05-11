import { describe, expect, it, vi } from 'vitest';

import { lookupAlgaEntityByExternalId } from '@/lib/inboundWebhooks/externalEntityMappings';

function createLookupKnex(mapping: Record<string, unknown> | null) {
  const calls = {
    table: vi.fn(),
    where: vi.fn(),
    orderByRaw: vi.fn(),
    orderBy: vi.fn(),
    first: vi.fn(),
  };

  const query = {
    where: calls.where.mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    whereNull: vi.fn().mockReturnThis(),
    orderByRaw: calls.orderByRaw.mockReturnThis(),
    orderBy: calls.orderBy.mockReturnThis(),
    first: calls.first.mockResolvedValue(mapping),
  };

  const knex = Object.assign(
    calls.table.mockReturnValue(query),
    {
      fn: {
        now: vi.fn(() => 'now()'),
      },
    },
  );

  return { knex, query, calls };
}

describe('external entity mapping helpers', () => {
  it('T004: lookupAlgaEntityByExternalId scopes by tenant and webhook integration_type', async () => {
    const mapping = {
      id: 'mapping-1',
      tenant_id: 'tenant-1',
      integration_type: 'connectwise-alerts',
      alga_entity_type: 'ticket',
      alga_entity_id: 'ticket-1',
      external_entity_id: 'alert-123',
      external_realm_id: null,
      sync_status: 'synced',
      last_synced_at: null,
      metadata: null,
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    };
    const { knex, calls } = createLookupKnex(mapping);

    const result = await lookupAlgaEntityByExternalId(
      'tenant-1',
      'connectwise-alerts',
      'ticket',
      'alert-123',
      { knex: knex as any },
    );

    expect(calls.table).toHaveBeenCalledWith('tenant_external_entity_mappings');
    expect(calls.where).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      integration_type: 'connectwise-alerts',
      alga_entity_type: 'ticket',
      external_entity_id: 'alert-123',
    });
    expect(calls.orderByRaw).toHaveBeenCalledWith('external_realm_id IS NOT NULL ASC');
    expect(calls.orderBy).toHaveBeenCalledWith('updated_at', 'desc');
    expect(result).toEqual({
      algaEntityId: 'ticket-1',
      mapping,
    });
  });
});
