import { describe, it, expect, vi, beforeEach } from 'vitest';

const createTicketWithRetryMock = vi.fn();
const createTenantKnexMock = vi.fn();
const hasPermissionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args)
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
  withTransaction: async (_knex: any, fn: any) => fn(mockTrx)
}));

vi.mock('@alga-psa/shared/models/ticketModel', () => ({
  TicketModel: {
    createTicketWithRetry: (...args: unknown[]) => createTicketWithRetryMock(...args)
  }
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn()
}));

const mockTrx = ((table: string) => {
  if (table === 'tickets') {
    return {
      where: () => ({
        first: async () => ({ ticket_id: 'ticket-1' })
      })
    };
  }
  if (table === 'priorities') {
    return {
      where: () => ({
        where: () => ({
          where: () => ({
            where: () => ({
              first: async () => null
            })
          })
        })
      })
    };
  }
  return {
    insert: async () => undefined
  };
}) as any;

import { addTicket } from '../ticketActions';

describe('addTicket estimated_hours parsing', () => {
  beforeEach(() => {
    hasPermissionMock.mockResolvedValue(true);
    createTicketWithRetryMock.mockResolvedValue({ ticket_id: 'ticket-1' });
    createTenantKnexMock.mockResolvedValue({
      knex: {
        transaction: async (fn: any) => fn(mockTrx)
      }
    });
  });

  it('parses estimated_hours from FormData', async () => {
    const data = new FormData();
    data.append('title', 'Test Ticket');
    data.append('description', 'Test');
    data.append('assigned_to', 'user-1');
    data.append('board_id', 'board-1');
    data.append('status_id', 'status-1');
    data.append('priority_id', 'priority-1');
    data.append('client_id', 'client-1');
    data.append('estimated_hours', '2.5');

    await addTicket({ user_id: 'user-1', tenant: 'tenant-1' } as any, { tenant: 'tenant-1' } as any, data);

    expect(createTicketWithRetryMock).toHaveBeenCalledWith(
      expect.objectContaining({ estimated_hours: 2.5 }),
      'tenant-1',
      mockTrx,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      'user-1',
      3
    );
  });

  it('does not error when estimated_hours is missing', async () => {
    const data = new FormData();
    data.append('title', 'Test Ticket');
    data.append('description', 'Test');
    data.append('assigned_to', 'user-1');
    data.append('board_id', 'board-1');
    data.append('status_id', 'status-1');
    data.append('priority_id', 'priority-1');
    data.append('client_id', 'client-1');

    await expect(
      addTicket({ user_id: 'user-1', tenant: 'tenant-1' } as any, { tenant: 'tenant-1' } as any, data)
    ).resolves.toBeDefined();

    expect(createTicketWithRetryMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ estimated_hours: expect.anything() }),
      'tenant-1',
      mockTrx,
      expect.any(Object),
      expect.any(Object),
      expect.any(Object),
      'user-1',
      3
    );
  });
});
