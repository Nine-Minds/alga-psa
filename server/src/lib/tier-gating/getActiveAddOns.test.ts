import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADD_ONS } from '@alga-psa/types';
import { getActiveAddOns } from './getActiveAddOns';

const createTenantKnex = vi.fn();

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnex(...args),
}));

describe('getActiveAddOns', () => {
  const select = vi.fn();
  const where = vi.fn();
  const knex = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    knex.mockReturnValue({ select });
    select.mockReturnValue({ where });
    createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-123' });
  });

  it('returns only non-expired add-ons from tenant_addons', async () => {
    where.mockResolvedValue([
      { addon_key: ADD_ONS.AI_ASSISTANT, expires_at: null },
      { addon_key: 'unknown_add_on', expires_at: null },
    ]);

    await expect(getActiveAddOns('tenant-123')).resolves.toEqual([ADD_ONS.AI_ASSISTANT]);
    expect(createTenantKnex).toHaveBeenCalledWith('tenant-123');
    expect(knex).toHaveBeenCalledWith('tenant_addons');
  });

  it('returns an empty array when no active add-ons exist', async () => {
    where.mockResolvedValue([]);

    await expect(getActiveAddOns('tenant-123')).resolves.toEqual([]);
  });

  it('excludes expired add-ons', async () => {
    where.mockResolvedValue([
      { addon_key: ADD_ONS.AI_ASSISTANT, expires_at: new Date(Date.now() - 60_000).toISOString() },
      { addon_key: ADD_ONS.AI_ASSISTANT, expires_at: new Date(Date.now() + 60_000).toISOString() },
    ]);

    await expect(getActiveAddOns('tenant-123')).resolves.toEqual([ADD_ONS.AI_ASSISTANT]);
  });
});
