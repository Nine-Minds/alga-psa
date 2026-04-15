import { describe, expect, it } from 'vitest';

import { createClientContractAssignment } from '../clientContracts';

function createMockQuery(
  table: string,
  initialFilters: Record<string, unknown>
) {
  let filters = { ...initialFilters };

  return {
    where(nextFilters: Record<string, unknown>) {
      filters = { ...filters, ...nextFilters };
      return this;
    },
    andWhere(nextFilters: Record<string, unknown>) {
      filters = { ...filters, ...nextFilters };
      return this;
    },
    async first() {
      if (table === 'clients') {
        return filters.client_id === 'client-1' ? { client_id: 'client-1', tenant: 'tenant-1' } : null;
      }

      if (table === 'contracts') {
        return filters.contract_id === 'contract-1' ? { contract_id: 'contract-1', tenant: 'tenant-1' } : null;
      }

      if (table === 'statuses') {
        return null;
      }

      return null;
    },
  };
}

function createMockTransaction() {
  return ((table: string) => ({
    where(filters: Record<string, unknown>) {
      return createMockQuery(table, filters);
    },
  })) as any;
}

describe('createClientContractAssignment board-scoped renewal ticket validation', () => {
  it('rejects renewal ticket statuses that do not belong to the selected board', async () => {
    await expect(
      createClientContractAssignment(createMockTransaction(), 'tenant-1', {
        client_id: 'client-1',
        contract_id: 'contract-1',
        start_date: '2026-03-14',
        end_date: null,
        is_active: false,
        renewal_ticket_board_id: 'board-2',
        renewal_ticket_status_id: 'status-1',
      })
    ).rejects.toThrow('Renewal ticket status must belong to the selected board');
  });
});
