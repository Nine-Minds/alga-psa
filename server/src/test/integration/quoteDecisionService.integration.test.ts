/**
 * alga-2026-0002820 (1/6): decideQuote + the quote_decisions audit trail.
 * Real Postgres. Covers portal accept/reject, an access-link actor whose contact has
 * no users row, MSP mark-accepted, and exactly-once behaviour for repeated and
 * concurrent accepts (onQuoteAccepted is spied on, everything else is real).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import fs from 'node:fs';
import path from 'node:path';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({ getAppSecret: async () => '' })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

const onQuoteAcceptedSpy = vi.fn();
vi.mock('@alga-psa/opportunities/lib/quoteLifecycleHooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/opportunities/lib/quoteLifecycleHooks')>();
  return {
    ...actual,
    onQuoteAccepted: (...args: Parameters<typeof actual.onQuoteAccepted>) => {
      onQuoteAcceptedSpy(...args);
      return actual.onQuoteAccepted(...args);
    },
  };
});

let testDb: Knex;
let mockCurrentUser: any = null;

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => async (...args: any[]) => {
    const user = mockCurrentUser;
    if (!user) throw new Error('User not authenticated');
    const { runWithTenant } = await import('@alga-psa/db');
    return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
  },
}));

vi.mock('@alga-psa/auth/rbac', async () => {
  const actual = await import('@alga-psa/authorization/rbac');
  return {
    hasPermission: (user: any, resource: string, action: string) =>
      actual.hasPermission(user, resource, action, testDb),
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async (tenant?: string) => ({ knex: testDb, tenant: tenant ?? mockCurrentUser?.tenant })),
    getConnection: vi.fn(async () => testDb),
  };
});

let db: Knex;
const tenantsToCleanup = new Set<string>();

const tt = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  for (const table of [
    'quote_decisions', 'quote_activities', 'quote_items', 'quotes', 'next_number', 'user_roles',
    'role_permissions', 'roles', 'permissions', 'users', 'contacts', 'clients', 'tenant_settings',
  ]) {
    await tt(tenantId, table).del();
  }
  await tenantRows().where({ tenant: tenantId }).del();
}

async function createTenantFixture() {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Quote decisions ${tenantId.slice(0, 8)}`,
    email: `t-${tenantId.slice(0, 8)}@example.com`,
  });
  return tenantId;
}

async function addUser(
  tenantId: string,
  opts: { permissions: Array<[string, string]>; userType?: 'internal' | 'client'; contactId?: string }
) {
  const userId = uuidv4();
  const roleId = uuidv4();
  const userType = opts.userType ?? 'internal';
  const isMsp = userType === 'internal';
  await tt(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `u-${userId.slice(0, 8)}`,
    hashed_password: 'not-used',
    user_type: userType,
    email: `u-${userId.slice(0, 8)}@example.com`,
    is_inactive: false,
    ...(opts.contactId ? { contact_id: opts.contactId } : {}),
  });
  await tt(tenantId, 'roles').insert({
    tenant: tenantId, role_id: roleId, role_name: `role-${roleId.slice(0, 8)}`, msp: isMsp, client: !isMsp,
  });
  await tt(tenantId, 'user_roles').insert({ tenant: tenantId, user_id: userId, role_id: roleId });
  for (const [resource, action] of opts.permissions) {
    const permissionId = uuidv4();
    await tt(tenantId, 'permissions').insert({
      tenant: tenantId, permission_id: permissionId, resource, action, msp: isMsp, client: !isMsp,
    });
    await tt(tenantId, 'role_permissions').insert({ tenant: tenantId, role_id: roleId, permission_id: permissionId });
  }
  return { user_id: userId, user_type: userType, tenant: tenantId, roles: [{ role_id: roleId }], contact_id: opts.contactId };
}

async function addClient(tenantId: string) {
  const clientId = uuidv4();
  await tt(tenantId, 'clients').insert({ tenant: tenantId, client_id: clientId, client_name: `Client ${clientId.slice(0, 6)}` });
  return clientId;
}

async function addContact(tenantId: string, clientId: string) {
  const contactId = uuidv4();
  await tt(tenantId, 'contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: 'Casey Contact',
    email: `c-${contactId.slice(0, 6)}@example.com`,
    client_id: clientId,
  });
  return contactId;
}

async function addQuote(tenantId: string, clientId: string, status = 'sent') {
  const quoteId = uuidv4();
  await tt(tenantId, 'quotes').insert({
    tenant: tenantId, quote_id: quoteId, client_id: clientId, title: 'Decision fixture', status,
  });
  const required = uuidv4();
  const optional = uuidv4();
  await tt(tenantId, 'quote_items').insert([
    { tenant: tenantId, quote_item_id: required, quote_id: quoteId, description: 'Core', quantity: 1, unit_price: 15000, total_price: 15000, net_amount: 15000, is_optional: false, is_selected: true, display_order: 0 },
    { tenant: tenantId, quote_item_id: optional, quote_id: quoteId, description: 'Optional', quantity: 1, unit_price: 5000, total_price: 5000, net_amount: 5000, is_optional: true, is_selected: true, display_order: 1 },
  ]);
  return { quoteId, required, optional };
}

const decisions = (tenantId: string, quoteId: string) => tt(tenantId, 'quote_decisions').where({ quote_id: quoteId });
const activities = (tenantId: string, quoteId: string, type: string) =>
  tt(tenantId, 'quote_activities').where({ quote_id: quoteId, activity_type: type });
const quoteRow = (tenantId: string, quoteId: string) => tt(tenantId, 'quotes').where({ quote_id: quoteId }).first();

async function decide(input: any) {
  const { decideQuote } = await import('@alga-psa/billing/services');
  return db.transaction((trx) => decideQuote(input, trx));
}

describe('decideQuote (alga-2026-0002820 1/6)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDb = db;
  });
  beforeEach(() => {
    onQuoteAcceptedSpy.mockClear();
  });
  afterEach(async () => {
    mockCurrentUser = null;
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });
  afterAll(async () => {
    if (db) await db.destroy();
  });

  it('portal_user accept with optional selections: accepted_by = user, one portal decision row, hook once', async () => {
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const contactId = await addContact(tenantId, clientId);
    const portalUser = await addUser(tenantId, { permissions: [['billing', 'read']], userType: 'client', contactId });
    const { quoteId, optional } = await addQuote(tenantId, clientId);

    const result: any = await decide({
      tenantId, quoteId, action: 'accept',
      actor: { kind: 'portal_user', userId: portalUser.user_id },
      selections: { selectedOptionalQuoteItemIds: [] },
    });

    expect(result.status).toBe('decided');
    const row = await quoteRow(tenantId, quoteId);
    expect(row.status).toBe('accepted');
    expect(row.accepted_by).toBe(portalUser.user_id);
    expect(Number(row.subtotal)).toBe(15000); // optional deselected, totals recalculated
    const item = await tt(tenantId, 'quote_items').where({ quote_item_id: optional }).first();
    expect(item.is_selected).toBe(false);

    const rows = await decisions(tenantId, quoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision: 'accepted', method: 'portal', actor_user_id: portalUser.user_id, contact_id: null, link_id: null,
    });
    expect(rows[0].selections).toEqual({
      selected_optional_quote_item_ids: [],
      deselected_optional_quote_item_ids: [optional],
    });

    const [accepted] = await activities(tenantId, quoteId, 'accepted');
    expect(accepted.description).toBe('Quote accepted by client for MSP review');
    expect(accepted.performed_by).toBe(portalUser.user_id);
    expect(accepted.metadata).toEqual({
      selected_optional_quote_item_ids: [],
      deselected_optional_quote_item_ids: [optional],
      decision_id: rows[0].decision_id,
    });
    expect(await activities(tenantId, quoteId, 'status_changed')).toHaveLength(1);
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
  });

  it('portal_user reject with a comment', async () => {
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const contactId = await addContact(tenantId, clientId);
    const portalUser = await addUser(tenantId, { permissions: [['billing', 'read']], userType: 'client', contactId });
    const { quoteId } = await addQuote(tenantId, clientId);

    const result: any = await decide({
      tenantId, quoteId, action: 'reject',
      actor: { kind: 'portal_user', userId: portalUser.user_id },
      comment: ' Budget is not approved yet. ',
    });

    expect(result.status).toBe('decided');
    const row = await quoteRow(tenantId, quoteId);
    expect(row).toMatchObject({ status: 'rejected', rejection_reason: 'Budget is not approved yet.', accepted_by: null });
    expect(row.rejected_at).toBeTruthy();
    const rows = await decisions(tenantId, quoteId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ decision: 'rejected', method: 'portal', comment: 'Budget is not approved yet.' });
    const [rejected] = await activities(tenantId, quoteId, 'rejected');
    expect(rejected.description).toBe('Quote rejected by client');
    expect(rejected.metadata).toEqual({ rejection_reason: 'Budget is not approved yet.', decision_id: rows[0].decision_id });
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('portal_user without billing:read, or for another client\'s quote, is refused and writes nothing', async () => {
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const otherClientId = await addClient(tenantId);
    const contactId = await addContact(tenantId, clientId);
    const noPerm = await addUser(tenantId, { permissions: [], userType: 'client', contactId });
    const { quoteId } = await addQuote(tenantId, clientId);
    const other = await addQuote(tenantId, otherClientId);

    expect(await decide({ tenantId, quoteId, action: 'accept', actor: { kind: 'portal_user', userId: noPerm.user_id } }))
      .toEqual({ status: 'forbidden', reason: 'no_billing_permission' });

    const withPerm = await addUser(tenantId, { permissions: [['billing', 'read']], userType: 'client', contactId });
    expect(await decide({ tenantId, quoteId: other.quoteId, action: 'accept', actor: { kind: 'portal_user', userId: withPerm.user_id } }))
      .toEqual({ status: 'not_found' });

    expect((await quoteRow(tenantId, quoteId)).status).toBe('sent');
    expect(await tt(tenantId, 'quote_decisions')).toHaveLength(0);
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('access_link actor whose contact has no users row: accepted, accepted_by NULL, decision row carries link/contact/signer/ip/ua', async () => {
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const contactId = await addContact(tenantId, clientId);
    const linkId = uuidv4();
    const { quoteId, optional } = await addQuote(tenantId, clientId);
    expect(await tt(tenantId, 'users').where({ contact_id: contactId })).toHaveLength(0);

    const result: any = await decide({
      tenantId, quoteId, action: 'accept',
      actor: { kind: 'access_link', linkId, contactId, email: 'casey@example.com' },
      selections: { selectedOptionalQuoteItemIds: [optional] },
      signer: { name: 'Casey Contact', email: 'casey@example.com', title: 'CFO' },
      context: { ip: '203.0.113.9', userAgent: 'vitest/1.0', agreementTextHash: 'sha256:abc' },
    });

    expect(result.status).toBe('decided');
    const row = await quoteRow(tenantId, quoteId);
    expect(row.status).toBe('accepted');
    expect(row.accepted_by).toBeNull();
    expect(row.accepted_at).toBeTruthy();
    const [decision] = await decisions(tenantId, quoteId);
    expect(decision).toMatchObject({
      decision: 'accepted', method: 'email_link', actor_user_id: null, contact_id: contactId, link_id: linkId,
      signer_name: 'Casey Contact', signer_email: 'casey@example.com', signer_title: 'CFO',
      ip: '203.0.113.9', user_agent: 'vitest/1.0', agreement_text_hash: 'sha256:abc',
    });
    const [accepted] = await activities(tenantId, quoteId, 'accepted');
    expect(accepted.performed_by).toBeNull();
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
  });

  it('access_link actor: a contact from another client, a template and a draft are refused', async () => {
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const otherClientId = await addClient(tenantId);
    const foreignContact = await addContact(tenantId, otherClientId);
    const { quoteId } = await addQuote(tenantId, clientId);
    const template = await addQuote(tenantId, clientId);
    await tt(tenantId, 'quotes').where({ quote_id: template.quoteId }).update({ is_template: true });
    const draft = await addQuote(tenantId, clientId, 'draft');
    const actor = { kind: 'access_link', linkId: uuidv4(), email: 'x@example.com' };

    expect(await decide({ tenantId, quoteId, action: 'accept', actor: { ...actor, contactId: foreignContact } }))
      .toEqual({ status: 'not_found' });
    expect(await decide({ tenantId, quoteId: template.quoteId, action: 'accept', actor })).toEqual({ status: 'not_found' });
    expect(await decide({ tenantId, quoteId: draft.quoteId, action: 'accept', actor })).toEqual({ status: 'not_found' });
    expect(await decide({ tenantId: uuidv4(), quoteId, action: 'accept', actor })).toEqual({ status: 'not_found' });
    expect(await tt(tenantId, 'quote_decisions')).toHaveLength(0);
    expect(onQuoteAcceptedSpy).not.toHaveBeenCalled();
  });

  it('msp_user via markQuoteAccepted: method msp_marked and the pre-existing activity text/metadata', async () => {
    const { markQuoteAccepted } = await import('@alga-psa/billing/actions/quoteActions');
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const me = await addUser(tenantId, { permissions: [['billing', 'read'], ['billing', 'update']] });
    const { quoteId } = await addQuote(tenantId, clientId);
    mockCurrentUser = me;

    const result: any = await markQuoteAccepted(quoteId, '  Verbal OK on the phone  ');

    expect(result.status).toBe('accepted');
    const row = await quoteRow(tenantId, quoteId);
    expect(row.accepted_by).toBe(me.user_id);
    const [decision] = await decisions(tenantId, quoteId);
    expect(decision).toMatchObject({ decision: 'accepted', method: 'msp_marked', actor_user_id: me.user_id, comment: 'Verbal OK on the phone' });
    const [accepted] = await activities(tenantId, quoteId, 'accepted');
    expect(accepted.description).toBe('Quote marked as accepted by MSP on behalf of the client: Verbal OK on the phone');
    expect(accepted.performed_by).toBe(me.user_id);
    expect(accepted.metadata).toEqual({
      accepted_via: 'msp',
      accepted_by: me.user_id,
      accepted_at: row.accepted_at.toISOString(),
      note: 'Verbal OK on the phone',
      decision_id: decision.decision_id,
    });
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
  });

  it('a second decide on a decided quote returns not_pending and writes nothing', async () => {
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const { quoteId } = await addQuote(tenantId, clientId);
    const actor = { kind: 'access_link', linkId: uuidv4(), email: 'x@example.com' };

    expect((await decide({ tenantId, quoteId, action: 'accept', actor }) as any).status).toBe('decided');
    expect(await decide({ tenantId, quoteId, action: 'accept', actor })).toEqual({ status: 'not_pending', currentStatus: 'accepted' });
    expect(await decide({ tenantId, quoteId, action: 'reject', actor, comment: 'changed my mind' }))
      .toEqual({ status: 'not_pending', currentStatus: 'accepted' });

    expect(await decisions(tenantId, quoteId)).toHaveLength(1);
    expect(await activities(tenantId, quoteId, 'accepted')).toHaveLength(1);
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
  });

  it('concurrent accepts: exactly one wins, the other gets already_decided, hook fires once', async () => {
    const tenantId = await createTenantFixture();
    const clientId = await addClient(tenantId);
    const { quoteId, optional } = await addQuote(tenantId, clientId);
    const attempt = (selected: string[]) => decide({
      tenantId, quoteId, action: 'accept',
      actor: { kind: 'access_link', linkId: uuidv4(), email: 'x@example.com' },
      selections: { selectedOptionalQuoteItemIds: selected },
    });

    const results: any[] = await Promise.all([attempt([]), attempt([optional]), attempt([]), attempt([optional])]);

    expect(results.filter((r) => r.status === 'decided')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'already_decided')).toHaveLength(3);
    expect(await decisions(tenantId, quoteId)).toHaveLength(1);
    expect(await activities(tenantId, quoteId, 'accepted')).toHaveLength(1);
    expect(onQuoteAcceptedSpy).toHaveBeenCalledTimes(1);
    // The winner's selection is what was persisted, not a loser's.
    const [decision] = await decisions(tenantId, quoteId);
    const item = await tt(tenantId, 'quote_items').where({ quote_item_id: optional }).first();
    expect(item.is_selected).toBe(decision.selections.selected_optional_quote_item_ids.includes(optional));
  });
  // quote_decisions.actor_user_id / contact_id are NO ACTION composite FKs on Citus (and
  // on PG < 15), so every hard-delete path must clear them itself. Plain PG15+ declares
  // SET NULL (col) and would hide a missing clear, hence the explicit code-path asserts.
  describe('hard-delete paths clear quote_decisions links', () => {
    it('deleting a contact nulls contact_id via clearContactLinksBeforeDelete and keeps the row and signer', async () => {
      const { clearContactLinksBeforeDelete } = await import('../../../../shared/models/contactModel');
      const tenantId = await createTenantFixture();
      const clientId = await addClient(tenantId);
      const contactId = await addContact(tenantId, clientId);
      const { quoteId } = await addQuote(tenantId, clientId);
      await decide({
        tenantId, quoteId, action: 'accept',
        actor: { kind: 'access_link', linkId: uuidv4(), contactId, email: 'casey@example.com' },
        signer: { name: 'Casey Contact', email: 'casey@example.com' },
      });
      expect((await decisions(tenantId, quoteId))[0].contact_id).toBe(contactId);

      await db.transaction(async (trx) => {
        await clearContactLinksBeforeDelete(trx, tenantId, contactId);
        // Asserted before the delete so it proves the code path, not the FK action.
        expect((await tenantDb(trx, tenantId).table('quote_decisions').where({ quote_id: quoteId }))[0].contact_id).toBeNull();
        await tenantDb(trx, tenantId).table('contacts').where({ contact_name_id: contactId }).del();
      });

      const [row] = await decisions(tenantId, quoteId);
      expect(row).toMatchObject({ contact_id: null, signer_name: 'Casey Contact', signer_email: 'casey@example.com' });
    });

    it('deleting a user who decided a quote succeeds and leaves the decision row with actor_user_id NULL', async () => {
      const tenantId = await createTenantFixture();
      const clientId = await addClient(tenantId);
      const contactId = await addContact(tenantId, clientId);
      const portalUser = await addUser(tenantId, { permissions: [['billing', 'read']], userType: 'client', contactId });
      const { quoteId } = await addQuote(tenantId, clientId);
      await decide({ tenantId, quoteId, action: 'accept', actor: { kind: 'portal_user', userId: portalUser.user_id } });

      // Mirror userActions' pre-delete clearing (see the contract test below for the list itself).
      await db.transaction(async (trx) => {
        await tenantDb(trx, tenantId).table('quote_decisions').where({ actor_user_id: portalUser.user_id }).update({ actor_user_id: null });
        await tenantDb(trx, tenantId).table('quotes').where({ accepted_by: portalUser.user_id }).update({ accepted_by: null });
        await tenantDb(trx, tenantId).table('quote_activities').where({ performed_by: portalUser.user_id }).update({ performed_by: null });
        await tenantDb(trx, tenantId).table('user_roles').where({ user_id: portalUser.user_id }).del();
        await tenantDb(trx, tenantId).table('users').where({ user_id: portalUser.user_id }).del();
      });

      const [row] = await decisions(tenantId, quoteId);
      expect(row).toMatchObject({ actor_user_id: null, method: 'portal' });
    });

    it('contract: the delete paths reference quote_decisions', () => {
      const root = path.resolve(__dirname, '../../../..');
      const userActions = fs.readFileSync(path.join(root, 'packages/users/src/actions/user-actions/userActions.ts'), 'utf8');
      expect(userActions).toContain("['quote_decisions', 'actor_user_id']");
      const contactModel = fs.readFileSync(path.join(root, 'shared/models/contactModel.ts'), 'utf8');
      const fn = contactModel.slice(contactModel.indexOf('export async function clearContactLinksBeforeDelete'));
      expect(fn.slice(0, fn.indexOf('\n}\n'))).toMatch(/table\('quote_decisions'\)[\s\S]*contact_id: null/);
    });
  });
});
