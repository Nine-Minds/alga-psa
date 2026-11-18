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
vi.mock('../lib/ticketResponsibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ticketResponsibility')>()),
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

describe('handTicketToClientIt refusals', () => {
  beforeEach(() => { vi.clearAllMocks(); hasPermission.mockResolvedValue(true); readable.mockResolvedValue(true); });

  it('tells the user why when the provider refuses, even when its error class is another bundle\'s copy', async () => {
    // The co-managed provider is bundled apart from this action: its TicketResponsibilityError is not this module's class.
    class ForeignTicketResponsibilityError extends Error {
      constructor(public readonly code: string) { super(code); this.name = 'TicketResponsibilityError'; }
    }
    handToClientIt.mockRejectedValue(new ForeignTicketResponsibilityError('BOARD_OUT_OF_SCOPE'));
    const result = await (handTicketToClientIt as any)(input);
    expect(result).toMatchObject({ actionError: "This ticket's board is not shared with client IT, so it cannot be handed over." });
    expect(load).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected error', async () => {
    handToClientIt.mockRejectedValue(new Error('boom'));
    await expect((handTicketToClientIt as any)(input)).rejects.toThrow('boom');
  });
});
