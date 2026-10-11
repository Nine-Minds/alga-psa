import { describe, expect, it, vi, type Mock } from 'vitest';

import { activateClientContractAssignment } from '../clientContracts';

/**
 * "Set to Active" used to flip only client_contracts.is_active. The contract header stayed
 * at status 'draft', the derived status kept rendering Draft, and the action looked like a
 * no-op (alga0002267). Activation has to move the header and the assignment together, while
 * still honouring the mixed-currency rule creation enforces.
 */

type PayloadMock = Mock<(payload: Record<string, unknown>) => void>;

type Scenario = {
  contract: Record<string, unknown>;
  assignment?: Record<string, unknown> | null;
  /** Other active assignments for the same client, as findMixedCurrencyActiveAssignment sees them. */
  otherActiveAssignments?: Array<Record<string, unknown>>;
};

const baseAssignment = {
  client_contract_id: 'client-contract-1',
  tenant: 'tenant-1',
  client_id: 'client-1',
  contract_id: 'contract-1',
  start_date: '2026-09-01',
  end_date: null,
  is_active: false,
  billing_profile_id: null,
  renewal_ticket_board_id: null,
  renewal_ticket_status_id: null,
};

function createMockTransaction(
  scenario: Scenario,
  spies: { updateContract: PayloadMock; updateAssignment: PayloadMock },
) {
  const assignment = scenario.assignment === undefined ? baseAssignment : scenario.assignment;

  const makeQuery = (table: string, isAliased: boolean): any => {
    // findMixedCurrencyActiveAssignment awaits the builder directly for a row list;
    // getClientContractById / the contracts lookup both end in .first().
    let selectingRows = false;

    const query: any = {
      where: () => query,
      andWhere: () => query,
      whereNot: () => query,
      join: () => query,
      leftJoin: () => query,
      orderBy: () => query,
      select(...args: unknown[]) {
        // The mixed-currency probe selects an object map; the readers select a column array.
        selectingRows = args.length === 1 && !Array.isArray(args[0]);
        return query;
      },
      then(onFulfilled: (rows: unknown) => unknown, onRejected?: (err: unknown) => unknown) {
        const rows = selectingRows ? scenario.otherActiveAssignments ?? [] : [];
        return Promise.resolve(rows).then(onFulfilled, onRejected);
      },
      async first() {
        if (table === 'client_contracts') return assignment ? { ...assignment } : null;
        if (table === 'contracts') return { ...scenario.contract };
        if (table === 'default_billing_settings') return null;
        return null;
      },
      update(payload: Record<string, unknown>) {
        if (table === 'contracts') spies.updateContract(payload);
        if (table === 'client_contracts') spies.updateAssignment(payload);
        return {
          async returning() {
            return assignment ? [{ ...assignment, ...payload }] : [];
          },
        };
      },
    };

    void isAliased;
    return query;
  };

  return ((table: string) => {
    const root = table.split(/\s+as\s+/i)[0].trim();
    return makeQuery(root, root !== table.trim());
  }) as any;
}

describe('activateClientContractAssignment', () => {
  it('promotes a draft contract header and its assignment to active', async () => {
    const updateContract: PayloadMock = vi.fn();
    const updateAssignment: PayloadMock = vi.fn();

    const activated = await activateClientContractAssignment(
      createMockTransaction(
        {
          contract: {
            contract_id: 'contract-1',
            status: 'draft',
            is_active: false,
            currency_code: 'USD',
            contract_name: 'Managed services agreement',
          },
        },
        { updateContract, updateAssignment },
      ),
      'tenant-1',
      'client-contract-1',
    );

    expect(updateContract).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', is_active: true }),
    );
    expect(updateAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true }),
    );
    expect(activated.is_active).toBe(true);
  });

  it('activates the assignment without touching an already-active header', async () => {
    const updateContract: PayloadMock = vi.fn();
    const updateAssignment: PayloadMock = vi.fn();

    await activateClientContractAssignment(
      createMockTransaction(
        {
          contract: {
            contract_id: 'contract-1',
            status: 'active',
            is_active: true,
            currency_code: 'USD',
            contract_name: 'Managed services agreement',
          },
        },
        { updateContract, updateAssignment },
      ),
      'tenant-1',
      'client-contract-1',
    );

    expect(updateContract).not.toHaveBeenCalled();
    expect(updateAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true }),
    );
  });

  it('rejects activating a draft that would give the client two active currencies', async () => {
    const updateContract: PayloadMock = vi.fn();
    const updateAssignment: PayloadMock = vi.fn();

    await expect(
      activateClientContractAssignment(
        createMockTransaction(
          {
            contract: {
              contract_id: 'contract-1',
              status: 'draft',
              is_active: false,
              currency_code: 'EUR',
              contract_name: 'Managed services agreement',
            },
            otherActiveAssignments: [
              {
                start_date: '2026-01-01',
                end_date: null,
                currency_code: 'USD',
                contract_name: 'Existing retainer',
              },
            ],
          },
          { updateContract, updateAssignment },
        ),
        'tenant-1',
        'client-contract-1',
      ),
    ).rejects.toThrow('Mixed-currency contracts for the same client are not supported.');

    expect(updateContract).not.toHaveBeenCalled();
    expect(updateAssignment).not.toHaveBeenCalled();
  });

  it('surfaces a missing assignment instead of silently succeeding', async () => {
    const updateContract: PayloadMock = vi.fn();
    const updateAssignment: PayloadMock = vi.fn();
    const missing = createMockTransaction(
      {
        contract: { contract_id: 'contract-1', status: 'draft', is_active: false },
        assignment: null,
      },
      { updateContract, updateAssignment },
    );

    await expect(
      activateClientContractAssignment(missing, 'tenant-1', 'client-contract-missing'),
    ).rejects.toThrow('Client contract client-contract-missing not found');
    expect(updateContract).not.toHaveBeenCalled();
  });
});
