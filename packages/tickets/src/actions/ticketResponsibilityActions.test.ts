import { beforeEach, describe, expect, it, vi } from 'vitest';

const readable = vi.hoisted(() => vi.fn());
const handToClientIt = vi.hoisted(() => vi.fn());
const load = vi.hoisted(() => vi.fn());
const hasPermission = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: 't' }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/authorization/kernel', () => ({ RequestLocalAuthorizationCache: class {} }));
vi.mock('@alga-psa/authorization/subject', () => ({ resolveAuthorizationSubject: async () => ({ resolverFacts: {} }) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {} }), withTransaction: async (_d: unknown, fn: any) => fn({}) }));
vi.mock('./optimizedTicketActions', () => ({ assertTicketReadable: readable }));
vi.mock('../lib/ticketResponsibility', () => ({
  TicketResponsibilityError: class extends Error { constructor(public code: string) { super(code); } },
  resolveTicketResponsibility: async () => ({ handToClientIt, load }),
}));

import { handTicketToClientIt } from './ticketResponsibilityActions';

const input = { ticketId: 'ticket', expectedRevision: 0, note: 'n', operationId: 'op' };

describe('handTicketToClientIt record-level authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); hasPermission.mockResolvedValue(true); });

  it('refuses a ticket the caller cannot read and writes nothing', async () => {
    const denied = { permissionError: 'Permission denied: Cannot view ticket' };
    readable.mockResolvedValue(denied);
    await expect((handTicketToClientIt as any)(input)).resolves.toBe(denied);
    expect(handToClientIt).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('hands off a readable ticket', async () => {
    readable.mockResolvedValue(true);
    load.mockResolvedValue({ responsibility: 'client_it', revision: 1, technicians: [] });
    await expect((handTicketToClientIt as any)(input)).resolves.toEqual({ state: { responsibility: 'client_it', revision: 1, technicians: [] } });
    expect(handToClientIt).toHaveBeenCalledTimes(1);
  });
});
