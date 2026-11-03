import { describe, expect, it, vi, beforeEach } from 'vitest';

const authorizeTicketRecordAccessMock = vi.hoisted(() => vi.fn());
const deleteEntityWithValidationMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/tickets/lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccessConcealed: (...args: unknown[]) => authorizeTicketRecordAccessMock(...args),
}));
vi.mock('@alga-psa/core/server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    deleteEntityWithValidation: (...args: unknown[]) => deleteEntityWithValidationMock(...args),
  };
});

import { TicketService } from '../../../lib/api/services/TicketService';

describe('TicketService.delete authorization', () => {
  const clientUser = {
    user_id: 'client-admin',
    user_type: 'client',
    clientId: 'client-1',
    contact_id: 'contact-1',
    roles: [{ role_id: 'client-admin-role' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authorizeTicketRecordAccessMock.mockResolvedValue({ ticket_id: 'retained-ticket-id' });
  });

  it('conceals a retained invisible ticket UUID before dependency validation', async () => {
    const service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: vi.fn() });
    authorizeTicketRecordAccessMock.mockRejectedValue(new Error('Permission denied: Cannot access ticket'));

    await expect(service.delete('retained-ticket-id', {
      tenant: 'tenant-1', userId: clientUser.user_id, user: clientUser,
    })).rejects.toThrow('Ticket not found');

    expect(deleteEntityWithValidationMock).not.toHaveBeenCalled();
  });

  it('rechecks authorization inside validation transaction before child cleanup', async () => {
    const service = new TicketService();
    const knex = vi.fn();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex });
    authorizeTicketRecordAccessMock
      .mockResolvedValueOnce({ ticket_id: 'retained-ticket-id' })
      .mockRejectedValueOnce(new Error('Permission denied: Cannot access ticket'));
    deleteEntityWithValidationMock.mockImplementation(
      async (_type: string, _id: string, _knex: unknown, tenant: string, performDelete: (trx: unknown, tenant: string) => Promise<void>) => {
        await performDelete(knex, tenant);
        return { deleted: true, canDelete: true, dependencies: [], alternatives: [] };
      },
    );

    await expect(service.delete('retained-ticket-id', {
      tenant: 'tenant-1', userId: clientUser.user_id, user: clientUser,
    })).rejects.toThrow('Ticket not found');

    expect(authorizeTicketRecordAccessMock).toHaveBeenCalledTimes(2);
  });
});
