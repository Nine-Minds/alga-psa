/**
 * alga-2026-0002597: single-user MSP tenants could never approve their own quotes, and
 * there was no MSP-side "Mark as accepted". Real Postgres, real RBAC resolution:
 *  - allowSelfQuoteApproval predicate (sole approver / other approver / inactive / client)
 *  - approveQuote: sole approver succeeds with audit metadata, multi-approver tenant denied
 *  - getQuoteApprovalSettings.currentUserIsSoleApprover
 *  - markQuoteAccepted: sent -> accepted with activity, other statuses / clients / no-permission rejected
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
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

// Real RBAC resolution (roles -> permissions) against the test DB, not a stub.
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
  };
});

let db: Knex;
const tenantsToCleanup = new Set<string>();

const tt = (tenantId: string, table: string) => tenantDb(db, tenantId).table(table);
const tenantRows = () =>
  tenantDb(db, '__test_tenant_fixture__').unscoped('tenants', 'test fixture creates and removes tenant rows');

async function cleanupTenant(tenantId: string) {
  for (const table of [
    'quote_activities', 'quote_items', 'quotes', 'next_number', 'user_roles',
    'role_permissions', 'roles', 'permissions', 'users', 'tenant_settings',
  ]) {
    await tt(tenantId, table).del();
  }
  await tenantRows().where({ tenant: tenantId }).del();
}

interface TestUser { user_id: string; user_type: 'internal' | 'client'; tenant: string; roles: any[] }

async function createTenantFixture() {
  const tenantId = uuidv4();
  tenantsToCleanup.add(tenantId);
  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Self approval ${tenantId.slice(0, 8)}`,
    email: `t-${tenantId.slice(0, 8)}@example.com`,
  });
  return tenantId;
}

async function addUser(
  tenantId: string,
  opts: { permissions: Array<[string, string]>; userType?: 'internal' | 'client'; inactive?: boolean }
): Promise<TestUser> {
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
    is_inactive: opts.inactive ?? false,
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
  return { user_id: userId, user_type: userType, tenant: tenantId, roles: [{ role_id: roleId }] };
}

const APPROVER: Array<[string, string]> = [['billing', 'read'], ['billing', 'update'], ['quotes', 'approve']];
const NON_APPROVER: Array<[string, string]> = [['billing', 'read'], ['billing', 'update']];

async function addQuote(tenantId: string, status: string, createdBy: string) {
  const quoteId = uuidv4();
  await tt(tenantId, 'quotes').insert({
    tenant: tenantId, quote_id: quoteId, title: 'Self approval fixture', status, created_by: createdBy,
  });
  return quoteId;
}

const activities = (tenantId: string, quoteId: string, type?: string) => {
  const q = tt(tenantId, 'quote_activities').where({ quote_id: quoteId });
  return (type ? q.where({ activity_type: type }) : q).orderBy('created_at', 'asc');
};
const quoteRow = (tenantId: string, quoteId: string) => tt(tenantId, 'quotes').where({ quote_id: quoteId }).first();

describe('quote self-approval + mark-accepted (alga-2026-0002597)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDb = db;
  });
  afterEach(async () => {
    mockCurrentUser = null;
    for (const tenantId of tenantsToCleanup) await cleanupTenant(tenantId);
    tenantsToCleanup.clear();
  });
  afterAll(async () => {
    if (db) await db.destroy();
  });

  describe('allowSelfQuoteApproval', () => {
    it('is true when the subject is the only holder of quotes:approve', async () => {
      const { allowSelfQuoteApproval } = await import('@alga-psa/authorization/quoteSelfApproval');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: APPROVER });
      // Other internal users exist but cannot approve.
      await addUser(tenantId, { permissions: NON_APPROVER });
      expect(await allowSelfQuoteApproval(db, tenantId, me.user_id)).toBe(true);
    });

    it('is false when another active internal user holds quotes:approve', async () => {
      const { allowSelfQuoteApproval } = await import('@alga-psa/authorization/quoteSelfApproval');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: APPROVER });
      await addUser(tenantId, { permissions: APPROVER });
      expect(await allowSelfQuoteApproval(db, tenantId, me.user_id)).toBe(false);
    });

    it('ignores inactive approvers and client-portal users', async () => {
      const { allowSelfQuoteApproval } = await import('@alga-psa/authorization/quoteSelfApproval');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: APPROVER });
      await addUser(tenantId, { permissions: APPROVER, inactive: true });
      await addUser(tenantId, { permissions: APPROVER, userType: 'client' });
      expect(await allowSelfQuoteApproval(db, tenantId, me.user_id)).toBe(true);
    });

    it('does not count approvers from another tenant', async () => {
      const { allowSelfQuoteApproval } = await import('@alga-psa/authorization/quoteSelfApproval');
      const tenantId = await createTenantFixture();
      const otherTenant = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: APPROVER });
      await addUser(otherTenant, { permissions: APPROVER });
      expect(await allowSelfQuoteApproval(db, tenantId, me.user_id)).toBe(true);
    });
  });

  describe('approveQuote', () => {
    it('lets the sole approver approve their own quote and audits it as self-approved', async () => {
      const { approveQuote } = await import('@alga-psa/billing/actions/quoteActions');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: APPROVER });
      const quoteId = await addQuote(tenantId, 'pending_approval', me.user_id);
      mockCurrentUser = me;

      const result: any = await approveQuote(quoteId, 'Approving my own quote');

      expect(result.status).toBe('approved');
      expect((await quoteRow(tenantId, quoteId)).status).toBe('approved');
      const [approved] = await activities(tenantId, quoteId, 'approved');
      expect(approved.performed_by).toBe(me.user_id);
      expect(approved.metadata).toMatchObject({ self_approved: true, reason: 'sole approver' });
    });

    it('still denies self-approval when another active approver exists', async () => {
      const { approveQuote } = await import('@alga-psa/billing/actions/quoteActions');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: APPROVER });
      await addUser(tenantId, { permissions: APPROVER });
      const quoteId = await addQuote(tenantId, 'pending_approval', me.user_id);
      mockCurrentUser = me;

      const result: any = await approveQuote(quoteId);

      expect(result.permissionError).toMatch(/own quote/i);
      expect((await quoteRow(tenantId, quoteId)).status).toBe('pending_approval');
      expect(await activities(tenantId, quoteId, 'approved')).toHaveLength(0);
    });

    it('does not mark an ordinary approval by someone else as self-approved', async () => {
      const { approveQuote } = await import('@alga-psa/billing/actions/quoteActions');
      const tenantId = await createTenantFixture();
      const author = await addUser(tenantId, { permissions: NON_APPROVER });
      const approver = await addUser(tenantId, { permissions: APPROVER });
      const quoteId = await addQuote(tenantId, 'pending_approval', author.user_id);
      mockCurrentUser = approver;

      const result: any = await approveQuote(quoteId);

      expect(result.status).toBe('approved');
      const [approved] = await activities(tenantId, quoteId, 'approved');
      expect(approved.metadata).not.toHaveProperty('self_approved');
    });
  });

  describe('getQuoteApprovalSettings', () => {
    async function settingsFor(user: TestUser, approvalRequired: boolean) {
      const { getQuoteApprovalSettings, updateQuoteApprovalSettings } = await import('@alga-psa/billing/actions/quoteActions');
      mockCurrentUser = { ...user };
      await updateQuoteApprovalSettings(approvalRequired);
      return getQuoteApprovalSettings() as Promise<any>;
    }

    it('reports the current user as sole approver only when approval is required and nobody else can approve', async () => {
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: [...APPROVER, ['settings', 'update']] });
      expect(await settingsFor(me, true)).toMatchObject({ approvalRequired: true, currentUserIsSoleApprover: true });
      expect(await settingsFor(me, false)).toMatchObject({ approvalRequired: false, currentUserIsSoleApprover: false });
    });

    it('does not report sole approver when a second approver exists', async () => {
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: [...APPROVER, ['settings', 'update']] });
      await addUser(tenantId, { permissions: APPROVER });
      expect(await settingsFor(me, true)).toMatchObject({ approvalRequired: true, currentUserIsSoleApprover: false });
    });
  });

  describe('markQuoteAccepted', () => {
    it('moves a sent quote to accepted, stamps who/when and writes an accepted activity with the note', async () => {
      const { markQuoteAccepted } = await import('@alga-psa/billing/actions/quoteActions');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: NON_APPROVER });
      const quoteId = await addQuote(tenantId, 'sent', me.user_id);
      mockCurrentUser = me;

      const result: any = await markQuoteAccepted(quoteId, '  Verbal OK on the phone  ');

      expect(result.status).toBe('accepted');
      const row = await quoteRow(tenantId, quoteId);
      expect(row.status).toBe('accepted');
      expect(row.accepted_by).toBe(me.user_id);
      expect(row.accepted_at).toBeTruthy();

      const [accepted] = await activities(tenantId, quoteId, 'accepted');
      expect(accepted.performed_by).toBe(me.user_id);
      expect(accepted.metadata).toMatchObject({ accepted_via: 'msp', accepted_by: me.user_id, note: 'Verbal OK on the phone' });
      // The generic transition audit is still written by Quote.update.
      const [changed] = await activities(tenantId, quoteId, 'status_changed');
      expect(changed.metadata).toMatchObject({ previous_status: 'sent', next_status: 'accepted' });
    });

    it('accepts without a note', async () => {
      const { markQuoteAccepted } = await import('@alga-psa/billing/actions/quoteActions');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: NON_APPROVER });
      const quoteId = await addQuote(tenantId, 'sent', me.user_id);
      mockCurrentUser = me;

      const result: any = await markQuoteAccepted(quoteId);
      expect(result.status).toBe('accepted');
      const [accepted] = await activities(tenantId, quoteId, 'accepted');
      expect(accepted.metadata.note).toBeNull();
    });

    it.each(['draft', 'pending_approval', 'approved', 'accepted', 'rejected', 'expired', 'cancelled'])(
      'rejects a %s quote and changes nothing',
      async (status) => {
        const { markQuoteAccepted } = await import('@alga-psa/billing/actions/quoteActions');
        const tenantId = await createTenantFixture();
        const me = await addUser(tenantId, { permissions: NON_APPROVER });
        const quoteId = await addQuote(tenantId, status, me.user_id);
        mockCurrentUser = me;

        const result: any = await markQuoteAccepted(quoteId, 'nope');

        expect(result.error ?? result.message ?? JSON.stringify(result)).toMatch(/Only sent quotes can be marked as accepted/);
        expect((await quoteRow(tenantId, quoteId)).status).toBe(status);
        expect(await activities(tenantId, quoteId, 'accepted')).toHaveLength(0);
      }
    );

    it('requires billing:update', async () => {
      const { markQuoteAccepted } = await import('@alga-psa/billing/actions/quoteActions');
      const tenantId = await createTenantFixture();
      const me = await addUser(tenantId, { permissions: [['billing', 'read']] });
      const quoteId = await addQuote(tenantId, 'sent', me.user_id);
      mockCurrentUser = me;

      const result: any = await markQuoteAccepted(quoteId);

      expect(result.permissionError).toMatch(/Permission denied/);
      expect((await quoteRow(tenantId, quoteId)).status).toBe('sent');
    });

    it('rejects client-portal users', async () => {
      const { markQuoteAccepted } = await import('@alga-psa/billing/actions/quoteActions');
      const tenantId = await createTenantFixture();
      const internal = await addUser(tenantId, { permissions: NON_APPROVER });
      const client = await addUser(tenantId, { permissions: NON_APPROVER, userType: 'client' });
      const quoteId = await addQuote(tenantId, 'sent', internal.user_id);
      mockCurrentUser = client;

      const result: any = await markQuoteAccepted(quoteId);

      expect(result.permissionError).toMatch(/Permission denied/);
      expect((await quoteRow(tenantId, quoteId)).status).toBe('sent');
    });
  });
});
