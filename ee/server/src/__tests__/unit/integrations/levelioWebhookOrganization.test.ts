import { describe, expect, it, vi } from 'vitest';
import { resolveLevelIoWebhookOrganization } from '../../../lib/integrations/levelio/webhookAlertOrganization';
import type { LevelIoApiClient } from '../../../lib/integrations/levelio/levelApiClient';

/**
 * Knex stub that answers every tenant query from a per-table row bag. Mirrors
 * the pattern used by the sync-engine unit tests: `tenantDb(...).table(...)`
 * funnels through `conn(table).where(...)`, and this stub's builder treats
 * every chained clause as a no-op before resolving rows.
 */
function createKnexStub(rowsByTable: Record<string, any[]>) {
  const knex: any = (table: string) => {
    const rows = rowsByTable[table] ?? [];
    const builder: any = {
      where: () => builder,
      whereNotNull: () => builder,
      andWhere: () => builder,
      select: async () => rows,
      first: async () => rows[0],
    };
    return builder;
  };
  return knex;
}

function stubClient(overrides: Partial<Record<'getDevice' | 'listGroups', any>> = {}) {
  return {
    getDevice: overrides.getDevice ?? vi.fn(async () => ({ id: 'dev-1', group_id: 'g-sub' })),
    listGroups: overrides.listGroups ?? vi.fn(async () => [
      { id: 'g-root', parent_id: null, name: 'Acme Corp' },
      { id: 'g-mid', parent_id: 'g-root', name: 'Branch' },
      { id: 'g-sub', parent_id: 'g-mid', name: 'Site' },
    ]),
  } as unknown as LevelIoApiClient;
}

const ARGS = { tenant: 'tenant-1', integrationId: 'int-1', deviceId: 'dev-1' };

describe('resolveLevelIoWebhookOrganization', () => {
  it('(a) prefers an explicit body.group_id and never touches the client or DB', async () => {
    const knex = createKnexStub({});
    const createClient = vi.fn(stubClient);
    const result = await resolveLevelIoWebhookOrganization(
      { knex, createClient },
      { ...ARGS, explicitGroupId: 'g-explicit' }
    );

    expect(result).toBe('g-explicit');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('(b) falls back to the passed device mapping external_realm_id when no group_id', async () => {
    const knex = createKnexStub({});
    const createClient = vi.fn(stubClient);
    const result = await resolveLevelIoWebhookOrganization(
      { knex, deviceMapping: { external_realm_id: 'g-mapped' }, createClient },
      ARGS
    );

    expect(result).toBe('g-mapped');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('(b) reads the canonicalized realm from the device mapping row when none is passed', async () => {
    const knex = createKnexStub({
      tenant_external_entity_mappings: [{ external_realm_id: 'g-mapped' }],
    });
    const createClient = vi.fn(stubClient);
    const result = await resolveLevelIoWebhookOrganization({ knex, createClient }, ARGS);

    expect(result).toBe('g-mapped');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('(c) resolves the deepest mapped ancestor via the Level hierarchy when no realm exists', async () => {
    const knex = createKnexStub({
      tenant_external_entity_mappings: [],
      rmm_organization_mappings: [
        { external_organization_id: 'g-root' },
        { external_organization_id: 'g-mid' },
      ],
    });
    const client = stubClient();
    const createClient = vi.fn(async () => client);

    const result = await resolveLevelIoWebhookOrganization({ knex, createClient }, ARGS);

    // Device lives in g-sub; both g-root and g-mid are mapped, so the deepest
    // (g-mid) wins — mirroring the sync engine's scoping.
    expect(result).toBe('g-mid');
    expect(client.getDevice).toHaveBeenCalledWith('dev-1');
  });

  it('(d) unknown device with no mapped group ancestors resolves to null', async () => {
    const knex = createKnexStub({
      tenant_external_entity_mappings: [],
      rmm_organization_mappings: [{ external_organization_id: 'g-unrelated' }],
    });
    const client = stubClient({ getDevice: vi.fn(async () => ({ id: 'dev-x', group_id: 'g-other' })) });
    const createClient = vi.fn(async () => client);

    const result = await resolveLevelIoWebhookOrganization({ knex, createClient }, {
      ...ARGS,
      deviceId: 'dev-x',
    });

    expect(result).toBeNull();
  });

  it('(d) returns null when no mapping exists and no client factory is configured', async () => {
    const knex = createKnexStub({ tenant_external_entity_mappings: [] });
    const result = await resolveLevelIoWebhookOrganization({ knex }, ARGS);
    expect(result).toBeNull();
  });

  it('(d) a failed client creation resolves to null instead of throwing', async () => {
    const knex = createKnexStub({ tenant_external_entity_mappings: [] });
    const createClient = vi.fn(async () => {
      throw new Error('Level API key is not configured for this tenant.');
    });
    const result = await resolveLevelIoWebhookOrganization({ knex, createClient }, ARGS);
    expect(result).toBeNull();
  });

  it('(d) a failed Level lookup (network/metadata) resolves to null instead of throwing', async () => {
    const knex = createKnexStub({ tenant_external_entity_mappings: [] });
    const client = stubClient({ getDevice: vi.fn(async () => {
      throw new Error('Level API request failed with status 500');
    }) });
    const createClient = vi.fn(async () => client);
    const result = await resolveLevelIoWebhookOrganization({ knex, createClient }, ARGS);
    expect(result).toBeNull();
  });
});
