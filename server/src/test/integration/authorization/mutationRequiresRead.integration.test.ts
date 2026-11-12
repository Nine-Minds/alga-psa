import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';
import {
  authorizeTicketRecordAccess,
  createTicketAuthorizationContext,
} from '@alga-psa/authorization/ticketRecordAuthorization';
import { tenantDb } from '@alga-psa/db';

// T009 (plan pl-7e177ec5, F011): update and delete require read.
// Real DB, real kernel, real bundle storage and resolution. Only the coarse RBAC check is
// stubbed, so the user "has" ticket permissions and only the bundle rules decide.

vi.mock('@alga-psa/authorization/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;
const DENIED = 'Permission denied: Cannot access ticket';

describe('update and delete require read (T009)', () => {
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

  const subjectUser = () => ({ ...ctx.user, user_type: 'internal', tenant: ctx.tenantId, roles: [] }) as any;

  async function insertUser(): Promise<string> {
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

  /** A ticket assigned to the subject; `enteredBy` decides whether the subject also owns it. */
  async function insertAssignedTicket(enteredBy: string): Promise<string> {
    const ticketId = randomUUID();
    await tenantTable('tickets').insert({
      tenant: ctx.tenantId,
      ticket_id: ticketId,
      ticket_number: `TIC-${ticketId.slice(0, 8)}`,
      title: 'Update requires read fixture',
      client_id: ctx.clientId,
      entered_by: enteredBy,
      assigned_to: ctx.user.user_id,
    });
    return ticketId;
  }

  /** Publishes a bundle with the given ticket rules and assigns it to the subject. */
  async function assignTicketRules(rules: Array<{ action: string; templateKey: string }>) {
    const created = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `Bundle-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });
    for (const rule of rules) {
      await upsertBundleRule(ctx.db, {
        tenant: ctx.tenantId,
        bundleId: created.bundleId,
        revisionId: created.revisionId,
        resourceType: 'ticket',
        action: rule.action,
        templateKey: rule.templateKey,
        config: {},
        actorUserId: ctx.user.user_id,
      });
    }
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
      targetId: ctx.user.user_id,
      actorUserId: ctx.user.user_id,
    });
  }

  async function kernelDecisions(ticketId: string, action: 'update' | 'delete') {
    const context = await createTicketAuthorizationContext(ctx.db, ctx.tenantId, subjectUser());
    const ticket = await tenantTable('tickets').where({ ticket_id: ticketId }).first();
    const input = {
      subject: context.authorizationSubject,
      resource: { type: 'ticket', action, id: ticketId },
      record: {
        id: ticketId,
        ownerUserId: ticket.entered_by,
        assignedUserIds: [ticket.assigned_to],
        clientId: ticket.client_id,
      },
      requestCache: context.requestCache,
      knex: ctx.db,
    };
    return {
      actionAlone: await context.authorizationKernel.authorizeResource(input),
      mutation: await context.authorizationKernel.authorizeMutation(input),
    };
  }

  const access = (ticketId: string, action: 'read' | 'update' | 'delete') =>
    authorizeTicketRecordAccess({ trx: ctx.db, tenant: ctx.tenantId, user: subjectUser(), ticketId, action });

  it('refuses update and delete when the update rule matches the ticket but the read rule does not', async () => {
    // Read: only tickets the subject entered. Update: tickets assigned to the subject.
    await assignTicketRules([
      { action: 'read', templateKey: 'own' },
      { action: 'update', templateKey: 'assigned' },
    ]);
    const unreadable = await insertAssignedTicket(await insertUser());

    for (const action of ['update', 'delete'] as const) {
      const { actionAlone, mutation } = await kernelDecisions(unreadable, action);
      // The write rule on its own allows the ticket (delete falls back to the update rule).
      expect(actionAlone.allowed).toBe(true);
      expect(mutation.allowed).toBe(false);
      expect(mutation.reasons).toContainEqual(
        expect.objectContaining({
          code: 'prerequisite_action_denied',
          metadata: { resource: 'ticket', action, requiredAction: 'read' },
        })
      );
    }

    await expect(access(unreadable, 'read')).rejects.toThrow(DENIED);
    await expect(access(unreadable, 'update')).rejects.toThrow(DENIED);
    await expect(access(unreadable, 'delete')).rejects.toThrow(DENIED);
  });

  it('refuses delete under an exact delete rule when the read rule does not match', async () => {
    await assignTicketRules([
      { action: 'read', templateKey: 'own' },
      { action: 'delete', templateKey: 'assigned' },
    ]);
    const unreadable = await insertAssignedTicket(await insertUser());

    const { actionAlone, mutation } = await kernelDecisions(unreadable, 'delete');
    expect(actionAlone.allowed).toBe(true);
    expect(mutation.allowed).toBe(false);
    await expect(access(unreadable, 'delete')).rejects.toThrow(DENIED);
  });

  it('allows update and delete when the read rule matches as well', async () => {
    await assignTicketRules([
      { action: 'read', templateKey: 'own' },
      { action: 'update', templateKey: 'assigned' },
    ]);
    const readable = await insertAssignedTicket(ctx.user.user_id);

    for (const action of ['update', 'delete'] as const) {
      expect((await kernelDecisions(readable, action)).mutation.allowed).toBe(true);
      await expect(access(readable, action)).resolves.toMatchObject({ ticket_id: readable });
    }
  });

  it('still applies the update rule to a ticket the subject can read', async () => {
    // Read: assigned tickets. Update: only tickets the subject entered.
    await assignTicketRules([
      { action: 'read', templateKey: 'assigned' },
      { action: 'update', templateKey: 'own' },
    ]);
    const readOnly = await insertAssignedTicket(await insertUser());

    await expect(access(readOnly, 'read')).resolves.toMatchObject({ ticket_id: readOnly });
    await expect(access(readOnly, 'update')).rejects.toThrow(DENIED);
    await expect(access(readOnly, 'delete')).rejects.toThrow(DENIED);
  });
});
