import { beforeEach, describe, expect, it, vi } from 'vitest';

const readable = vi.hoisted(() => vi.fn());
const handToClientIt = vi.hoisted(() => vi.fn());
const handToMsp = vi.hoisted(() => vi.fn());
const load = vi.hoisted(() => vi.fn());
const hasPermission = vi.hoisted(() => vi.fn(async () => true));
const provider = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: 't' }, ...args),
  localizeActionError: async (value: unknown) => value,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission }));
vi.mock('@alga-psa/authorization/kernel', () => ({ RequestLocalAuthorizationCache: class {} }));
vi.mock('@alga-psa/authorization/subject', () => ({ resolveAuthorizationSubject: async () => ({ resolverFacts: {} }) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {} }), withTransaction: async (_d: unknown, fn: any) => fn({}) }));
vi.mock('./optimizedTicketActions', () => ({ assertTicketReadable: readable }));
vi.mock('../lib/ticketResponsibility', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/ticketResponsibility')>()),
  resolveTicketResponsibility: async () => provider.current,
  resolveTicketHandoff: async () => (provider.current ? { provider: provider.current, direction: 'msp' } : null),
}));

import { bulkHandTicketsToClientIt, bulkHandTicketsToMsp } from './ticketResponsibilityActions';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const SUBMISSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = (ids: string[], extra: object = {}) => ({
  tickets: ids.map((ticketId) => ({ ticketId, expectedRevision: 0 })), note: 'n', submissionId: SUBMISSION, ...extra,
});
const refusal = (code: string) => Object.assign(new Error(code), { name: 'TicketResponsibilityError', code });
const done = { responsibility: 'msp', revision: 1, technicians: [] };

describe('bulk handoff actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasPermission.mockResolvedValue(true);
    readable.mockResolvedValue(true);
    provider.current = { handToClientIt, handToMsp, load };
    handToClientIt.mockResolvedValue({ ...done, responsibility: 'client_it' });
    handToMsp.mockResolvedValue(done);
  });

  it('is not available when no provider offers the handoff, and looks at no ticket', async () => {
    provider.current = null;
    for (const action of [bulkHandTicketsToClientIt, bulkHandTicketsToMsp] as any[]) {
      expect(await action(input([A, B]))).toMatchObject({ actionError: expect.stringContaining('not available') });
    }
    expect(readable).not.toHaveBeenCalled();
    expect(handToClientIt).not.toHaveBeenCalled();
    expect(handToMsp).not.toHaveBeenCalled();
  });

  it('acts on each ticket on its own: a refusal and an unexpected failure leave the others handed over', async () => {
    handToClientIt.mockImplementation(async (_db: unknown, { ticketId }: { ticketId: string }) => {
      if (ticketId === A) throw refusal('HANDOFF_CHANGED');
      if (ticketId === B) throw new Error('connection reset');
      return { ...done, responsibility: 'client_it' };
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result: any = await (bulkHandTicketsToClientIt as any)(input([A, B, C]));
    expect(handToClientIt).toHaveBeenCalledTimes(3);
    expect(result.results).toEqual([
      { ticketId: A, ok: false, message: expect.any(String), messageKey: 'features/tickets:errors.seatHandoff.changed' },
      { ticketId: B, ok: false, message: expect.any(String), messageKey: 'features/tickets:errors.seatHandoff.unexpected' },
      { ticketId: C, ok: true, state: { responsibility: 'client_it', revision: 1 } },
    ]);
  });

  it('gives each ticket its own revision and operation id, the same on a retry, and the one note to all', async () => {
    const run = async () => {
      handToMsp.mockClear();
      await (bulkHandTicketsToMsp as any)({ tickets: [{ ticketId: A, expectedRevision: 3 }, { ticketId: B, expectedRevision: 0 }], note: 'shared', submissionId: SUBMISSION });
      return handToMsp.mock.calls.map(([, call]) => call);
    };
    const first = await run();
    expect(first.map((call) => [call.ticketId, call.expectedRevision, call.note])).toEqual([[A, 3, 'shared'], [B, 0, 'shared']]);
    expect(new Set(first.map((call) => call.operationId)).size).toBe(2);
    expect((await run()).map((call) => call.operationId)).toEqual(first.map((call) => call.operationId));
  });

  it('a ticket the caller cannot read is "not available", never "permission denied", and is not acted on', async () => {
    readable.mockImplementation(async (ticketId: string) => (ticketId === A ? { permissionError: 'Permission denied: Cannot view ticket' } : true));
    const result: any = await (bulkHandTicketsToMsp as any)(input([A, B]));
    expect(result.results[0]).toMatchObject({ ticketId: A, ok: false, messageKey: 'features/tickets:errors.seatHandoff.ticketNotFound' });
    expect(result.results[0].message).not.toMatch(/permission/i);
    expect(result.results[1]).toMatchObject({ ticketId: B, ok: true });
    expect(handToMsp).toHaveBeenCalledTimes(1);
  });

  it('a malformed ticket id is not looked up; a technician is named for client IT only', async () => {
    const technician = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const result: any = await (bulkHandTicketsToClientIt as any)(input(['not-a-uuid', A], { technicianUserId: technician }));
    expect(result.results[0]).toMatchObject({ ticketId: 'not-a-uuid', ok: false, messageKey: 'features/tickets:errors.seatHandoff.ticketNotFound' });
    expect(handToClientIt).toHaveBeenCalledTimes(1);
    expect(handToClientIt.mock.calls[0][1]).toMatchObject({ ticketId: A, technicianUserId: technician });
    await (bulkHandTicketsToMsp as any)(input([A], { technicianUserId: technician }));
    expect(handToMsp.mock.calls[0][1]).not.toHaveProperty('technicianUserId');
  });

  it('refuses an empty selection, too many tickets and a submission id that is not a UUID, acting on nothing', async () => {
    for (const bad of [input([]), input(Array.from({ length: 101 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`)), input([A], { submissionId: 'x' })]) {
      expect(await (bulkHandTicketsToMsp as any)(bad)).toMatchObject({ actionError: expect.any(String) });
    }
    expect(handToMsp).not.toHaveBeenCalled();
  });
});
