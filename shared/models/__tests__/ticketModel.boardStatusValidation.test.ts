import { describe, expect, it, vi } from 'vitest';
import { TicketModel } from '../ticketModel';

type StatusRow = {
  tenant: string;
  status_id: string;
  status_type: string;
  board_id: string | null;
  is_default?: boolean;
  order_number?: number;
};

function createStatusesTrx(statusRows: StatusRow[]) {
  const trx: any = vi.fn((table: string) => {
    if (table !== 'statuses') {
      throw new Error(`Unexpected table in board-status validation test: ${table}`);
    }

    let rows = [...statusRows];

    const builder: any = {
      where(criteria: Record<string, unknown>) {
        rows = rows.filter((row) =>
          Object.entries(criteria).every(([key, value]) => (row as Record<string, unknown>)[key] === value)
        );
        return builder;
      },
      orderBy(column: string, direction: 'asc' | 'desc' = 'asc') {
        rows = [...rows].sort((left, right) => {
          const leftValue = (left as Record<string, unknown>)[column];
          const rightValue = (right as Record<string, unknown>)[column];
          if (leftValue === rightValue) {
            return 0;
          }
          if (leftValue == null) {
            return 1;
          }
          if (rightValue == null) {
            return -1;
          }
          if (leftValue < rightValue) {
            return direction === 'asc' ? -1 : 1;
          }
          return direction === 'asc' ? 1 : -1;
        });
        return builder;
      },
      first: vi.fn(async () => rows[0] ?? null),
    };

    return builder;
  });

  return trx;
}

describe('TicketModel board-scoped status helpers', () => {
  it('T012: getDefaultStatusId returns the default status for the selected board instead of a tenant-global ticket status', async () => {
    const trx = createStatusesTrx([
      {
        tenant: 'tenant-1',
        status_id: 'legacy-global-default',
        status_type: 'ticket',
        board_id: null,
        is_default: true,
        order_number: 1,
      },
      {
        tenant: 'tenant-1',
        status_id: 'board-a-open',
        status_type: 'ticket',
        board_id: 'board-a',
        is_default: true,
        order_number: 10,
      },
      {
        tenant: 'tenant-1',
        status_id: 'board-b-open',
        status_type: 'ticket',
        board_id: 'board-b',
        is_default: true,
        order_number: 10,
      },
    ]);

    const statusId = await TicketModel.getDefaultStatusId('tenant-1', trx, 'board-b');

    expect(statusId).toBe('board-b-open');
  });

  it('T013: validateBusinessRules rejects a ticket status that belongs to a different board', async () => {
    const trx = createStatusesTrx([
      {
        tenant: 'tenant-1',
        status_id: 'board-a-open',
        status_type: 'ticket',
        board_id: 'board-a',
        is_default: true,
        order_number: 10,
      },
    ]);

    const result = await TicketModel.validateBusinessRules(
      {
        title: 'Cross-board status',
        board_id: 'board-b',
        status_id: 'board-a-open',
      },
      'tenant-1',
      trx
    );

    expect(result.valid).toBe(false);
    expect(result.error).toContain('selected status does not belong to the selected board');
  });
});
