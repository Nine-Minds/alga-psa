import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * CF003. The two separately compiled worker admission adapters are the call
 * sites the duck-typed classification exists for, and until now nothing
 * asserted their behaviour: `inboundErrorDiagnostics.test.ts` covers
 * `isCoManagedSharedWorkError` in isolation, so reverting either adapter to
 * `instanceof` passed the entire suite — precisely the mutation the fix
 * prevents.
 *
 * What matters at these call sites is the disposition each error produces
 * downstream in `inboundEmailCoreProcessor`:
 *
 *   `{ admitted: false }`  -> quarantine -> ack/skipped   (terminal, correct)
 *   a rethrow              -> unclassified -> `retry`     (the observed bug)
 *
 * So each adapter is driven three ways: an authorization rejection built by a
 * FOREIGN constructor (what the other compiled copy of this package throws), one
 * built by the same-realm constructor, and an unrelated infrastructure error
 * that must still propagate so the durable inbox retries it.
 */

const hoisted = vi.hoisted(() => ({
  requesterWriter: vi.fn(),
  customerWriter: vi.fn(),
}));

vi.mock('../../../../../packages/co-managed/src/requesterReplyTokens', () => ({
  withCoManagedRequesterEmailReply: hoisted.requesterWriter,
}));
vi.mock('../../../../../packages/co-managed/src/customerReplyTokens', () => ({
  withCoManagedCustomerEmailReply: hoisted.customerWriter,
}));
// Not on the path under test; stubbed so importing the adapters stays cheap.
vi.mock('../../../../../packages/co-managed/src/ticketSla', () => ({
  syncCoManagedTicketAwaitingClientSla: vi.fn(async () => undefined),
}));
vi.mock('../../../../../packages/co-managed/src/customerCommentNotification', () => ({
  withCoManagedCustomerCommentNotification: vi.fn(async () => null),
}));

const { admitCoManagedRequesterReply } = await import('../../../../../packages/co-managed/src/inboundRequesterReply');
const { admitCoManagedEmailReply } = await import('../../../../../packages/co-managed/src/inboundEmailReply');
const { CoManagedSharedWorkError } = await import('../../../../../packages/co-managed/src/sharedWorkIdentity');

/**
 * An authorization rejection raised by the OTHER compiled copy of
 * packages/co-managed: identical contract, different constructor. This is what
 * the split export map produces at runtime, and what `instanceof` cannot see.
 */
function foreignSharedWorkError(): Error {
  return Object.assign(new Error('This shared resource is not available for the requested operation.'), {
    name: 'CoManagedSharedWorkError',
    code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN',
  });
}

/** Minimal owning transaction: `isTransaction`, and a savepoint that just runs. */
function fakeTransaction() {
  const trx: Record<string, unknown> = { isTransaction: true };
  trx.transaction = (callback: (savepoint: unknown) => unknown) => Promise.resolve(callback(trx));
  return trx;
}

const requesterInput = {
  tenant: '11111111-1111-4111-8111-111111111111',
  token: 'cm1:abc',
  senderEmail: 'requester@customer.test',
  senderAuth: null,
};
const technicianInput = {
  tenant: '11111111-1111-4111-8111-111111111111',
  inboxId: '22222222-2222-4222-8222-222222222222',
  token: 'cm2:def',
  senderEmail: 'tech@msp.test',
  senderAuth: null,
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('admitCoManagedRequesterReply classification', () => {
  it('quarantines an authorization rejection from a separately compiled copy', async () => {
    hoisted.requesterWriter.mockRejectedValueOnce(foreignSharedWorkError());
    await expect(admitCoManagedRequesterReply(fakeTransaction() as never, requesterInput as never, vi.fn() as never))
      .resolves.toEqual({ admitted: false });
  });

  it('quarantines an authorization rejection from this copy', async () => {
    hoisted.requesterWriter.mockRejectedValueOnce(new CoManagedSharedWorkError());
    await expect(admitCoManagedRequesterReply(fakeTransaction() as never, requesterInput as never, vi.fn() as never))
      .resolves.toEqual({ admitted: false });
  });

  it('still propagates an unrelated infrastructure failure so the inbox retries it', async () => {
    // The repair must not broaden quarantine. A database error is not an
    // authorization rejection and must keep reaching the retry path.
    const dbError = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    hoisted.requesterWriter.mockRejectedValueOnce(dbError);
    await expect(admitCoManagedRequesterReply(fakeTransaction() as never, requesterInput as never, vi.fn() as never))
      .rejects.toThrow('deadlock detected');
  });

  it('rejects a caller that is not inside the owning inbox transaction', async () => {
    await expect(admitCoManagedRequesterReply({} as never, requesterInput as never, vi.fn() as never))
      .rejects.toThrow('Requester reply admission requires the owning inbox transaction');
  });
});

describe('admitCoManagedEmailReply classification', () => {
  it('quarantines an authorization rejection from a separately compiled copy', async () => {
    hoisted.customerWriter.mockRejectedValueOnce(foreignSharedWorkError());
    await expect(admitCoManagedEmailReply(fakeTransaction() as never, technicianInput as never, vi.fn() as never))
      .resolves.toEqual({ admitted: false });
  });

  it('quarantines an authorization rejection from this copy', async () => {
    hoisted.customerWriter.mockRejectedValueOnce(new CoManagedSharedWorkError());
    await expect(admitCoManagedEmailReply(fakeTransaction() as never, technicianInput as never, vi.fn() as never))
      .resolves.toEqual({ admitted: false });
  });

  it('still propagates an unrelated infrastructure failure so the inbox retries it', async () => {
    const dbError = Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' });
    hoisted.customerWriter.mockRejectedValueOnce(dbError);
    await expect(admitCoManagedEmailReply(fakeTransaction() as never, technicianInput as never, vi.fn() as never))
      .rejects.toThrow('connection terminated');
  });

  it('routes a cm1: requester token to the requester adapter', async () => {
    // The technician adapter delegates `cm1:` tokens, so the requester
    // classification governs them wherever they arrive.
    hoisted.requesterWriter.mockRejectedValueOnce(foreignSharedWorkError());
    await expect(admitCoManagedEmailReply(
      fakeTransaction() as never, { ...technicianInput, token: 'cm1:abc' } as never, vi.fn() as never,
    )).resolves.toEqual({ admitted: false });
    expect(hoisted.customerWriter).not.toHaveBeenCalled();
  });
});
