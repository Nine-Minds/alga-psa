import { describe, expect, it, vi } from 'vitest';

import { createClientContractAssignment } from '../clientContracts';

/**
 * A contract picks its billing profile when it is created, not in a later edit:
 * every charge it produces is attributed through it (step 3 of the chain), so a
 * profile belonging to a different client must be rejected outright.
 */

type Rows = { profile?: { client_id: string } | null };

function createMockQuery(table: string, initialFilters: Record<string, unknown>, rows: Rows, insert: ReturnType<typeof vi.fn>) {
  let filters = { ...initialFilters };

  const query: any = {
    where(nextFilters: Record<string, unknown>) {
      filters = { ...filters, ...nextFilters };
      return query;
    },
    andWhere(nextFilters: Record<string, unknown>) {
      filters = { ...filters, ...nextFilters };
      return query;
    },
    async first() {
      if (table === 'clients') {
        return filters.client_id === 'client-1' ? { client_id: 'client-1', tenant: 'tenant-1' } : null;
      }
      if (table === 'contracts') {
        return filters.contract_id === 'contract-1'
          ? { contract_id: 'contract-1', tenant: 'tenant-1', currency_code: 'USD' }
          : null;
      }
      if (table === 'client_billing_profiles') {
        return rows.profile ?? null;
      }
      return null;
    },
    insert(payload: Record<string, unknown>) {
      insert(payload);
      return {
        async returning() {
          return [{ ...payload }];
        },
      };
    },
  };

  return query;
}

function createMockTransaction(rows: Rows, insert: ReturnType<typeof vi.fn>) {
  return ((table: string) => ({
    where(filters: Record<string, unknown>) {
      return createMockQuery(table, filters, rows, insert);
    },
  })) as any;
}

const baseInput = {
  client_id: 'client-1',
  contract_id: 'contract-1',
  start_date: '2026-09-01',
  end_date: null,
  is_active: false,
};

describe('createClientContractAssignment billing profile', () => {
  it('stores the chosen profile on the assignment', async () => {
    const insert = vi.fn();
    const created = await createClientContractAssignment(
      createMockTransaction({ profile: { client_id: 'client-1' } }, insert),
      'tenant-1',
      { ...baseInput, billing_profile_id: 'profile-merged' },
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ billing_profile_id: 'profile-merged' }),
    );
    expect(created.billing_profile_id).toBe('profile-merged');
  });

  it('rejects a profile that belongs to another client', async () => {
    const insert = vi.fn();
    await expect(
      createClientContractAssignment(
        createMockTransaction({ profile: { client_id: 'client-2' } }, insert),
        'tenant-1',
        { ...baseInput, billing_profile_id: 'profile-elsewhere' },
      ),
    ).rejects.toThrow('That billing profile belongs to a different client.');
    expect(insert).not.toHaveBeenCalled();
  });

  it('leaves the assignment unattributed when no profile is chosen', async () => {
    const insert = vi.fn();
    await createClientContractAssignment(
      createMockTransaction({ profile: null }, insert),
      'tenant-1',
      baseInput,
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ billing_profile_id: null }),
    );
  });
});
