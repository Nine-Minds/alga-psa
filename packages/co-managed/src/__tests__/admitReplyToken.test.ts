/**
 * admitReplyToken: the single admission point for cm2 inbound replies. The REAL provider runs over a tiny
 * tenant-scoped in-memory store; mocked: the DB wiring and the modules the provider imports for other methods.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
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
vi.mock('../sharedWork', () => ({ withCoManagedNotificationRecipient: vi.fn() }));
vi.mock('../sharedWorkIdentity', () => ({ isCoManagedSharedWorkError: () => false }));
vi.mock('../routingOutbox', () => ({ ROUTING_IN_APP_KIND: 'routing_in_app', ROUTING_EMAIL_KIND: 'routing_email' }));
vi.mock('../projectTaskAudience', () => ({ projectTaskAudience: () => 'organization_private' }));

import { createCoManagedDeliveryProvider } from '../deliveryProvider';

const CUSTOMER = 'tenant-c';
const SPONSOR = 'tenant-s';
const metadata = (threadId: string) => ({ namespace: 'cm', version: 2, relationshipId: 'rel', grantGeneration: 0, threadId });
const trusted = (email: string | null) => ({ email, internalAttributionTrusted: true });
const untrusted = (email: string | null) => ({ email, internalAttributionTrusted: false });

function seed(audience: 'shared_it' | 'organization_private' | 'requester') {
  store.lookups = [];
  store.tables = {
    email_reply_tokens: [{ tenant: CUSTOMER, token: 'cm2:t', ticket_id: 'tk', comment_id: 'c1' }],
    co_management_ticket_work: [{ tenant: CUSTOMER, ticket_id: 'tk', relationship_id: 'rel', work_id: 'w', grant_revoked_at: null, first_escalated_at: new Date() }],
    co_management_relationships: [{ tenant: CUSTOMER, relationship_id: 'rel', state: 'active', ended_at: null, sponsor_tenant: SPONSOR, sponsor_client_id: 'sc' }],
    co_management_ticket_handoffs: [],
    comment_threads: [{ tenant: CUSTOMER, thread_id: 'thr', collaboration_audience: audience, is_internal: audience !== 'requester' }],
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
const admit = (sender: { email: string | null; internalAttributionTrusted: boolean }) =>
  createCoManagedDeliveryProvider().admitReplyToken(CUSTOMER, 'cm2:t', metadata('thr'), sender);

describe('admitReplyToken sender authentication', () => {
  describe('shared_it', () => {
    beforeEach(() => seed('shared_it'));

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

    it('an active contact of the ticket client is admitted with no actor', async () => {
      const result: any = await admit(untrusted('req@CUSTOMER.test'));
      expect(result).toMatchObject({ admitted: true, audience: 'requester', ticketId: 'tk' });
      expect(result.actor).toBeUndefined();
    });
    it('a contact of another client is refused', async () => { expect(await admit(untrusted('other@elsewhere.test'))).toEqual(refused); });
    it('the same email in another tenant is refused', async () => { expect(await admit(untrusted('foreign@customer.test'))).toEqual(refused); });
    it('an inactive contact is refused', async () => { expect(await admit(untrusted('gone@customer.test'))).toEqual(refused); });
    it('an additional address of an active contact of the ticket client is admitted', async () => {
      expect(await admit(untrusted('Req.Alt@home.test'))).toMatchObject({ admitted: true, audience: 'requester' });
    });
    it('an additional address of another client\'s contact is refused', async () => { expect(await admit(untrusted('other.alt@home.test'))).toEqual(refused); });
    it('an additional address of an inactive contact is refused', async () => { expect(await admit(untrusted('gone.alt@home.test'))).toEqual(refused); });
    it('no sender is refused', async () => { expect(await admit(untrusted(null))).toEqual(refused); });
    it('an internal user address is not a requester contact', async () => { expect(await admit(trusted('agent@msp.test'))).toEqual(refused); });
  });
});
