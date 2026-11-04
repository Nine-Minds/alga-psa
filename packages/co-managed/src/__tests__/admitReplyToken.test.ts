/**
 * admitReplyToken: the single admission point for cm2 inbound replies. The REAL provider runs over a tiny
 * tenant-scoped in-memory store; mocked: the DB wiring and the modules the provider imports for other methods.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const authority = vi.hoisted(() => ({ deniedAction: null as string | null, calls: [] as any[] }));
const authorize = vi.hoisted(() => async (db: unknown, actor: any, resource: any, action: string, command: any) => {
  authority.calls.push({ actor, resource, action });
  if (authority.deniedAction === action) throw Object.assign(new Error('Permission denied'), { code: 'CO_MANAGED_SHARED_WORK_FORBIDDEN' });
  return command({ trx: db });
});
const store = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, lookups: [] as string[] }));

vi.mock('@alga-psa/db', () => {
  function builder(name: string, tenant: string) {
    const preds: Array<(r: Row) => boolean> = [(r) => r.tenant === tenant];
    const rows = () => (store.tables[name] ?? []).filter((r) => preds.every((p) => p(r)));
    const b: any = {
      where(cond: Row) { preds.push((r) => Object.entries(cond).every(([k, v]) => r[k.split('.').pop()!] === v)); return b; },
      whereNull(col: string) { preds.push((r) => r[col] == null); return b; },
      whereRaw(sql: string, [value]: [string]) {
        const col = /lower\((\w+)\)/.exec(sql)![1];
        preds.push((r) => String(r[col] ?? '').toLowerCase() === value);
        return b;
      },
      andWhere(arg: unknown) {
        if (typeof arg !== 'function') return b;
        // contactEmailMatch: primary email OR an additional address of the same contact.
        const clauses: Array<(r: Row) => boolean> = [];
        const collector: any = {
          where: (col: string, v: string) => { clauses.push((r) => r[col.split('.').pop()!] === v); return collector; },
          orWhereExists: (sub: { test: (r: Row) => boolean }) => { clauses.push(sub.test); return collector; },
        };
        (arg as any).call(collector);
        preds.push((r) => clauses.some((c) => c(r)));
        return b;
      },
      count: async () => [{ count: String(rows().length) }],
      first: async () => { store.lookups.push(name); return rows()[0]; },
      insert(values: Row | Row[]) {
        const inserted = (Array.isArray(values) ? values : [values]).map((row) => ({ ...row }));
        store.tables[name] = [...(store.tables[name] ?? []), ...inserted];
        const result: any = Promise.resolve(inserted);
        result.onConflict = () => ({ ignore: () => Promise.resolve(inserted) });
        return result;
      },
    };
    return b;
  }
  return {
    withAdminTransaction: async (cb: any) => cb({ raw: (sql: string) => sql }),
    tenantDb: (_trx: unknown, tenant: string) => ({
      table: (name: string) => builder(name, tenant),
      subquery: () => {
        let wanted = '';
        const sub: any = { select: () => sub, whereRaw: () => sub, andWhere: (_c: string, v: string) => { wanted = v; return sub; },
          test: (r: Row) => (store.tables.contact_additional_email_addresses ?? []).some((a) => a.tenant === tenant && a.contact_name_id === r.contact_name_id && a.normalized_email_address === wanted) };
        return sub;
      },
    }),
  };
});
vi.mock('@alga-psa/shared/lib/deliveryLedger', () => ({ claimDelivery: vi.fn(), finishDelivery: vi.fn(), CO_MANAGED_LEDGER: {} }));
vi.mock('@alga-psa/core/logger', () => ({ default: { warn: vi.fn() } }));
vi.mock('../sharedWork', () => ({ withCoManagedNotificationRecipient: vi.fn(), withCoManagedSharedWork: vi.fn(authorize) }));
vi.mock('../customerWork', () => ({ withCoManagedCustomerTicket: vi.fn(authorize) }));
vi.mock('../sharedWorkIdentity', () => ({
  isCoManagedSharedWorkError: (error: any) => error?.code === 'CO_MANAGED_SHARED_WORK_FORBIDDEN',
  withCoManagedMailCredential: (_actor: unknown, run: () => Promise<unknown>) => run(),
}));
vi.mock('../routingOutbox', () => ({ ROUTING_IN_APP_KIND: 'routing_in_app', ROUTING_EMAIL_KIND: 'routing_email' }));
vi.mock('../projectTaskAudience', () => ({ projectTaskAudience: () => 'organization_private' }));

import { createCoManagedDeliveryProvider } from '../deliveryProvider';

const CUSTOMER = 'tenant-c';
const SPONSOR = 'tenant-s';
const metadata = (threadId: string) => ({ namespace: 'cm', version: 2, relationshipId: 'rel', grantGeneration: 0, threadId });
const trusted = (email: string | null) => ({ email, internalAttributionTrusted: true, contactAttributionTrusted: true });
const untrusted = (email: string | null) => ({ email, internalAttributionTrusted: false, contactAttributionTrusted: false });

function seed(audience: 'shared_it' | 'organization_private' | 'requester') {
  authority.deniedAction = null;
  authority.calls = [];
  store.lookups = [];
  store.tables = {
    email_reply_tokens: [{ tenant: CUSTOMER, token: 'cm2:t', ticket_id: 'tk', comment_id: 'c1', expires_at: new Date('2099-01-01T00:00:00.000Z') }],
    co_management_ticket_work: [{ tenant: CUSTOMER, ticket_id: 'tk', relationship_id: 'rel', work_id: 'w', grant_revoked_at: null, first_escalated_at: new Date() }],
    co_management_relationships: [{ tenant: CUSTOMER, relationship_id: 'rel', state: 'active', ended_at: null, sponsor_tenant: SPONSOR, sponsor_client_id: 'sc' }],
    co_management_ticket_handoffs: [],
    comment_threads: [{ tenant: CUSTOMER, thread_id: 'thr', ticket_id: 'tk', collaboration_audience: audience, is_internal: audience !== 'requester' }],
    comments: [{ tenant: CUSTOMER, comment_id: 'c1', thread_id: 'thr', ticket_id: 'tk' }],
    tickets: [{ tenant: CUSTOMER, ticket_id: 'tk', client_id: 'client-1' }],
    users: [
      { tenant: SPONSOR, user_id: 'sponsor-user', email: 'Agent@MSP.test', user_type: 'internal', is_inactive: false },
      { tenant: CUSTOMER, user_id: 'customer-user', email: 'it@customer.test', user_type: 'internal', is_inactive: false },
    ],
    contacts: [
      { tenant: CUSTOMER, contact_name_id: 'k1', email: 'req@customer.test', client_id: 'client-1', is_inactive: false },
      { tenant: CUSTOMER, contact_name_id: 'k2', email: 'other@elsewhere.test', client_id: 'client-2', is_inactive: false },
      { tenant: CUSTOMER, contact_name_id: 'k3', email: 'gone@customer.test', client_id: 'client-1', is_inactive: true },
      { tenant: SPONSOR, contact_name_id: 'k4', email: 'foreign@customer.test', client_id: 'client-1', is_inactive: false },
    ],
    contact_additional_email_addresses: [
      { tenant: CUSTOMER, contact_name_id: 'k1', normalized_email_address: 'req.alt@home.test' },
      { tenant: CUSTOMER, contact_name_id: 'k2', normalized_email_address: 'other.alt@home.test' },
      { tenant: CUSTOMER, contact_name_id: 'k3', normalized_email_address: 'gone.alt@home.test' },
    ],
  };
}
const admit = (sender: { email: string | null; internalAttributionTrusted: boolean; contactAttributionTrusted: boolean }) =>
  createCoManagedDeliveryProvider().admitReplyToken(CUSTOMER, 'cm2:t', metadata('thr'), sender);

describe('admitReplyToken sender authentication', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  describe('token scope and current authority', () => {
    beforeEach(() => seed('shared_it'));

    it.each(['', 'cm2:missing'])('refuses a missing token (%s)', async (token) => {
      expect(await createCoManagedDeliveryProvider().admitReplyToken(CUSTOMER, token, metadata('thr'), trusted('agent@msp.test')))
        .toMatchObject({ admitted: false });
      expect(authority.calls).toEqual([]);
    });
    it('refuses a token stored in another tenant', async () => {
      store.tables.email_reply_tokens[0].tenant = SPONSOR;
      expect(await admit(trusted('agent@msp.test'))).toMatchObject({ admitted: false });
    });
    it('refuses a token from a different ticket even in the same relationship', async () => {
      store.tables.email_reply_tokens[0].ticket_id = 'other-ticket';
      store.tables.co_management_ticket_work.push({ ...store.tables.co_management_ticket_work[0], ticket_id: 'other-ticket' });
      expect(await admit(trusted('agent@msp.test'))).toMatchObject({ admitted: false });
      expect(authority.calls).toEqual([]);
    });
    it('refuses a token whose parent belongs to another ticket', async () => {
      store.tables.comments[0].ticket_id = 'other-ticket';
      expect(await admit(trusted('agent@msp.test'))).toMatchObject({ admitted: false });
    });
    it('refuses a revoked grant', async () => {
      store.tables.co_management_ticket_work[0].grant_revoked_at = new Date();
      expect(await admit(trusted('agent@msp.test'))).toMatchObject({ admitted: false, reason: 'grant_revoked' });
    });
    it('refuses a token from an earlier grant generation', async () => {
      store.tables.co_management_ticket_handoffs.push({ tenant: CUSTOMER, relationship_id: 'rel', ticket_id: 'tk', transition: 'access_revoked' });
      expect(await admit(trusted('agent@msp.test'))).toMatchObject({ admitted: false, reason: 'stale_generation' });
    });
    it('refuses an ended relationship', async () => {
      store.tables.co_management_relationships[0].ended_at = new Date();
      expect(await admit(trusted('agent@msp.test'))).toMatchObject({ admitted: false });
    });
    it.each(['agent@msp.test', 'it@customer.test'])('checks read and update authority for %s in its own tenant', async (email) => {
      expect(await admit(trusted(email))).toMatchObject({ admitted: true });
      expect(authority.calls).toEqual(['update', 'read'].map(action => ({
        actor: expect.objectContaining({ tenant: email === 'agent@msp.test' ? SPONSOR : CUSTOMER }),
        resource: { tenant: CUSTOMER, relationshipId: 'rel', kind: 'ticket', id: 'tk' }, action,
      })));
    });
    it.each([
      ['agent@msp.test', 'update'], ['agent@msp.test', 'read'],
      ['it@customer.test', 'update'], ['it@customer.test', 'read'],
    ])('refuses %s when current %s authority is revoked', async (email, action) => {
      authority.deniedAction = action;
      expect(await admit(trusted(email))).toEqual({ admitted: false, reason: 'not_participant', acknowledge: true });
    });
    it('does not resolve a user in an unrelated tenant', async () => {
      store.tables.users[0].tenant = 'unrelated-tenant';
      expect(await admit(trusted('agent@msp.test'))).toMatchObject({ admitted: false });
      expect(authority.calls).toEqual([]);
    });
  });

  describe('shared_it', () => {
    beforeEach(() => seed('shared_it'));

    it('refuses an authenticated participant when the token has expired', async () => {
      store.tables.email_reply_tokens[0].expires_at = '2000-01-01T00:00:00.000Z';
      expect(await admit(trusted('agent@msp.test'))).toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
    });

    it('exploit regression: an unauthenticated From naming a sponsor user is refused before any user lookup, with no acknowledgement', async () => {
      expect(await admit(untrusted('agent@msp.test'))).toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
      expect(store.lookups).not.toContain('users');
    });

    it('trusted auth + sponsor user is admitted as an actor in the sponsor tenant', async () => {
      expect(await admit(trusted('AGENT@msp.test'))).toMatchObject({ admitted: true, audience: 'shared_it', actor: { tenant: SPONSOR, userId: 'sponsor-user' } });
    });

    it('trusted auth + unknown sender is not_participant (acknowledged)', async () => {
      expect(await admit(trusted('nobody@x.test'))).toEqual({ admitted: false, reason: 'not_participant', acknowledge: true });
    });
  });

  describe('organization_private', () => {
    beforeEach(() => seed('organization_private'));

    it('refuses an authenticated participant when the token has expired', async () => {
      store.tables.email_reply_tokens[0].expires_at = new Date('2000-01-01T00:00:00.000Z');
      expect(await admit(trusted('it@customer.test'))).toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
    });

    it('trusted auth + customer user is admitted', async () => {
      expect(await admit(trusted('it@customer.test'))).toMatchObject({ admitted: true, actor: { tenant: CUSTOMER, userId: 'customer-user' } });
    });
    it('trusted auth + sponsor user is audience_forbidden', async () => {
      expect(await admit(trusted('agent@msp.test'))).toEqual({ admitted: false, reason: 'audience_forbidden', acknowledge: true });
    });
    it('untrusted auth is sender_unauthenticated, with no user lookup', async () => {
      expect(await admit(untrusted('it@customer.test'))).toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
      expect(store.lookups).not.toContain('users');
    });
  });

  describe('requester', () => {
    beforeEach(() => seed('requester'));
    const refused = { admitted: false, reason: 'not_participant', acknowledge: true };

    it('an untrusted forged From is refused before requester contact lookup', async () => {
      expect(await admit(untrusted('req@CUSTOMER.test'))).toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
      expect(store.lookups).not.toContain('contacts');
    });
    it('missing sender authentication fails closed before requester contact lookup', async () => {
      expect(await admit({ email: 'req@CUSTOMER.test', internalAttributionTrusted: false, contactAttributionTrusted: false }))
        .toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
      expect(store.lookups).not.toContain('contacts');
    });
    it('a trusted active contact of the ticket client is admitted with its identity', async () => {
      const result: any = await admit({ ...trusted('req@CUSTOMER.test'), contactAttributionTrusted: true });
      expect(result).toMatchObject({ admitted: true, audience: 'requester', ticketId: 'tk', requesterContactId: 'k1', requesterClientId: 'client-1' });
      expect(result.actor).toBeUndefined();
    });
    it.each([
      ['expired', new Date('2000-01-01T00:00:00.000Z')],
      ['missing', undefined],
      ['malformed', 'not-a-timestamp'],
    ])('refuses an authenticated requester with a valid grant when expiry is %s', async (_label, expiresAt) => {
      store.tables.email_reply_tokens[0].expires_at = expiresAt;
      const denied = await admit(untrusted('req@CUSTOMER.test'));
      expect(await admit({ ...trusted('req@CUSTOMER.test'), contactAttributionTrusted: true }))
        .toEqual(denied);
      expect(denied).toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
      expect(store.lookups).not.toContain('contacts');
    });
    it('admits a valid requester with a future expiry', async () => {
      store.tables.email_reply_tokens[0].expires_at = '2099-01-01T00:00:00.000Z';
      expect(await admit(trusted('req@CUSTOMER.test'))).toMatchObject({ admitted: true, requesterContactId: 'k1' });
    });
    it('admits a requester cm2 token issued through outbound persistence, then refuses it at expiry', async () => {
      const { persistReplyToken } = await import('../../../../server/src/lib/notifications/replyTokenPersistence');
      const configuredExpiry = new Date(Date.now() + 6 * 60 * 60 * 1000);
      await persistReplyToken({ schema: { hasTable: async () => true } }, CUSTOMER, {
        token: 'cm2:issued-by-outbound', ticketId: 'tk', commentId: 'c1', threadId: 'thr',
        extraMetadata: { namespace: 'cm', version: 2, relationshipId: 'rel', grantGeneration: 0 },
      }, { template: 'ticket-comment-added', subject: 'Re: ticket', recipient: 'req@customer.test' }, configuredExpiry);

      const issued = store.tables.email_reply_tokens.find((row) => row.token === 'cm2:issued-by-outbound');
      expect(issued).toBeTruthy();
      if (!issued) throw new Error('Outbound token persistence did not produce a token record');
      expect(new Date(issued.expires_at).getTime()).toBe(configuredExpiry.getTime());
      const provider = createCoManagedDeliveryProvider();
      const sender = { email: 'req@customer.test', internalAttributionTrusted: false, contactAttributionTrusted: true };
      const admitted = await provider.admitReplyToken(CUSTOMER, issued.token, JSON.parse(issued.metadata), sender);
      expect(admitted).toMatchObject({ admitted: true, audience: 'requester', requesterContactId: 'k1', requesterClientId: 'client-1' });

      vi.setSystemTime(new Date(issued.expires_at));
      expect(await provider.admitReplyToken(CUSTOMER, issued.token, JSON.parse(issued.metadata), sender))
        .toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
    });

    it.each([undefined, null, 'not-a-timestamp', new Date('2000-01-01T00:00:00.000Z')])(
      'refuses outbound token persistence for an absent or invalid expiry (%s)', async (expiresAt) => {
        const { persistReplyToken } = await import('../../../../server/src/lib/notifications/replyTokenPersistence');
        const logger = (await import('@alga-psa/core/logger')).default;
        vi.mocked(logger.warn).mockClear();
        const before = store.tables.email_reply_tokens.length;
        await persistReplyToken({ schema: { hasTable: async () => true } }, CUSTOMER, {
          token: `cm2:invalid-expiry-${String(expiresAt)}`, ticketId: 'tk', commentId: 'c1',
        }, { template: 'ticket-comment-added', subject: 'Re: ticket', recipient: 'req@customer.test' }, expiresAt as any);
        expect(store.tables.email_reply_tokens).toHaveLength(before);
        expect(logger.warn).toHaveBeenCalledWith(
          '[SendEventEmail] Failed to persist email reply token',
          expect.objectContaining({ error: expect.stringContaining('valid future expiry') })
        );
      }
    );
    it('continues refusing a legacy requester cm2 token with null expiry', async () => {
      store.tables.email_reply_tokens[0].expires_at = null;
      expect(await admit({ ...trusted('req@customer.test'), contactAttributionTrusted: true }))
        .toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
    });
    it('treats the exact expiry instant as expired before looking up requester participants', async () => {
      store.tables.email_reply_tokens[0].expires_at = '2026-01-01T00:00:00.000Z';
      expect(await admit({ ...trusted('req@CUSTOMER.test'), contactAttributionTrusted: true }))
        .toEqual({ admitted: false, reason: 'sender_unauthenticated', acknowledge: false });
      expect(store.lookups).not.toContain('contacts');
    });
    it('a contact of another client is refused', async () => { expect(await admit(trusted('other@elsewhere.test'))).toEqual(refused); });
    it('the same email in another tenant is refused', async () => { expect(await admit(trusted('foreign@customer.test'))).toEqual(refused); });
    it('an inactive contact is refused', async () => { expect(await admit(trusted('gone@customer.test'))).toEqual(refused); });
    it('an additional address of an active contact of the ticket client is admitted when trusted', async () => {
      expect(await admit({ ...trusted('Req.Alt@home.test'), contactAttributionTrusted: true })).toMatchObject({ admitted: true, audience: 'requester', requesterContactId: 'k1', requesterClientId: 'client-1' });
    });
    it('an additional address of another client\'s contact is refused', async () => { expect(await admit(trusted('other.alt@home.test'))).toEqual(refused); });
    it('an additional address of an inactive contact is refused', async () => { expect(await admit(trusted('gone.alt@home.test'))).toEqual(refused); });
    it('no sender is refused', async () => { expect(await admit(trusted(null))).toEqual(refused); });
    it('an internal user address is not a requester contact', async () => { expect(await admit(trusted('agent@msp.test'))).toEqual(refused); });
  });
});
