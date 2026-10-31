import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coManagedDeliverySeam, coManagedInboundCommentSeam, coManagedInboundOperationId } from '../../../lib/coManagedDelivery';

/**
 * CM L5 inbound token matrix. A psa (native) token never consults the seam; cm2:/cm1: tokens do.
 * Providers are stubbed on the real seams; the capability gate is mocked to serve the tenant.
 */
const found = { ticketId: 'ticket-1', commentId: null as string | null, metadata: {} as unknown };
const findTicketByReplyTokenMock = vi.fn();
const findTicketByEmailThreadMock = vi.fn();
const createCommentFromEmailMock = vi.fn();
const servesMock = vi.fn(async () => ({ served: true }));
const threadRow: { value: unknown } = { value: undefined };
const parsed: { tokens: Record<string, string> } = { tokens: {} };

vi.mock('@alga-psa/core/capability', () => ({ serves: (...a: unknown[]) => (servesMock as any)(...a), admits: async () => ({ admitted: true }) }));
function qb(first: unknown) {
  const b: any = {};
  for (const m of ['select', 'where', 'whereNotNull', 'andWhereRaw', 'whereRaw', 'orderBy']) b[m] = vi.fn().mockReturnThis();
  b.andWhere = vi.fn((arg: unknown) => { if (typeof arg === 'function') (arg as any).call({ whereRaw: vi.fn().mockReturnThis(), orWhereRaw: vi.fn().mockReturnThis() }); return b; });
  b.first = vi.fn().mockResolvedValue(first);
  b.then = (res: any, rej: any) => Promise.resolve([]).then(res, rej);
  return b;
}
vi.mock('@alga-psa/db', () => ({
  withAdminTransaction: async (cb: any) => cb(vi.fn((table: string) => {
    if (table === 'comment_threads') return qb(threadRow.value);
    if (['comments', 'tickets as t', 'comments as c', 'email_sending_logs', 'tickets', 'statuses', 'boards'].includes(table)) return qb(undefined);
    throw new Error(`Unexpected table in unit test: ${table}`);
  })),
  tenantDb: (conn: any, tenant: string) => ({ table: (table: string) => conn(table).where({ tenant }) }),
}));
vi.mock('../../../workflow/actions/emailWorkflowActions', () => ({
  parseEmailReplyBody: async () => ({ sanitizedText: 'the reply', sanitizedHtml: undefined, confidence: 1, strategy: 'plain', appliedHeuristics: [], warnings: [], tokens: parsed.tokens }),
  findTicketByReplyToken: (...a: unknown[]) => findTicketByReplyTokenMock(...a),
  findTicketByEmailThread: (...a: unknown[]) => findTicketByEmailThreadMock(...a),
  resolveInboundTicketDefaults: async () => null, resolveEffectiveInboundTicketDefaults: async () => null,
  findContactByEmail: async () => null, findInboundEmailDomainMapping: async () => null, createContactForInboundSender: async () => null,
  findValidClientPrimaryContactId: async () => null, findEmailProviderMailboxAddress: async () => 'support@example.com',
  upsertTicketWatchListRecipients: async () => ({ updated: false, watchList: [] }), createTicketFromEmail: async () => ({ ticket_id: 'new', ticket_number: 'T' }),
  createCommentFromEmail: (...a: unknown[]) => createCommentFromEmailMock(...a), processEmailAttachment: async () => ({ success: true }),
}));
vi.mock('../processInboundEmailArtifacts', () => ({ processInboundEmailArtifactsBestEffort: async () => undefined }));

const writes: any[] = [];
const acks: any[] = [];
let admission: any;
const admitSpy = vi.fn(async () => admission);

function email(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1', provider: 'google', providerId: 'p1', tenant: 'tenant-1', receivedAt: '2026-10-30T00:00:00.000Z',
    from: { email: 'Agent@MSP.test', name: 'Agent' }, to: [{ email: 'support@example.com' }], subject: 'Re: ticket', body: { text: 'the reply' },
    attachments: [], headers: { 'authentication-results': 'mx; spf=pass smtp.mailfrom=msp.test' }, inReplyTo: '<thread@x>', ...overrides,
  } as any;
}
async function inbound(token: string, overrides: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  parsed.tokens = { conversationToken: token };
  const { processInboundEmailInApp } = await import('../processInboundEmailInApp');
  return processInboundEmailInApp({ tenantId: 'tenant-1', providerId: 'p1', emailData: email(overrides) }, options);
}

describe('inbound reply token matrix (CM L5)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); writes.length = 0; acks.length = 0; servesMock.mockResolvedValue({ served: true });
    coManagedDeliverySeam.reset(); coManagedInboundCommentSeam.reset();
    coManagedDeliverySeam.register(() => ({ admitReplyToken: admitSpy } as any));
    coManagedInboundCommentSeam.register(() => ({
      write: async (input: any) => { writes.push(input); return { commentId: 'cm-comment' }; },
      acknowledgeRefusal: async (input: any) => { acks.push(input); },
    }));
    findTicketByReplyTokenMock.mockResolvedValue(found);
    findTicketByEmailThreadMock.mockResolvedValue(null);
    createCommentFromEmailMock.mockResolvedValue('native-comment');
  });
  afterEach(() => { coManagedDeliverySeam.reset(); coManagedInboundCommentSeam.reset(); });

  it('cm2 shared_it reply lands in Shared IT with the admitted actor, thread and a deterministic operation id', async () => {
    admission = { admitted: true, audience: 'shared_it', relationshipId: 'rel', threadId: 'thr', ticketId: 'ticket-1', parentCommentId: null, actor: { tenant: 'msp', userId: 'u1' } };
    const result = await inbound('cm2:abc');
    expect(result).toMatchObject({ outcome: 'replied', commentId: 'cm-comment' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ audience: 'shared_it', threadId: 'thr', actor: { tenant: 'msp', userId: 'u1' }, text: 'the reply',
      operationId: coManagedInboundOperationId('tenant-1', 'ticket-1', 'msg-1') });
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
  });

  it('a duplicate inbound message yields the same operation id (the writer receipt makes it exactly-once)', async () => {
    admission = { admitted: true, audience: 'shared_it', relationshipId: 'rel', threadId: 'thr', ticketId: 'ticket-1', parentCommentId: null, actor: { tenant: 'msp', userId: 'u1' } };
    await inbound('cm2:abc'); await inbound('cm2:abc');
    expect(writes).toHaveLength(2);
    expect(writes[0].operationId).toBe(writes[1].operationId);
  });

  it('a requester reply (no actor) keeps the native writer, in the requester thread', async () => {
    admission = { admitted: true, audience: 'requester', relationshipId: 'rel', threadId: 'thr', ticketId: 'ticket-1', parentCommentId: null };
    await inbound('cm2:abc');
    expect(writes).toHaveLength(0);
  });

  it.each([
    ['cm1 legacy token', 'cm1:abc', 'legacy_token'],
    ['stale generation', 'cm2:abc', 'stale_generation'],
    ['non-participant', 'cm2:abc', 'not_participant'],
  ])('%s is refused: one acknowledgement, no comment', async (_n, token, reason) => {
    admission = { admitted: false, reason, acknowledge: true };
    const result = await inbound(token);
    expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_token_refused' });
    expect(writes).toHaveLength(0);
    expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    expect(acks).toHaveLength(1);
    expect(acks[0]).toMatchObject({ tenant: 'tenant-1', to: expect.stringMatching(/^agent@msp\.test$/i), ticketId: 'ticket-1', reason });
  });

  it('an auto-reply to a refused token is not acknowledged (no mail loop)', async () => {
    admission = { admitted: false, reason: 'stale_generation', acknowledge: true };
    const result = await inbound('cm2:abc', { headers: { 'auto-submitted': 'auto-replied', 'authentication-results': 'mx; spf=pass' } });
    expect(result).toMatchObject({ outcome: 'quarantined' });
    expect(acks).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it('a malformed cm2 token falls back to thread headers: no comment through the token, no acknowledgement', async () => {
    admission = { admitted: false, reason: 'not_served', acknowledge: false };
    await inbound('cm2:garbage');
    expect(acks).toHaveLength(0);
    expect(writes).toHaveLength(0);
    expect(findTicketByEmailThreadMock).toHaveBeenCalled();
  });

  it('a native (psa) token never consults the seam', async () => {
    servesMock.mockClear();
    await inbound('9f1c2d3e-4b5a-4c6d-8e7f-1a2b3c4d5e6f');
    expect(admitSpy).not.toHaveBeenCalled();
    expect(servesMock).not.toHaveBeenCalled();
    expect(acks).toHaveLength(0);
  });

  describe('no co-managed provider registered in this process', () => {
    beforeEach(() => { coManagedDeliverySeam.reset(); coManagedInboundCommentSeam.reset(); });

    it.each(['cm2:abc', 'cm1:abc'])('a %s token is retried, never written natively, never treated as inert', async (token) => {
      const { InboundRetryLaterError } = await import('../inboundRetryLaterError');
      await expect(inbound(token)).rejects.toBeInstanceOf(InboundRetryLaterError);
      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
      expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
      expect(acks).toHaveLength(0);
    });

    it('an admitted reply with no inbound writer registered is retried, not handed to the native path', async () => {
      const { InboundRetryLaterError } = await import('../inboundRetryLaterError');
      admission = { admitted: true, audience: 'shared_it', relationshipId: 'rel', threadId: 'thr', ticketId: 'ticket-1', parentCommentId: null, actor: { tenant: 'msp', userId: 'u1' } };
      coManagedDeliverySeam.register(() => ({ admitReplyToken: admitSpy } as any));
      await expect(inbound('cm2:abc')).rejects.toBeInstanceOf(InboundRetryLaterError);
      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
    });

    it('a native (psa) token still takes the native path with no provider (0 seam work)', async () => {
      await inbound('9f1c2d3e-4b5a-4c6d-8e7f-1a2b3c4d5e6f');
      expect(admitSpy).not.toHaveBeenCalled();
      expect(servesMock).not.toHaveBeenCalled();
    });

    it('a provider that says "not served" keeps the token inert: thread headers decide', async () => {
      coManagedDeliverySeam.register(() => ({ admitReplyToken: async () => ({ admitted: false, reason: 'not_served', acknowledge: false }) } as any));
      await inbound('cm2:garbage');
      expect(findTicketByEmailThreadMock).toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });
  });

  describe('the capability gate does not serve the tenant (seam resolves null)', () => {
    const cm2Meta = (threadId: string | null) => ({ namespace: 'cm', version: 2, relationshipId: 'rel', grantGeneration: 1, threadId });
    const verdict = (served: string) => ({ served: false, reasons: { admitted: 'not-evaluated', served } });
    beforeEach(() => { threadRow.value = undefined; found.metadata = {}; });
    afterEach(() => { found.metadata = {}; threadRow.value = undefined; });

    it.each(['resolver-unregistered', 'participation-error'])('(%s) is a boot/transient gap: retried, no write, no native path', async (reason) => {
      const { InboundRetryLaterError } = await import('../inboundRetryLaterError');
      servesMock.mockResolvedValue(verdict(reason) as any);
      found.metadata = cm2Meta('thr');
      await expect(inbound('cm2:abc')).rejects.toBeInstanceOf(InboundRetryLaterError);
      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
      expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });

    it('forced off + shared_it token: terminal quarantine, no writer called', async () => {
      servesMock.mockResolvedValue(verdict('forced-off') as any);
      found.metadata = cm2Meta('thr');
      threadRow.value = { collaboration_audience: 'shared_it', is_internal: true };
      const result: any = await inbound('cm2:abc', {}, { collectDiagnostics: true });
      expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_token_unserved', ticketId: 'ticket-1' });
      expect(result.diagnostics?.threading?.failureReason).toBe('co_managed_token_unserved');
      expect(createCommentFromEmailMock).not.toHaveBeenCalled();
      expect(findTicketByEmailThreadMock).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
      expect(acks).toHaveLength(0);
    });

    it('not served + requester-thread token: inert, the native writer takes it', async () => {
      servesMock.mockResolvedValue(verdict('not-participating') as any);
      found.metadata = cm2Meta(null);
      const result: any = await inbound('cm2:abc', {}, { collectDiagnostics: true });
      expect(result.outcome).not.toBe('quarantined');
      // Today's inert behaviour: the token carries no authority, the native thread-header path decides.
      expect(result.diagnostics.threading.tokenLookupMatched).toBe(false);
      expect(findTicketByEmailThreadMock).toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });

    it('a psa token makes no seam or gate call', async () => {
      servesMock.mockResolvedValue(verdict('resolver-unregistered') as any);
      const resolveSpy = vi.spyOn(coManagedDeliverySeam, 'resolve');
      await inbound('9f1c2d3e-4b5a-4c6d-8e7f-1a2b3c4d5e6f');
      expect(resolveSpy).not.toHaveBeenCalled();
      expect(servesMock).not.toHaveBeenCalled();
      resolveSpy.mockRestore();
    });
  });
});
