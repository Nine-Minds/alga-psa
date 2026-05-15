import { describe, expect, it, vi } from 'vitest';

import { lookupAlgaEntityByExternalId, writeEntityMapping } from '@alga-psa/shared/inboundWebhooks/externalEntityMappings';

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

function createWriteKnex(existingMapping: Record<string, unknown> | null, writtenMapping: Record<string, unknown>) {
  const lookupQuery = {
    where: vi.fn().mockReturnThis(),
    modify: vi.fn((callback: (query: any) => void) => {
      callback(lookupQuery);
      return lookupQuery;
    }),
    whereNull: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(existingMapping),
  };
  const insertQuery = {
    insert: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([writtenMapping]),
  };
  const table = vi.fn()
    .mockReturnValueOnce(lookupQuery)
    .mockReturnValueOnce(insertQuery);
  const knex = Object.assign(table, {
    fn: {
      now: vi.fn(() => 'now()'),
    },
  });

  return { knex, lookupQuery, insertQuery };
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

  it('T004a: writeEntityMapping upserts on tenant integration entity and Alga id, with duplicate same mapping idempotent', async () => {
    const existingMapping = {
      tenant_id: 'tenant-1',
      integration_type: 'connectwise-alerts',
      alga_entity_type: 'ticket',
      alga_entity_id: 'ticket-1',
      external_entity_id: 'alert-123',
      external_realm_id: null,
    };
    const writtenMapping = {
      ...existingMapping,
      id: 'mapping-1',
      sync_status: 'synced',
      metadata: { source: 'unit-test' },
      last_synced_at: 'now()',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    };
    const { knex, lookupQuery, insertQuery } = createWriteKnex(existingMapping, writtenMapping);

    const result = await writeEntityMapping(
      'tenant-1',
      'connectwise-alerts',
      'ticket',
      'ticket-1',
      'alert-123',
      { knex: knex as any, metadata: { source: 'unit-test' } },
    );

    expect(lookupQuery.where).toHaveBeenCalledWith({
      tenant_id: 'tenant-1',
      integration_type: 'connectwise-alerts',
      external_entity_id: 'alert-123',
    });
    expect(lookupQuery.whereNull).toHaveBeenCalledWith('external_realm_id');
    expect(insertQuery.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-1',
        integration_type: 'connectwise-alerts',
        alga_entity_type: 'ticket',
        alga_entity_id: 'ticket-1',
        external_entity_id: 'alert-123',
        external_realm_id: null,
        sync_status: 'synced',
        metadata: { source: 'unit-test' },
      }),
    );
    expect(insertQuery.onConflict).toHaveBeenCalledWith([
      'tenant_id',
      'integration_type',
      'alga_entity_type',
      'alga_entity_id',
    ]);
    expect(insertQuery.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        external_entity_id: 'alert-123',
        external_realm_id: null,
        sync_status: 'synced',
        metadata: { source: 'unit-test' },
      }),
    );
    expect(result).toBe(writtenMapping);
  });
});
