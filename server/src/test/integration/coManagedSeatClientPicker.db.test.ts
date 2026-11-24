/**
 * Add Ticket client picker honours the co-managed seat (plan pl-75ae9a33, T001-T003).
 *
 * A seat technician is an internal user of the sponsoring MSP tenant. The picker actions are called
 * as the technician: the tickets package's `searchClientsForPicker` (QuickAddTicket) and the clients
 * package's twin. Real Postgres, real built-in seat resolver, real bundle resolution; only the session
 * and the coarse RBAC grant are stood in for. The sponsor is a hosted Pro PSA tenant with a verified
 * hosted entitlement (`createTenant` seeds `plan: 'pro'`), so the arrangement is genuinely live.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createCoManagedSeatArrangement } from '@alga-psa/co-managed';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import {
  createAuthorizationBundle, createBundleAssignment, publishBundleRevision, upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createContact, createTenant, createUser } from '../../../test-utils/testDataFactory';

const ref = vi.hoisted(() => ({ knex: null as Knex | null, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ref.knex, tenant: ref.tenant })),
}));
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  withAuth: (action: any) => (...args: any[]) => action(ref.user, { tenant: ref.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/formatting/avatarUtils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getClientLogoUrlsBatch: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, null]))),
}));

import { searchClientsForPicker as clientsPicker } from '@alga-psa/clients/actions/clientPickerActions';
import { searchClientsForPicker as ticketsPicker } from '@alga-psa/tickets/actions/clientLookupActions';

const DAY = 86_400_000;
const describeDb = await describeWithDb();
const PICKERS = { 'tickets (Add Ticket)': ticketsPicker, clients: clientsPicker } as const;

describeDb('the client picker respects the co-managed seat', { shuffle: false }, () => {
  let db: Knex;
  let sponsor = '';
  let arrangementId = '';
  let arranged = { id: '', name: '' };
  let other = { id: '', name: '' };
  let msp = '';
  let contacts = { arranged: '', other: '' };
  let admin = '';

  const as = async (userId: string) => {
    ref.user = await db('users').where({ tenant: ref.tenant, user_id: userId }).first();
  };

  async function seatTechnician(): Promise<{ userId: string; assignmentId: string }> {
    const userId = await createUser(db, sponsor, { user_type: 'internal' });
    const assignmentId = randomUUID();
    await db.transaction(async (trx) => {
      await retainBuiltinResolverSubject(trx, { tenant: sponsor, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
      await trx('co_managed_seat_assignments').insert({
        tenant: sponsor, assignment_id: assignmentId, arrangement_id: arrangementId, user_id: userId, state: 'active',
      });
    });
    return { userId, assignmentId };
  }

  async function bundleFor(
    userId: string,
    rules: Array<{ resourceType: string; templateKey: string; config: Record<string, unknown>; constraintKey?: string }>,
    baseline?: 'open' | 'closed'
  ) {
    const bundle = await createAuthorizationBundle(db, { tenant: sponsor, name: `picker-${randomUUID().slice(0, 8)}`, actorUserId: admin });
    for (const rule of rules) {
      await upsertBundleRule(db, { tenant: sponsor, bundleId: bundle.bundleId, revisionId: bundle.revisionId, action: 'read', actorUserId: admin, ...rule });
    }
    await publishBundleRevision(db as any, { tenant: sponsor, bundleId: bundle.bundleId, revisionId: bundle.revisionId, actorUserId: admin, ...(baseline ? { baseline } : {}) });
    await createBundleAssignment(db, { tenant: sponsor, bundleId: bundle.bundleId, targetType: 'user', targetId: userId, actorUserId: admin });
  }

  /** Every way the picker is used must show the same thing: first page, total, a search, a lookup of mixed ids. */
  async function expectOnly(allowed: Array<{ id: string; name: string }>, hidden: { id: string; name: string }) {
    for (const [label, picker] of Object.entries(PICKERS)) {
      const page = await picker({});
      expect(page.clients.map((c) => c.client_id).sort(), `${label} first page`).toEqual(allowed.map((c) => c.id).sort());
      expect(page.total, `${label} total`).toBe(allowed.length);
      const search = await picker({ search: hidden.name });
      expect(search.clients, `${label} search for the hidden client`).toEqual([]);
      expect(search.total, `${label} search total`).toBe(0);
      const lookup = await picker({ ids: [arranged.id, other.id] });
      expect(lookup.clients.map((c) => c.client_id).sort(), `${label} mixed lookup`)
        .toEqual(allowed.filter((c) => c.id === arranged.id).map((c) => c.id).sort());
    }
  }

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'seat_client_picker_scope_test' });
    ref.knex = db;
    sponsor = await createTenant(db, `Picker sponsor ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    ref.tenant = sponsor;
    expect(await db('tenants').where({ tenant: sponsor }).first('plan', 'product_code')).toEqual({ plan: 'pro', product_code: 'psa' });
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 10,
      verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    arranged = { name: `Arranged ${randomUUID().slice(0, 8)}`, id: '' };
    other = { name: `Elsewhere ${randomUUID().slice(0, 8)}`, id: '' };
    arranged.id = await createClient(db, sponsor, arranged.name);
    other.id = await createClient(db, sponsor, other.name);
    arrangementId = (await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId: arranged.id, operationId: randomUUID(), seats: 5 })).arrangement_id;
    contacts = { arranged: await createContact(db, sponsor, arranged.id), other: await createContact(db, sponsor, other.id) };
    msp = await createUser(db, sponsor, { user_type: 'internal' });
    admin = await createUser(db, sponsor, { user_type: 'internal' });
  }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('T001: a live seat and zero bundles sees only the arranged client', async () => {
    expect(Number((await db('authorization_bundle_assignments').where({ tenant: sponsor }).count('* as n').first())?.n)).toBe(0);
    const tech = await seatTechnician();
    await as(tech.userId);
    await expectOnly([arranged], other);
  });

  it('T002: an unrelated assignment or a bundle without a client rule leaves the seat boundary; a rule for the other client is empty', async () => {
    const unrelated = await createUser(db, sponsor, { user_type: 'internal' });
    await bundleFor(unrelated, [{ resourceType: 'client', templateKey: 'selected_clients', config: { selectedClientIds: [other.id] } }]);
    const noRule = await seatTechnician();
    await bundleFor(noRule.userId, [{ resourceType: 'asset', templateKey: 'selected_clients', config: { selectedClientIds: [other.id] } }]);
    await as(noRule.userId);
    await expectOnly([arranged], other);

    const wrongClient = await seatTechnician();
    await bundleFor(wrongClient.userId, [{ resourceType: 'client', templateKey: 'selected_clients', config: { selectedClientIds: [other.id] } }]);
    await as(wrongClient.userId);
    for (const [label, picker] of Object.entries(PICKERS)) {
      expect(await picker({}), label).toMatchObject({ clients: [], total: 0 });
      expect((await picker({ ids: [arranged.id, other.id] })).clients, label).toEqual([]);
    }

    const matching = await seatTechnician();
    await bundleFor(matching.userId, [{ resourceType: 'client', templateKey: 'selected_clients', config: { selectedClientIds: [arranged.id, other.id] } }]);
    await as(matching.userId);
    await expectOnly([arranged], other);
  });

  it('T003: a revoked seat gets nothing on its next request; ordinary MSP staff keep both clients', async () => {
    const tech = await seatTechnician();
    await as(tech.userId);
    await expectOnly([arranged], other);
    await db('co_managed_seat_assignments').where({ tenant: sponsor, assignment_id: tech.assignmentId }).update({ state: 'revoked', revoked_at: new Date() });
    for (const [label, picker] of Object.entries(PICKERS)) {
      expect(await picker({}), label).toMatchObject({ clients: [], total: 0 });
      expect((await picker({ ids: [arranged.id, other.id] })).clients, label).toEqual([]);
    }

    await as(msp);
    for (const [label, picker] of Object.entries(PICKERS)) {
      const page = await picker({});
      expect(page.clients.map((c) => c.client_id).sort(), label).toEqual([arranged.id, other.id].sort());
      expect(page.total, label).toBe(2);
      expect((await picker({ ids: [arranged.id, other.id] })).clients, label).toHaveLength(2);
    }
  });

  /** What an ordinary (non-seat) user reads: both pickers' first page and the contact scope the contact list applies. */
  async function visibleTo(userId: string) {
    await as(userId);
    const pickers: Record<string, string[]> = {};
    for (const [label, picker] of Object.entries(PICKERS)) {
      pickers[label] = (await picker({})).clients.map((c) => c.client_id).sort();
    }
    const scope = await createClientScopeContext(db, sponsor, ref.user);
    const contactRows = await (await scope.narrowing('contact', 'c'))
      .apply(db('contacts as c').where('c.tenant', sponsor))
      .pluck('c.contact_name_id');
    return { pickers, contacts: contactRows.sort() };
  }

  it('T005: a non-seat user with a published closed bundle that names neither client nor contact reads no clients or contacts', async () => {
    // Plan D4 of the client-scope-completion PRD: a closed bundle denies every resource it does not name.
    const user = await createUser(db, sponsor, { user_type: 'internal' });
    await bundleFor(user, [{ resourceType: 'ticket', templateKey: 'selected_clients', config: { selectedClientIds: [arranged.id] } }], 'closed');
    const seen = await visibleTo(user);
    for (const [label, ids] of Object.entries(seen.pickers)) expect(ids, label).toEqual([]);
    expect(seen.contacts).toEqual([]);
  });

  it('T006: a non-seat user whose only client and contact rules redact fields (hide_sensitive_fields) keeps the rows the template selects', async () => {
    const both = [arranged.id, other.id];
    const redacting = await createUser(db, sponsor, { user_type: 'internal' });
    await bundleFor(redacting, [
      { resourceType: 'client', templateKey: 'selected_clients', constraintKey: 'hide_sensitive_fields', config: { selectedClientIds: both } },
      { resourceType: 'contact', templateKey: 'selected_clients', constraintKey: 'hide_sensitive_fields', config: { selectedClientIds: both } },
    ]);
    const plain = await createUser(db, sponsor, { user_type: 'internal' });
    await bundleFor(plain, [
      { resourceType: 'client', templateKey: 'selected_clients', config: { selectedClientIds: both } },
      { resourceType: 'contact', templateKey: 'selected_clients', config: { selectedClientIds: both } },
    ]);
    const withRedaction = await visibleTo(redacting);
    for (const [label, ids] of Object.entries(withRedaction.pickers)) expect(ids, label).toEqual([...both].sort());
    expect(withRedaction.contacts).toEqual([contacts.arranged, contacts.other].sort());
    // The redaction constraint removes no row the same rule without it would return.
    expect(withRedaction).toEqual(await visibleTo(plain));
  });
});
