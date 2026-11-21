import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAllClientsMock = vi.hoisted(() => vi.fn());
const getClientByIdMock = vi.hoisted(() => vi.fn());
const getContactsByClientMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...args: any[]) => unknown) =>
    (...args: unknown[]) => fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: vi.fn(), tenantDb: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn().mockResolvedValue([]) }));
vi.mock('./board-actions', () => ({ getAllBoards: vi.fn().mockResolvedValue([{ board_id: 'b1' }]) }));
vi.mock('@alga-psa/reference-data/actions/priorityActions', () => ({
  getAllPriorities: vi.fn().mockResolvedValue([{ priority_id: 'p1' }]),
  getPrioritiesByBoardType: vi.fn(),
}));
vi.mock('./clientLookupActions', () => ({
  getAllClients: (...args: unknown[]) => getAllClientsMock(...args),
  getClientById: (...args: unknown[]) => getClientByIdMock(...args),
  getContactsByClient: (...args: unknown[]) => getContactsByClientMock(...args),
}));
vi.mock('../lib/clientPortalVisibility.server', () => ({ getClientContactVisibilityContext: vi.fn() }));

import { getTicketFormData } from './ticketFormActions';

describe('getTicketFormData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContactsByClientMock.mockResolvedValue([]);
  });

  it('never loads the tenant client list and returns no clients field', async () => {
    const result: any = await (getTicketFormData as any)();
    expect(getAllClientsMock).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('clients');
    expect(result.boards).toHaveLength(1);
  });

  it('loads only the prefilled client by id', async () => {
    getClientByIdMock.mockResolvedValue({ client_id: 'c1', client_name: 'Acme', client_type: 'company' });
    const result: any = await (getTicketFormData as any)('c1');
    expect(getAllClientsMock).not.toHaveBeenCalled();
    expect(getClientByIdMock).toHaveBeenCalledWith('c1');
    expect(result.selectedClient).toEqual({ client_id: 'c1', client_name: 'Acme', client_type: 'company' });
  });
});
