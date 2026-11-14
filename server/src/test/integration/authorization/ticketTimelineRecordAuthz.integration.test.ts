import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import { tenantDb } from '@alga-psa/db';

// Record-level authz for getTicketTimelineEntries / getTicketActivityRows (alga-2026-0002995).
// Real DB, real kernel, real bundle resolution. Only the session (withAuth) and the coarse
// ticket:read RBAC check are stubbed, so the user "has ticket:read" and only the bundle narrows.

let currentUser: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  getCurrentUser: vi.fn(async () => currentUser),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('ticket timeline/activity record-level authorization', () => {
  let ctx: TestContext;
  const tenantTable = (table: string) => tenantDb(ctx.db, ctx.tenantId).table(table);

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'authorization_bundle_assignments',
        'authorization_bundle_rules',
        'authorization_bundle_revisions',
        'authorization_bundles',
        'user_roles',
        'roles',
      ],
    });
  }, HOOK_TIMEOUT);
  afterAll(async () => { await helpers.afterAll(); }, HOOK_TIMEOUT);
  beforeEach(async () => { ctx = await helpers.beforeEach(); }, HOOK_TIMEOUT);
  afterEach(async () => { await helpers.afterEach(); }, HOOK_TIMEOUT);

  async function insertTicket(enteredBy: string): Promise<string> {
    const ticketId = randomUUID();
    await tenantTable('tickets').insert({
      tenant: ctx.tenantId,
      ticket_id: ticketId,
      ticket_number: `TIC-${ticketId.slice(0, 8)}`,
      title: 'Authz timeline fixture',
      client_id: ctx.clientId,
      entered_by: enteredBy,
    });
    return ticketId;
  }

  /** Bundle with the `own` template on ticket:read, assigned directly to the user. */
  async function restrictToOwnTickets(userId: string) {
    const created = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `Bundle-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });
    await upsertBundleRule(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
      config: {},
      actorUserId: ctx.user.user_id,
    });
    await publishBundleRevision(ctx.db as any, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      actorUserId: ctx.user.user_id,
    });
    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      targetType: 'user',
      targetId: userId,
      actorUserId: ctx.user.user_id,
    });
  }

  it('hides a policy-restricted ticket exactly like a nonexistent one, but still serves allowed tickets', async () => {
    const { getTicketTimelineEntries, getTicketActivityRows } = await import(
      '@alga-psa/tickets/actions/ticketActivityActions'
    );

    const otherUserTicket = await insertTicket(await otherUserId());
    const ownTicket = await insertTicket(ctx.user.user_id);
    await restrictToOwnTickets(ctx.user.user_id);

    currentUser = { ...ctx.user, user_type: 'internal', tenant: ctx.tenantId, roles: [] };

    for (const action of [getTicketTimelineEntries, getTicketActivityRows] as any[]) {
      const missing = await action(randomUUID());
      const hidden = await action(otherUserTicket);
      expect(missing).toMatchObject({ messageKey: 'features/tickets:errors.action.ticketNotFound' });
      expect(hidden).toEqual(missing);

      const allowed = await action(ownTicket);
      expect(Array.isArray(allowed)).toBe(true);
    }
  });

  async function otherUserId(): Promise<string> {
    const userId = randomUUID();
    await tenantTable('users').insert({
      tenant: ctx.tenantId,
      user_id: userId,
      username: `other-${userId.slice(0, 8)}`,
      hashed_password: 'not-used',
      email: `other-${userId.slice(0, 8)}@example.com`,
      user_type: 'internal',
    });
    return userId;
  }
});
