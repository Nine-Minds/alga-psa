import { describe, expect, it, vi } from 'vitest';

import { createClientContractAssignment, updateClientContractAssignment } from '../clientContracts';

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

/**
 * A contract may also be re-pointed at another profile after the fact — the
 * screen an operator returns to once a client has been merged in. Re-pointing
 * moves every charge the contract produces, so the cross-client guard has to
 * hold on the edit path too, not only at creation.
 */

const existingAssignment = {
  client_contract_id: 'client-contract-1',
  tenant: 'tenant-1',
  client_id: 'client-1',
  contract_id: 'contract-1',
  start_date: '2026-09-01',
  end_date: null,
  is_active: true,
  billing_profile_id: null,
  renewal_ticket_board_id: null,
  renewal_ticket_status_id: null,
};

function createUpdateMockTransaction(
  profile: { client_id: string } | null,
  update: ReturnType<typeof vi.fn>,
) {
  const makeQuery = (table: string): any => {
    const query: any = {
      where: () => query,
      andWhere: () => query,
      join: () => query,
      leftJoin: () => query,
      select: () => query,
      orderBy: () => query,
      async first() {
        if (table === 'client_contracts') return { ...existingAssignment };
        if (table === 'client_billing_profiles') return profile;
        return null;
      },
      update(payload: Record<string, unknown>) {
        update(payload);
        return {
          async returning() {
            return [{ ...existingAssignment, ...payload }];
          },
        };
      },
    };
    return query;
  };

  return ((table: string) => makeQuery(table.split(/\s+as\s+/i)[0].trim())) as any;
}

describe('updateClientContractAssignment billing profile', () => {
  it('re-points the assignment at another profile of the same client', async () => {
    const update = vi.fn();
    const updated = await updateClientContractAssignment(
      createUpdateMockTransaction({ client_id: 'client-1' }, update),
      'tenant-1',
      'client-contract-1',
      { billing_profile_id: 'profile-merged' },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ billing_profile_id: 'profile-merged' }),
    );
    expect(updated.billing_profile_id).toBe('profile-merged');
  });

  it('rejects a profile that belongs to another client', async () => {
    const update = vi.fn();
    await expect(
      updateClientContractAssignment(
        createUpdateMockTransaction({ client_id: 'client-2' }, update),
        'tenant-1',
        'client-contract-1',
        { billing_profile_id: 'profile-elsewhere' },
      ),
    ).rejects.toThrow('That billing profile belongs to a different client.');
    expect(update).not.toHaveBeenCalled();
  });

  it('clears the assignment back to the client default', async () => {
    const update = vi.fn();
    await updateClientContractAssignment(
      createUpdateMockTransaction(null, update),
      'tenant-1',
      'client-contract-1',
      { billing_profile_id: null },
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ billing_profile_id: null }),
    );
  });
});
