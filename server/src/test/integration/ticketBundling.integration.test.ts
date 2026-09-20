import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import { tenantDb } from '@alga-psa/db';
import { BundlePropagationConfirmationRequiredError } from '@alga-psa/tickets/lib/ticketBundlePropagation';
import { resolveCommentAuthor } from '@alga-psa/tickets/lib';
import { publishEvent } from '@alga-psa/event-bus/publishers';
import { ValidationError } from '@/lib/api/middleware/apiMiddleware';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { default: stub, logger: stub };
});

vi.mock('@alga-psa/core/logger', () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return { default: stub, logger: stub };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => {}),
}));

vi.mock('server/src/lib/eventBus', () => ({
  getEventBus: vi.fn(() => ({
    publish: vi.fn(async () => {}),
  })),
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
  },
}));

let mockSessionUserId: string | null = null;
let mockCurrentUser: any = null;

vi.mock('@alga-psa/auth', async () => {
  const rbac = await vi.importActual<typeof import('@alga-psa/auth/rbac')>('@alga-psa/auth/rbac');
  const requireMockUser = () => {
    if (!mockCurrentUser) {
      throw new Error('User not authenticated');
    }
    return mockCurrentUser;
  };
  return {
    ...rbac,
    getSession: vi.fn(async () => ({
      user: mockSessionUserId ? { id: mockSessionUserId } : undefined,
    })),
    withAuth: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withOptionalAuth: (action: any) => async (...args: any[]) => {
      const user = mockCurrentUser;
      if (!user) return action(null, null, ...args);
      const { runWithTenant } = await import('@alga-psa/db');
      return runWithTenant(user.tenant, () => action(user, { tenant: user.tenant }, ...args));
    },
    withAuthCheck: (action: any) => async (...args: any[]) => {
      const user = requireMockUser();
      return action(user, ...args);
    },
  };
});

vi.mock('@alga-psa/users/actions', async () => {
  return {
    getCurrentUser: vi.fn(async () => mockCurrentUser),
  };
});

let runWithTenant: any;
let bundleTicketsAction: any;
let addChildrenToBundleAction: any;
let getBundleMasterClosedContextAction: any;
let removeChildFromBundleAction: any;
let unbundleMasterTicketAction: any;
let promoteBundleMasterAction: any;
let updateBundleSettingsAction: any;
let previewBundleStatusPropagationAction: any;
let previewBulkBundleStatusPropagationAction: any;
let updateTicketWithCache: any;
let addTicketCommentWithCache: any;
let getConsolidatedTicketData: any;
let fetchTicketsWithPagination: any;
let updateComment: any;
let createComment: any;
let findCommentsByTicketId: any;
let saveTimeEntry: any;
let bulkUpdateTicketStatus: any;
let TicketService: any;

type TestUser = {
  user_id: string;
  tenant: string;
  email: string;
  first_name: string;
  last_name: string;
  user_type: 'internal' | 'client';
  is_inactive: boolean;
};

describe('Ticket bundling integration', () => {
  let db: Knex;
  let tenantId: string;
  let otherTenantId: string;
  let otherTenantRefs: { boardId: string; statusOpenId: string; statusClosedId: string; priorityId: string };

  let internalUser: TestUser;
  let clientUser: TestUser;

  let boardId: string;
  let statusOpenId: string;
  let statusClosedId: string;
  let priorityId: string;

  beforeAll(async () => {
    // Point the app's DB env at the local test Postgres before bootstrapping;
    // .env.localtest carries container secret paths that don't exist on host.
    wireLocalTestDbEnv();
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();

    ({ runWithTenant } = await import('@/lib/db'));

    ({
      bundleTicketsAction,
      addChildrenToBundleAction,
      getBundleMasterClosedContextAction,
      removeChildFromBundleAction,
      unbundleMasterTicketAction,
      promoteBundleMasterAction,
      updateBundleSettingsAction,
      previewBundleStatusPropagationAction,
      previewBulkBundleStatusPropagationAction,
    } = await import('@alga-psa/tickets/actions/ticketBundleActions'));

    ({ updateTicketWithCache, addTicketCommentWithCache, getConsolidatedTicketData, fetchTicketsWithPagination } = await import(
      '@alga-psa/tickets/actions/optimizedTicketActions'
    ));

    ({ updateComment, createComment, findCommentsByTicketId } = await import('@alga-psa/tickets/actions/comment-actions/commentActions'));
    ({ saveTimeEntry } = await import('@alga-psa/scheduling/actions/timeEntryActions'));
    ({ bulkUpdateTicketStatus } = await import('@alga-psa/tickets/actions/ticketActions'));
    ({ TicketService } = await import('server/src/lib/api/services/TicketService'));

    tenantId = await ensureTenant(db, 'Ticket bundling test tenant');
    otherTenantId = await createTenant(db, 'Other tenant');

    const referenceUserId = await createUser(db, tenantId, {
      email: `ref-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Ref',
      last_name: 'User',
      user_type: 'internal',
    });
    await ensureTicketReferenceData(db, tenantId, referenceUserId);

    const otherReferenceUserId = await createUser(db, otherTenantId, {
      email: `ref-other-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Ref',
      last_name: 'Other',
      user_type: 'internal',
    });
    await ensureTicketReferenceData(db, otherTenantId, otherReferenceUserId);

    ({ boardId, statusOpenId, statusClosedId, priorityId } = await loadTicketReferenceData(db, tenantId));
    otherTenantRefs = await loadTicketReferenceData(db, otherTenantId);

    const internalUserId = await createUser(db, tenantId, {
      email: `agent-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Agent',
      last_name: 'Tester',
      user_type: 'internal',
    });
    internalUser = {
      user_id: internalUserId,
      tenant: tenantId,
      email: `agent-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Agent',
      last_name: 'Tester',
      user_type: 'internal',
      is_inactive: false,
    };
    await grantUserPermissions(db, tenantId, internalUserId, [
      { resource: 'ticket', action: 'read' },
      { resource: 'ticket', action: 'update' },
      { resource: 'time_entry', action: 'create' },
    ]);

    const clientUserId = await createUser(db, tenantId, {
      email: `client-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Client',
      last_name: 'Tester',
      user_type: 'client',
    });
    clientUser = {
      user_id: clientUserId,
      tenant: tenantId,
      email: `client-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Client',
      last_name: 'Tester',
      user_type: 'client',
      is_inactive: false,
    };

    mockSessionUserId = internalUserId;
    mockCurrentUser = internalUser;
  }, 180_000);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  });

  it('enforces permissions for bundle operations', async () => {
    const clientA = await createClient(db, tenantId, `Perm Client ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `perm-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `PRM-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `PRM-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    const noPermUserId = await createUser(db, tenantId, {
      email: `noperm-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'No',
      last_name: 'Perm',
      user_type: 'internal',
    });
    const noPermUser: TestUser = {
      user_id: noPermUserId,
      tenant: tenantId,
      email: `noperm-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'No',
      last_name: 'Perm',
      user_type: 'internal',
      is_inactive: false,
    };

    mockCurrentUser = noPermUser;
    try {
      const deniedBundleResult = await runWithTenant(tenantId, async () => {
        return bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'link_only' }, noPermUser as any);
      });
      expect(deniedBundleResult).toMatchObject({
        permissionError: 'Permission denied: Cannot bundle tickets',
      });

      await grantUserPermissions(db, tenantId, noPermUserId, [
        { resource: 'ticket', action: 'update' },
        { resource: 'ticket', action: 'read' },
      ]);

      const allowedBundleResult = await runWithTenant(tenantId, async () => {
        return bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'link_only' }, noPermUser as any);
      });
      expect(allowedBundleResult).toMatchObject({
        masterTicketId: masterId,
        childTicketIds: [childId],
        mode: 'link_only',
      });
    } finally {
      mockCurrentUser = internalUser;
    }

    const scopedDb = tenantDb(db, tenantId);
    const linkedChild = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(linkedChild?.master_ticket_id).toBe(masterId);
  });

  it('creates bundles, manages membership, and enforces invariants', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);
    await ensureDefaultClientLocation(db, tenantId, clientA, `client-a-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const child1Id = uuidv4();
    const child2Id = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `BND-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: child1Id, ticketNumber: `BND-${uuidv4().slice(0, 6)}`, title: 'Child 1', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    // Use a non-default status to verify bundling does not change child workflow fields.
    await insertTicket(db, { tenant: tenantId, ticketId: child2Id, ticketNumber: `BND-${uuidv4().slice(0, 6)}`, title: 'Child 2', clientId: clientA, contactId: contactA, statusId: statusClosedId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction(
        { masterTicketId: masterId, childTicketIds: [child1Id, child2Id], mode: 'sync_updates' },
        internalUser as any
      );
    });

    const scopedDb = tenantDb(db, tenantId);
    const child1 = await scopedDb.table('tickets').where({ ticket_id: child1Id }).first();
    const child2 = await scopedDb.table('tickets').where({ ticket_id: child2Id }).first();
    expect(child1?.master_ticket_id).toBe(masterId);
    expect(child2?.master_ticket_id).toBe(masterId);
    expect(child2?.status_id).toBe(statusClosedId);

    const settings = await scopedDb.table('ticket_bundle_settings').where({ master_ticket_id: masterId }).first();
    expect(settings).toBeTruthy();
    expect(settings?.mode).toBe('sync_updates');

    // Cannot add an already-bundled ticket to a bundle
    const alreadyBundledResult = await runWithTenant(tenantId, async () => {
      return addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [child1Id] }, internalUser as any);
    });
    expect(alreadyBundledResult).toMatchObject({ actionError: expect.stringMatching(/already bundled/i) });

    // Cannot add a bundle master as a child (no nesting)
    const otherMasterId = uuidv4();
    const nestedChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: otherMasterId, ticketNumber: `BND-${uuidv4().slice(0, 6)}`, title: 'Other master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: nestedChildId, ticketNumber: `BND-${uuidv4().slice(0, 6)}`, title: 'Nested child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: otherMasterId, childTicketIds: [nestedChildId], mode: 'link_only' }, internalUser as any);
    });

    const nestingResult = await runWithTenant(tenantId, async () => {
      return addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [otherMasterId] }, internalUser as any);
    });
    expect(nestingResult).toMatchObject({ actionError: expect.stringMatching(/already (a bundle master|bundle masters)/i) });

    // Cross-tenant bundle attempts fail because foreign-tenant ticket ids won't resolve
    const foreignClient = await createClient(db, otherTenantId, `Other Client ${uuidv4().slice(0, 6)}`);
    const foreignContact = await createContact(db, otherTenantId, foreignClient, `foreign-${uuidv4().slice(0, 6)}@example.com`);
    const foreignTicketId = uuidv4();
    await insertTicket(db, {
      tenant: otherTenantId,
      ticketId: foreignTicketId,
      ticketNumber: `BND-${uuidv4().slice(0, 6)}`,
      title: 'Foreign ticket',
      clientId: foreignClient,
      contactId: foreignContact,
      statusId: otherTenantRefs.statusOpenId,
      priorityId: otherTenantRefs.priorityId,
      boardId: otherTenantRefs.boardId,
    });

    const crossTenantResult = await runWithTenant(tenantId, async () => {
      return addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [foreignTicketId] }, internalUser as any);
    });
    expect(crossTenantResult).toMatchObject({ actionError: expect.stringMatching(/not found/i) });

    // Remove a child only unlinks that ticket.
    await runWithTenant(tenantId, async () => {
      await removeChildFromBundleAction({ childTicketId: child2Id }, internalUser as any);
    });
    const child2After = await scopedDb.table('tickets').where({ ticket_id: child2Id }).first();
    expect(child2After?.master_ticket_id).toBeNull();

    // Unbundle detaches all children + removes settings.
    await runWithTenant(tenantId, async () => {
      await unbundleMasterTicketAction({ masterTicketId: masterId }, internalUser as any);
    });
    const child1After = await scopedDb.table('tickets').where({ ticket_id: child1Id }).first();
    expect(child1After?.master_ticket_id).toBeNull();
    const settingsAfter = await scopedDb.table('ticket_bundle_settings').where({ master_ticket_id: masterId }).first();
    expect(settingsAfter).toBeFalsy();
  });

  it('supports promote-to-master and preserves membership', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const oldMasterId = uuidv4();
    const child1Id = uuidv4();
    const child2Id = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: oldMasterId, ticketNumber: `PRM-${uuidv4().slice(0, 6)}`, title: 'Old master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: child1Id, ticketNumber: `PRM-${uuidv4().slice(0, 6)}`, title: 'Child 1', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: child2Id, ticketNumber: `PRM-${uuidv4().slice(0, 6)}`, title: 'Child 2', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: oldMasterId, childTicketIds: [child1Id, child2Id], mode: 'sync_updates' }, internalUser as any);
      const selfPromoteResult = await promoteBundleMasterAction({ oldMasterTicketId: oldMasterId, newMasterTicketId: oldMasterId }, internalUser as any);
      expect(selfPromoteResult).toMatchObject({
        actionError: 'New master ticket must be different from the current master.',
      });
      await promoteBundleMasterAction({ oldMasterTicketId: oldMasterId, newMasterTicketId: child1Id }, internalUser as any);
    });

    const scopedDb = tenantDb(db, tenantId);
    const newMaster = await scopedDb.table('tickets').where({ ticket_id: child1Id }).first();
    expect(newMaster?.master_ticket_id).toBeNull();
    const oldMaster = await scopedDb.table('tickets').where({ ticket_id: oldMasterId }).first();
    expect(oldMaster?.master_ticket_id).toBe(child1Id);
    const otherChild = await scopedDb.table('tickets').where({ ticket_id: child2Id }).first();
    expect(otherChild?.master_ticket_id).toBe(child1Id);

    const settings = await scopedDb.table('ticket_bundle_settings').where({ master_ticket_id: child1Id }).first();
    expect(settings?.mode).toBe('sync_updates');
  });

  it('sync_updates propagates workflow changes; children lock workflow fields', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `SNC-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `SNC-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
    });

    const scopedDb = tenantDb(db, tenantId);
    const anotherPriority = await scopedDb.table('priorities').andWhereNot({ priority_id: priorityId }).first();
    const nextPriorityId = anotherPriority?.priority_id ?? priorityId;

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(
        masterId,
        { status_id: statusClosedId, priority_id: nextPriorityId },
        { propagateToChildren: true } as any,
      );
    });

    const childAfter = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(childAfter?.status_id).toBe(statusClosedId);
    expect(childAfter?.priority_id).toBe(nextPriorityId);

    const childWorkflowUpdateResult = await runWithTenant(tenantId, async () => {
      return updateTicketWithCache(childId, { status_id: statusOpenId }, internalUser as any);
    });
    expect(childWorkflowUpdateResult).toMatchObject({
      actionError: 'This ticket is bundled; workflow fields are locked (status_id). Update the master ticket instead.',
    });

    const childAfterLockAttempt = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(childAfterLockAttempt?.status_id).toBe(statusClosedId);
  });

  it('sync_updates mirrors public comments to children, marking them system-generated and immutable', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `CMT-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `CMT-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
    });

    const content = JSON.stringify([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Bundled update' }],
      },
    ]);

    const scopedDb = tenantDb(db, tenantId);
    const childBefore = await scopedDb.table('tickets').where({ ticket_id: childId }).first();

    vi.mocked(publishEvent).mockClear();
    await runWithTenant(tenantId, async () => {
      await addTicketCommentWithCache(masterId, content, false, false, internalUser as any);
    });

    const mirrored = await scopedDb.table('comments')
      .where({ ticket_id: childId })
      .andWhere({ is_system_generated: true })
      .first();

    expect(mirrored).toBeTruthy();
    expect(mirrored?.is_internal).toBe(false);
    // The child copy carries the source author so it resolves everywhere
    // resolveCommentAuthor is used, while remaining a system artifact.
    expect(mirrored?.is_system_generated).toBe(true);
    expect(mirrored?.user_id).toBe(internalUser.user_id);
    expect(mirrored?.author_type).toBe('internal');
    expect(mirrored?.contact_id ?? null).toBeNull();

    const mirroredThread = await scopedDb.table('comment_threads')
      .where({ thread_id: mirrored.thread_id })
      .first();
    expect(mirroredThread?.created_by).toBe(internalUser.user_id);

    const mirrorLink = await scopedDb.table('ticket_bundle_mirrors')
      .where({ child_ticket_id: childId, child_comment_id: mirrored.comment_id })
      .first();
    expect(mirrorLink?.source_comment_id).toBeTruthy();
    const sourceComment = await scopedDb.table('comments')
      .where({ comment_id: mirrorLink.source_comment_id })
      .first();
    expect(sourceComment?.ticket_id).toBe(masterId);

    // The child renderer resolves the agent, not Unknown User.
    const childData = await runWithTenant(tenantId, async () =>
      getConsolidatedTicketData(childId, internalUser as any)
    );
    const resolvedChildAuthor = resolveCommentAuthor(mirrored, {
      userMap: childData.userMap,
      contactMap: childData.contactMap,
    });
    expect(resolvedChildAuthor.source).toBe('user');
    expect(resolvedChildAuthor.displayName).toBe(`${internalUser.first_name} ${internalUser.last_name}`);

    // Only the master's TICKET_COMMENT_ADDED is published — the child copy is a
    // display artifact with no event of its own. (A response-state event may
    // also fire; only the comment-added count is asserted.)
    const commentAddedCalls = vi.mocked(publishEvent).mock.calls.filter(
      ([published]) => published?.eventType === 'TICKET_COMMENT_ADDED'
    );
    expect(commentAddedCalls).toHaveLength(1);
    expect(commentAddedCalls[0][0]).toMatchObject({
      eventType: 'TICKET_COMMENT_ADDED',
      payload: { ticketId: masterId, commentId: sourceComment?.comment_id },
    });

    // Readers key on is_system_generated, not on an author being absent: the
    // child's workflow/response state is not advanced by the mirrored copy.
    const childAfter = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(childAfter?.status_id).toBe(childBefore?.status_id);
    expect(childAfter?.response_state).toBe(childBefore?.response_state);

    const originalNote = mirrored?.note;
    const mirroredUpdateResult = await runWithTenant(tenantId, async () => {
      return updateComment(mirrored.comment_id, { note: 'edited' } as any);
    });
    expect(mirroredUpdateResult).toMatchObject({
      actionError: 'This comment is system-generated and cannot be edited.',
    });

    const mirroredAfter = await scopedDb.table('comments').where({ comment_id: mirrored.comment_id }).first();
    expect(mirroredAfter?.note).toBe(originalNote);
  });

  it('sync_updates copies a contact author onto the mirrored child comment', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `CTM-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `CTM-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
    });

    const scopedDb = tenantDb(db, tenantId);
    const contactAuthorId = await createUser(db, tenantId, {
      email: `contact-author-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Contact',
      last_name: 'Author',
      user_type: 'internal',
    });
    await scopedDb.table('users').where({ user_id: contactAuthorId }).update({ contact_id: contactA });
    await grantUserPermissions(db, tenantId, contactAuthorId, [
      { resource: 'ticket', action: 'read' },
      { resource: 'ticket', action: 'update' },
    ]);
    const contactAuthor = {
      user_id: contactAuthorId,
      tenant: tenantId,
      email: `contact-author-${uuidv4().slice(0, 8)}@example.com`,
      first_name: 'Contact',
      last_name: 'Author',
      user_type: 'internal' as const,
      is_inactive: false,
      contact_id: contactA,
    };

    const previousUser = mockCurrentUser;
    mockCurrentUser = contactAuthor;
    try {
      await runWithTenant(tenantId, async () => {
        await addTicketCommentWithCache(
          masterId,
          JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Contact update' }] }]),
          false,
          false,
          contactAuthor as any
        );
      });
    } finally {
      mockCurrentUser = previousUser;
    }

    const mirrored = await scopedDb.table('comments')
      .where({ ticket_id: childId, is_system_generated: true })
      .first();
    expect(mirrored?.contact_id).toBe(contactA);
    expect(mirrored?.user_id).toBe(contactAuthorId);
    expect(mirrored?.author_type).toBe('internal');

    const childData = await runWithTenant(tenantId, async () =>
      getConsolidatedTicketData(childId, internalUser as any)
    );
    // The contact id is carried onto the child; when the user record is not
    // resolvable it is the contact map that renders the author.
    const resolvedViaContact = resolveCommentAuthor(mirrored, {
      userMap: {},
      contactMap: childData.contactMap,
    });
    expect(resolvedViaContact.source).toBe('contact');
    expect(resolvedViaContact.displayName).toBe('Bundling Contact');
  });

  it('T008: consolidated child comments expose bundle provenance while staying unattributed', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `PRV ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `prv-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();
    const masterNumber = `PRV-${uuidv4().slice(0, 6)}`;
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: masterNumber, title: 'Provenance master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `PRV-${uuidv4().slice(0, 6)}`, title: 'Provenance child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
    });

    const sourceCommentId = uuidv4();
    const sourceThreadId = uuidv4();
    const note = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Authorless master update' }] }]);
    await scopedDb.table('comment_threads').insert({
      tenant: tenantId,
      thread_id: sourceThreadId,
      ticket_id: masterId,
      project_task_id: null,
      root_comment_id: sourceCommentId,
      is_internal: false,
      reply_count: 0,
      last_activity_at: db.fn.now(),
      created_at: db.fn.now(),
      created_by: null,
    });
    await scopedDb.table('comments').insert({
      tenant: tenantId,
      comment_id: sourceCommentId,
      thread_id: sourceThreadId,
      ticket_id: masterId,
      user_id: null,
      contact_id: null,
      author_type: 'unknown',
      note,
      markdown_content: 'Authorless master update',
      is_internal: false,
      is_resolution: false,
      is_system_generated: true,
      created_at: db.fn.now(),
    });

    const { mirrorCommentToChild } = await import('@alga-psa/tickets/actions/ticketBundleUtils');
    let mirroredCommentId: string | null = null;
    await db.transaction(async (trx) => {
      mirroredCommentId = await mirrorCommentToChild(trx, tenantId, {
        sourceComment: {
          comment_id: sourceCommentId,
          note,
          markdown_content: 'Authorless master update',
          user_id: null,
          contact_id: null,
          author_type: 'unknown',
        },
        childTicketId: childId,
        isResolution: false,
      });
    });
    expect(mirroredCommentId).toBeTruthy();

    await insertResolutionComment(db, tenantId, childId, internalUser.user_id, {
      isInternal: false,
      isResolution: false,
      note: 'Child-only note',
    });

    const childData = await runWithTenant(tenantId, async () =>
      getConsolidatedTicketData(childId, internalUser as any)
    );
    const childComments = childData.comments as any[];
    const mirrored = childComments.find((comment) => comment.comment_id === mirroredCommentId);
    expect(mirrored).toBeTruthy();
    expect(mirrored.bundle_mirror_source).toMatchObject({
      source_comment_id: sourceCommentId,
      master_ticket_id: masterId,
      master_ticket_number: masterNumber,
    });
    expect(mirrored.user_id ?? null).toBeNull();
    expect(mirrored.contact_id ?? null).toBeNull();

    const plain = childComments.find((comment) => comment.note === 'Child-only note' || comment.note?.includes?.('Child-only note'));
    expect(plain).toBeTruthy();
    expect(plain.bundle_mirror_source).toBeNull();

    // Every MSP refresh path (remote 'comments' update, post add/edit/delete)
    // refetches through findCommentsByTicketId -> Comment.getAllbyTicketId, not
    // through getConsolidatedTicketData. If the provenance join lived only in
    // the consolidated loader, mirrors would silently flip to "System" with no
    // chip after the first refetch. Assert the shared read layer returns the
    // same shape.
    const refreshedComments = await runWithTenant(tenantId, async () =>
      findCommentsByTicketId(childId)
    );
    expect(Array.isArray(refreshedComments)).toBe(true);
    const refreshedMirror = (refreshedComments as any[]).find((comment) => comment.comment_id === mirroredCommentId);
    expect(refreshedMirror).toBeTruthy();
    expect(refreshedMirror.bundle_mirror_source).toMatchObject({
      source_comment_id: sourceCommentId,
      master_ticket_id: masterId,
      master_ticket_number: masterNumber,
    });
    const refreshedPlain = (refreshedComments as any[]).find((comment) => comment.comment_id !== mirroredCommentId && !comment.is_system_generated);
    expect(refreshedPlain?.bundle_mirror_source ?? null).toBeNull();

    const resolutionMasterId = uuidv4();
    const resolutionChildId = uuidv4();
    const resolutionMasterNumber = `PRV-${uuidv4().slice(0, 6)}`;
    await insertTicket(db, { tenant: tenantId, ticketId: resolutionMasterId, ticketNumber: resolutionMasterNumber, title: 'Resolution master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: resolutionChildId, ticketNumber: `PRV-${uuidv4().slice(0, 6)}`, title: 'Resolution child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, resolutionMasterId, statusClosedId, internalUser.user_id);
    const resolutionCommentId = await insertResolutionComment(db, tenantId, resolutionMasterId, internalUser.user_id, {
      isInternal: false,
      isResolution: true,
      note: 'Authorless resolution',
    });
    await scopedDb.table('comments').where({ comment_id: resolutionCommentId }).update({
      user_id: null,
      contact_id: null,
      author_type: 'unknown',
    });

    await runWithTenant(tenantId, () =>
      addChildrenToBundleAction(
        { masterTicketId: resolutionMasterId, childTicketIds: [resolutionChildId], onClosedMaster: 'apply_resolution' },
        internalUser as any
      )
    );

    const resolutionData = await runWithTenant(tenantId, async () =>
      getConsolidatedTicketData(resolutionChildId, internalUser as any)
    );
    const resolutionMirror = (resolutionData.comments as any[]).find((comment) => comment.is_system_generated);
    expect(resolutionMirror).toBeTruthy();
    expect(resolutionMirror.bundle_mirror_source).toMatchObject({
      source_comment_id: resolutionCommentId,
      master_ticket_id: resolutionMasterId,
      master_ticket_number: resolutionMasterNumber,
    });
    expect(resolutionMirror.user_id ?? null).toBeNull();
    expect(resolutionMirror.contact_id ?? null).toBeNull();
  });

  it('reopen-on-reply can reopen the master when a client replies on a child', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `RPN-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `RPN-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
      await updateBundleSettingsAction({ masterTicketId: masterId, reopenOnChildReply: true }, internalUser as any);
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });

    const scopedDb = tenantDb(db, tenantId);
    const closedMaster = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(closedMaster?.status_id).toBe(statusClosedId);
    expect(closedMaster?.is_closed).toBe(true);

    const replyContent = JSON.stringify([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Customer reply' }],
      },
    ]);

    await runWithTenant(tenantId, async () => {
      await createComment({
        ticket_id: childId,
        user_id: clientUser.user_id,
        note: replyContent,
        is_internal: false,
        is_resolution: false,
      } as any);
    });

    // The reopen utility resets the master to the default open ticket status of
    // the master's own board. It must be board-scoped: every other status write
    // goes through TicketModel.validateStatusBelongsToBoard, so a tenant-wide
    // pick can leave the master on a status its own board rejects.
    const boardDefaultOpenStatus = await scopedDb.table('statuses')
      .where({ is_closed: false, board_id: boardId })
      .andWhere(function () {
        this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
      })
      .orderBy('is_default', 'desc')
      .orderBy('order_number', 'asc')
      .orderBy('status_id')
      .first<{ status_id: string }>('status_id');

    const reopenedMaster = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(boardDefaultOpenStatus?.status_id).toBeTruthy();
    expect(reopenedMaster?.status_id).toBe(boardDefaultOpenStatus?.status_id);
    expect(reopenedMaster?.closed_at).toBeNull();
    expect(reopenedMaster?.is_closed).toBe(false);
  });

  it('T002: adding to a closed master requires a choice; an open master does not', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `CM2 ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `cm2-${uuidv4().slice(0, 6)}@example.com`);

    const closedMasterId = uuidv4();
    const closedChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: closedMasterId, ticketNumber: `CM2-${uuidv4().slice(0, 6)}`, title: 'Closed master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: closedChildId, ticketNumber: `CM2-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, closedMasterId, statusClosedId, internalUser.user_id);

    const noChoice = await runWithTenant(tenantId, () =>
      addChildrenToBundleAction({ masterTicketId: closedMasterId, childTicketIds: [closedChildId] }, internalUser as any)
    );
    expect(noChoice).toMatchObject({ actionError: expect.stringMatching(/keep the master closed/i) });
    expect(noChoice).toMatchObject({ actionError: expect.stringMatching(/apply the master/i) });
    expect(noChoice).toMatchObject({ actionError: expect.stringMatching(/reopen the master/i) });

    const unlinked = await scopedDb.table('tickets').where({ ticket_id: closedChildId }).first();
    expect(unlinked?.master_ticket_id).toBeNull();

    const openMasterId = uuidv4();
    const openChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: openMasterId, ticketNumber: `CM2-${uuidv4().slice(0, 6)}`, title: 'Open master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: openChildId, ticketNumber: `CM2-${uuidv4().slice(0, 6)}`, title: 'Open child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    const openResult = await runWithTenant(tenantId, () =>
      addChildrenToBundleAction({ masterTicketId: openMasterId, childTicketIds: [openChildId] }, internalUser as any)
    );
    expect(openResult).toMatchObject({ masterTicketId: openMasterId, childTicketIds: [openChildId] });
    const linked = await scopedDb.table('tickets').where({ ticket_id: openChildId }).first();
    expect(linked?.master_ticket_id).toBe(openMasterId);
  });

  it('T003: keep_closed links only and records the closed-master add on both tickets', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `KP ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `kp-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `KP-${uuidv4().slice(0, 6)}`, title: 'Closed master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `KP-${uuidv4().slice(0, 6)}`, title: 'Open child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, masterId, statusClosedId, internalUser.user_id);

    const result = await runWithTenant(tenantId, () =>
      addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [childId], onClosedMaster: 'keep_closed' }, internalUser as any)
    );
    expect(result).toMatchObject({ masterTicketId: masterId, childTicketIds: [childId] });

    const child = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    const master = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(child?.master_ticket_id).toBe(masterId);
    expect(child?.status_id).toBe(statusOpenId);
    expect(child?.closed_at).toBeNull();
    expect(master?.status_id).toBe(statusClosedId);
    expect(master?.is_closed).toBe(true);

    const childActivity = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: childId, event_type: 'TICKET_BUNDLE_CHILD_ADDED' })
      .first();
    expect(childActivity?.actor_type).toBe('user');
    expect(childActivity?.details).toMatchObject({ master_was_closed: true, closed_master_choice: 'keep_closed' });

    const masterActivity = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: masterId, event_type: 'TICKET_BUNDLE_CHILD_ADDED' })
      .first();
    expect(masterActivity?.details).toMatchObject({ master_was_closed: true, closed_master_choice: 'keep_closed' });

    const masterWorkflowEvents = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: masterId })
      .whereIn('event_type', ['TICKET_CLOSED', 'TICKET_REOPENED', 'TICKET_UPDATED']);
    expect(masterWorkflowEvents).toHaveLength(0);
  });

  it('T004: apply_resolution closes the child and mirrors the public resolution once per child', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `AR ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `ar-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const child1Id = uuidv4();
    const child2Id = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `AR-${uuidv4().slice(0, 6)}`, title: 'Closed master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: child1Id, ticketNumber: `AR-${uuidv4().slice(0, 6)}`, title: 'Child 1', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: child2Id, ticketNumber: `AR-${uuidv4().slice(0, 6)}`, title: 'Child 2', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    // A child that is awaiting the client is the exact case the canonical close
    // clears response_state for; apply_resolution must do the same.
    await scopedDb.table('tickets').where({ ticket_id: child1Id }).update({ response_state: 'awaiting_client' });
    await closeTicketRow(db, tenantId, masterId, statusClosedId, internalUser.user_id);
    const resolutionCommentId = await insertResolutionComment(db, tenantId, masterId, internalUser.user_id, { isInternal: false, isResolution: true, note: 'Resolved by restart' });
    const masterBefore = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();

    await runWithTenant(tenantId, () =>
      addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [child1Id], onClosedMaster: 'apply_resolution' }, internalUser as any)
    );
    await runWithTenant(tenantId, () =>
      addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [child2Id], onClosedMaster: 'apply_resolution' }, internalUser as any)
    );

    for (const childId of [child1Id, child2Id]) {
      const child = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
      expect(child?.master_ticket_id).toBe(masterId);
      expect(child?.status_id).toBe(statusClosedId);
      expect(child?.is_closed).toBe(true);
      expect(child?.closed_at).not.toBeNull();
      expect(child?.closed_by).toBe(internalUser.user_id);
      // Closed with the response state cleared, even for the awaiting_client child.
      expect(child?.response_state).toBeNull();

      const mirroredComments = await scopedDb.table('comments')
        .where({ ticket_id: childId, is_system_generated: true });
      expect(mirroredComments).toHaveLength(1);
      expect(mirroredComments[0]?.is_internal).toBe(false);
      expect(mirroredComments[0]?.is_resolution).toBe(true);

      const mirrorRow = await scopedDb.table('ticket_bundle_mirrors')
        .where({ source_comment_id: resolutionCommentId, child_ticket_id: childId })
        .first();
      expect(mirrorRow).toBeTruthy();
    }

    const masterAfter = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(masterAfter?.status_id).toBe(masterBefore?.status_id);
    expect(new Date(masterAfter?.closed_at).toISOString()).toBe(new Date(masterBefore?.closed_at).toISOString());

    const closeActivity = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: child1Id, event_type: 'TICKET_CLOSED' })
      .first();
    expect(closeActivity?.details).toMatchObject({ closed_master_choice: 'apply_resolution' });
    expect(closeActivity?.changes).toMatchObject({
      response_state: { old: 'awaiting_client', new: null },
    });
    // child2 never had a response state, so its activity must not carry a no-op diff.
    const closeActivity2 = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: child2Id, event_type: 'TICKET_CLOSED' })
      .first();
    expect((closeActivity2?.changes as any)?.response_state).toBeUndefined();
  });

  it('T005: apply_resolution with only an internal resolution comment closes the child with no mirror', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `IR ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `ir-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `IR-${uuidv4().slice(0, 6)}`, title: 'Closed master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `IR-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, masterId, statusClosedId, internalUser.user_id);
    await insertResolutionComment(db, tenantId, masterId, internalUser.user_id, { isInternal: true, isResolution: true, note: 'Internal resolution only' });

    const context = await runWithTenant(tenantId, () =>
      getBundleMasterClosedContextAction({ masterTicketId: masterId }, internalUser as any)
    );
    expect(context).toMatchObject({ isClosed: true, hasResolutionComment: false });

    await runWithTenant(tenantId, () =>
      addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [childId], onClosedMaster: 'apply_resolution' }, internalUser as any)
    );

    const child = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(child?.is_closed).toBe(true);
    expect(child?.closed_at).not.toBeNull();
    const mirrored = await scopedDb.table('comments').where({ ticket_id: childId, is_system_generated: true });
    expect(mirrored).toHaveLength(0);
  });

  it('T006: reopen_master reopens only the master even under sync_updates', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `RM ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `rm-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const existingChildId = uuidv4();
    const newChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `RM-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: existingChildId, ticketNumber: `RM-${uuidv4().slice(0, 6)}`, title: 'Existing child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: newChildId, ticketNumber: `RM-${uuidv4().slice(0, 6)}`, title: 'New child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [existingChildId], mode: 'sync_updates' }, internalUser as any);
      // A boundary-crossing sync-master close requires the explicit propagation
      // choice; the test wants the child closed, so propagate.
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });
    // The propagated close stamps the child's status but not closed_at; stamp
    // it so the sibling is genuinely closed before the reopen_master add.
    await closeTicketRow(db, tenantId, existingChildId, statusClosedId, internalUser.user_id);

    const existingChildClosed = await scopedDb.table('tickets').where({ ticket_id: existingChildId }).first();
    expect(existingChildClosed?.status_id).toBe(statusClosedId);
    expect(existingChildClosed?.closed_at).not.toBeNull();

    const result = await runWithTenant(tenantId, () =>
      addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [newChildId], onClosedMaster: 'reopen_master' }, internalUser as any)
    );
    expect(result).toMatchObject({ masterTicketId: masterId, childTicketIds: [newChildId] });

    const tenantDefaultOpenStatus = await scopedDb.table('statuses')
      .where({ is_closed: false })
      .andWhere(function () { this.where('item_type', 'ticket').orWhere('status_type', 'ticket'); })
      .orderBy('is_default', 'desc')
      .orderBy('order_number', 'asc')
      .first<{ status_id: string }>('status_id');

    const masterAfter = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(masterAfter?.status_id).toBe(tenantDefaultOpenStatus?.status_id);
    expect(masterAfter?.is_closed).toBe(false);
    expect(masterAfter?.closed_at).toBeNull();

    const existingChildAfter = await scopedDb.table('tickets').where({ ticket_id: existingChildId }).first();
    expect(existingChildAfter?.status_id).toBe(statusClosedId);
    expect(existingChildAfter?.closed_at).not.toBeNull();

    const newChildAfter = await scopedDb.table('tickets').where({ ticket_id: newChildId }).first();
    expect(newChildAfter?.master_ticket_id).toBe(masterId);
    expect(newChildAfter?.is_closed).not.toBe(true);
    expect(newChildAfter?.closed_at).toBeNull();

    const reopenActivity = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: masterId, event_type: 'TICKET_REOPENED' })
      .first();
    expect(reopenActivity?.actor_type).toBe('user');
    expect(reopenActivity?.details).toMatchObject({ reopen_trigger: 'add_child' });
  });

  it('T008: require_no_open_children forbids keep_closed and still allows apply_resolution', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `NO ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `no-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const keepChildId = uuidv4();
    const applyChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `NO-${uuidv4().slice(0, 6)}`, title: 'Closed master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: keepChildId, ticketNumber: `NO-${uuidv4().slice(0, 6)}`, title: 'Keep child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: applyChildId, ticketNumber: `NO-${uuidv4().slice(0, 6)}`, title: 'Apply child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, masterId, statusClosedId, internalUser.user_id);

    await upsertBoardCloseRules(db, tenantId, boardId, { require_no_open_children: true, is_enabled: true });
    try {
      const context = await runWithTenant(tenantId, () =>
        getBundleMasterClosedContextAction({ masterTicketId: masterId }, internalUser as any)
      );
      expect(context).toMatchObject({ isClosed: true, allowedChoices: ['apply_resolution', 'reopen_master'] });

      const rejected = await runWithTenant(tenantId, () =>
        addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [keepChildId], onClosedMaster: 'keep_closed' }, internalUser as any)
      );
      expect(rejected).toMatchObject({ actionError: expect.stringMatching(/not allowed/i) });
      const keepChildAfter = await scopedDb.table('tickets').where({ ticket_id: keepChildId }).first();
      expect(keepChildAfter?.master_ticket_id).toBeNull();

      await runWithTenant(tenantId, () =>
        addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [applyChildId], onClosedMaster: 'apply_resolution' }, internalUser as any)
      );
      const applyChildAfter = await scopedDb.table('tickets').where({ ticket_id: applyChildId }).first();
      expect(applyChildAfter?.master_ticket_id).toBe(masterId);
      expect(applyChildAfter?.is_closed).toBe(true);
    } finally {
      await clearBoardCloseRules(db, tenantId, boardId);
    }
  });

  it('T009: bundleTicketsAction applies the closed-master policy on the create path', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `BC ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `bc-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const keepChildId = uuidv4();
    const applyChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `BC-${uuidv4().slice(0, 6)}`, title: 'Closed master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: keepChildId, ticketNumber: `BC-${uuidv4().slice(0, 6)}`, title: 'Keep child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: applyChildId, ticketNumber: `BC-${uuidv4().slice(0, 6)}`, title: 'Apply child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, masterId, statusClosedId, internalUser.user_id);

    const noChoice = await runWithTenant(tenantId, () =>
      bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [keepChildId], mode: 'sync_updates' }, internalUser as any)
    );
    expect(noChoice).toMatchObject({ actionError: expect.stringMatching(/keep the master closed/i) });
    const settingsBefore = await scopedDb.table('ticket_bundle_settings').where({ master_ticket_id: masterId }).first();
    expect(settingsBefore).toBeFalsy();

    const kept = await runWithTenant(tenantId, () =>
      bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [keepChildId], mode: 'sync_updates', onClosedMaster: 'keep_closed' }, internalUser as any)
    );
    expect(kept).toMatchObject({ masterTicketId: masterId, childTicketIds: [keepChildId], mode: 'sync_updates' });
    const keptChild = await scopedDb.table('tickets').where({ ticket_id: keepChildId }).first();
    expect(keptChild?.master_ticket_id).toBe(masterId);
    expect(keptChild?.is_closed).not.toBe(true);

    await runWithTenant(tenantId, () =>
      bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [applyChildId], mode: 'sync_updates', onClosedMaster: 'apply_resolution' }, internalUser as any)
    );
    const appliedChild = await scopedDb.table('tickets').where({ ticket_id: applyChildId }).first();
    expect(appliedChild?.master_ticket_id).toBe(masterId);
    expect(appliedChild?.is_closed).toBe(true);
  });

  it('T010: TicketService returns 409 without a choice and 400 for a choice on an open master', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `SV ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `sv-${uuidv4().slice(0, 6)}@example.com`);

    const createTicket = async (label: string) => {
      const id = uuidv4();
      await insertTicket(db, { tenant: tenantId, ticketId: id, ticketNumber: `SV-${uuidv4().slice(0, 6)}`, title: label, clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
      return id;
    };

    const closedMasterId = await createTicket('Closed master');
    const closedChildId = await createTicket('Child');
    await closeTicketRow(db, tenantId, closedMasterId, statusClosedId, internalUser.user_id);

    const openMasterId = await createTicket('Open master');
    const openChildId = await createTicket('Open child');

    const context = { tenant: tenantId, userId: internalUser.user_id, user: internalUser };

    await runWithTenant(tenantId, async () => {
      const service = new TicketService();
      await expect(
        service.addBundleChildren(context, { masterTicketId: closedMasterId, childTicketIds: [closedChildId] })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringMatching(/on_closed_master/),
      });

      const childAfter = await scopedDb.table('tickets').where({ ticket_id: closedChildId }).first();
      expect(childAfter?.master_ticket_id).toBeNull();

      await service.addBundleChildren(context, {
        masterTicketId: closedMasterId,
        childTicketIds: [closedChildId],
        onClosedMaster: 'keep_closed',
      });
      const linked = await scopedDb.table('tickets').where({ ticket_id: closedChildId }).first();
      expect(linked?.master_ticket_id).toBe(closedMasterId);

      await expect(
        service.addBundleChildren(context, {
          masterTicketId: openMasterId,
          childTicketIds: [openChildId],
          onClosedMaster: 'keep_closed',
        })
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  it('T011: list rows and consolidated data expose the open-child count', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `CT ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `ct-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const child1Id = uuidv4();
    const child2Id = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `CT-${uuidv4().slice(0, 6)}`, title: 'Count master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: child1Id, ticketNumber: `CT-${uuidv4().slice(0, 6)}`, title: 'Count child 1', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: child2Id, ticketNumber: `CT-${uuidv4().slice(0, 6)}`, title: 'Count child 2', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, masterId, statusClosedId, internalUser.user_id);

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [child1Id, child2Id], mode: 'link_only', onClosedMaster: 'keep_closed' }, internalUser as any);
    });

    const listResult = await runWithTenant(tenantId, () =>
      fetchTicketsWithPagination(
        { boardFilterState: 'all', bundleView: 'bundled', statusId: '__status_filter__:all' } as any,
        1,
        200
      )
    );
    const masterRow = (listResult.tickets ?? []).find((t: any) => t.ticket_id === masterId);
    expect(masterRow?.bundle_open_child_count).toBe(2);

    const consolidated = await runWithTenant(tenantId, () => getConsolidatedTicketData(masterId, internalUser as any));
    expect(consolidated.bundle.openChildrenCount).toBe(2);
    const consolidatedChild = (consolidated.bundle.children ?? []).find((c: any) => c.ticket_id === child1Id);
    expect(consolidatedChild?.is_closed).toBe(false);

    await closeTicketRow(db, tenantId, child1Id, statusClosedId, internalUser.user_id);
    await closeTicketRow(db, tenantId, child2Id, statusClosedId, internalUser.user_id);

    const listResult2 = await runWithTenant(tenantId, () =>
      fetchTicketsWithPagination(
        { boardFilterState: 'all', bundleView: 'bundled', statusId: '__status_filter__:all' } as any,
        1,
        200
      )
    );
    const masterRow2 = (listResult2.tickets ?? []).find((t: any) => t.ticket_id === masterId);
    expect(masterRow2?.bundle_open_child_count).toBe(0);
  });

  it('T012: apply_resolution enforces the child close rules and writes nothing on failure', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const clientA = await createClient(db, tenantId, `CR ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `cr-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `CR-${uuidv4().slice(0, 6)}`, title: 'Closed master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `CR-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await closeTicketRow(db, tenantId, masterId, statusClosedId, internalUser.user_id);
    await insertResolutionComment(db, tenantId, masterId, internalUser.user_id, { isInternal: false, isResolution: true, note: 'Resolution' });

    await upsertBoardCloseRules(db, tenantId, boardId, { require_time_entry: true, is_enabled: true });
    try {
      const result = await runWithTenant(tenantId, () =>
        addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [childId], onClosedMaster: 'apply_resolution' }, internalUser as any)
      );
      expect(result).toMatchObject({ actionError: expect.stringMatching(/time entry/i) });

      const childAfter = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
      expect(childAfter?.master_ticket_id).toBeNull();
      expect(childAfter?.is_closed).not.toBe(true);
      const mirrored = await scopedDb.table('comments').where({ ticket_id: childId, is_system_generated: true });
      expect(mirrored).toHaveLength(0);
    } finally {
      await clearBoardCloseRules(db, tenantId, boardId);
    }
  });

  it('surfaces inbound child public replies on the master as aggregated view-only items', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `AGG-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `AGG-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
      await createComment({
        ticket_id: childId,
        user_id: clientUser.user_id,
        note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Child reply' }] }]),
        is_internal: false,
        is_resolution: false,
      } as any);
    });

    const consolidated = await runWithTenant(tenantId, async () => {
      return getConsolidatedTicketData(masterId, internalUser as any);
    });

    expect(Array.isArray(consolidated.aggregatedChildClientComments)).toBe(true);
    expect(consolidated.aggregatedChildClientComments.length).toBeGreaterThan(0);
    expect(consolidated.aggregatedChildClientComments[0].child_ticket_id).toBe(childId);

    // The master comments list should not include that child ticket id (view-only aggregation).
    const masterCommentHasChild = (consolidated.comments || []).some((c: any) => c.ticket_id === childId);
    expect(masterCommentHasChild).toBe(false);
  });

  it('allows time entries on both bundled children and masters', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const scopedDb = tenantDb(db, tenantId);
    const existingService = await scopedDb.table('service_catalog')
      .where({ is_active: true })
      .first('service_id');
    let serviceId = existingService?.service_id as string | undefined;
    if (!serviceId) {
      const serviceTypeId = uuidv4();
      serviceId = uuidv4();
      await scopedDb.table('service_types').insert({
        id: serviceTypeId,
        tenant: tenantId,
        name: `Hourly Type ${uuidv4().slice(0, 6)}`,
        is_active: true,
        order_number: 9999,
      });
      await scopedDb.table('service_catalog').insert({
        service_id: serviceId,
        tenant: tenantId,
        service_name: `Time Entry Service ${uuidv4().slice(0, 6)}`,
        custom_service_type_id: serviceTypeId,
        billing_method: 'per_unit',
        item_kind: 'service',
        is_active: true,
        default_rate: 10000,
        unit_of_measure: 'hour',
      });
    }

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `TME-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `TME-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
    });

    const start = new Date();
    const end = new Date(start.getTime() + 30 * 60_000);

    for (const ticketId of [childId, masterId]) {
      await expect(
        runWithTenant(tenantId, async () => {
          await saveTimeEntry({
            work_item_id: ticketId,
            work_item_type: 'ticket',
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            created_at: start.toISOString(),
            updated_at: start.toISOString(),
            billable_duration: 30,
            notes: 'test',
            user_id: internalUser.user_id,
            approval_status: 'DRAFT',
            service_id: serviceId,
          } as any);
        })
      ).resolves.toBeUndefined();

      const entry = await scopedDb.table('time_entries')
        .where({ user_id: internalUser.user_id, work_item_id: ticketId, work_item_type: 'ticket' })
        .first();
      expect(entry).toBeTruthy();
    }
  });

  // ---------------------------------------------------------------------------
  // Sync-mode bundle status propagation (alga-2026-0002508)
  // ---------------------------------------------------------------------------

  async function setupSyncBundle(params: { childStatusIds?: string[] }) {
    const clientA = await createClient(db, tenantId, `Prop Client ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `prop-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `PRP-${uuidv4().slice(0, 6)}`, title: 'Prop master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    const childIds: string[] = [];
    for (const childStatusId of params.childStatusIds ?? [statusOpenId]) {
      const childId = uuidv4();
      childIds.push(childId);
      await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `PRP-${uuidv4().slice(0, 6)}`, title: 'Prop child', clientId: clientA, contactId: contactA, statusId: childStatusId, priorityId, boardId });
      if (childStatusId === statusClosedId) {
        // Fixture parity: a ticket inserted directly in a closed status needs
        // the denormalized close fields the app would normally have written.
        await tenantDb(db, tenantId).table('tickets')
          .where({ ticket_id: childId })
          .update({ is_closed: true, closed_at: db.fn.now(), closed_by: null });
      }
    }

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: childIds, mode: 'sync_updates' }, internalUser as any);
    });

    return { masterId, childIds };
  }

  // A second, distinct open ticket status lets a test drive an open -> open
  // master change (same status would be a no-op and never reach the mirror).
  async function createOpenStatus(): Promise<string> {
    const statusId = uuidv4();
    const maxOrder = await tenantDb(db, tenantId).table('statuses')
      .where({ board_id: boardId, status_type: 'ticket' })
      .max('order_number as max')
      .first();
    await tenantDb(db, tenantId).table('statuses').insert({
      tenant: tenantId,
      status_id: statusId,
      name: `In Progress ${uuidv4().slice(0, 4)}`,
      status_type: 'ticket',
      board_id: boardId,
      order_number: (Number(maxOrder?.max) || 0) + 1,
      created_by: internalUser.user_id,
      created_at: db.fn.now(),
      is_closed: false,
      is_default: false,
    });
    return statusId;
  }

  it('previews a sync-master close: open children affected, already-closed unaffected', async () => {
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId, statusClosedId] });

    const preview = await runWithTenant(tenantId, async () =>
      previewBundleStatusPropagationAction({ masterTicketId: masterId, newStatusId: statusClosedId }, internalUser as any));

    expect(preview.crossesBoundary).toBe('close');
    expect(preview.affectedChildren.map((c: any) => c.ticket_id)).toEqual([childIds[0]]);
    expect(preview.unaffectedChildren).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticket_id: childIds[1], reason: 'already_closed' }),
    ]));
  });

  it('returns crossesBoundary null for non-boundary changes and link_only masters', async () => {
    const { masterId } = await setupSyncBundle({ childStatusIds: [statusOpenId] });

    const openToOpen = await runWithTenant(tenantId, async () =>
      previewBundleStatusPropagationAction({ masterTicketId: masterId, newStatusId: statusOpenId }, internalUser as any));
    expect(openToOpen.crossesBoundary).toBeNull();

    const clientA = await createClient(db, tenantId, `Link Client ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `link-${uuidv4().slice(0, 6)}@example.com`);
    const linkMasterId = uuidv4();
    const linkChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: linkMasterId, ticketNumber: `LNK-${uuidv4().slice(0, 6)}`, title: 'Link master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: linkChildId, ticketNumber: `LNK-${uuidv4().slice(0, 6)}`, title: 'Link child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: linkMasterId, childTicketIds: [linkChildId], mode: 'link_only' }, internalUser as any);
    });

    const linkPreview = await runWithTenant(tenantId, async () =>
      previewBundleStatusPropagationAction({ masterTicketId: linkMasterId, newStatusId: statusClosedId }, internalUser as any));
    expect(linkPreview.crossesBoundary).toBeNull();
  });

  it('requires an explicit propagation choice and writes nothing when omitted', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });

    await runWithTenant(tenantId, async () => {
      await expect(
        updateTicketWithCache(masterId, { status_id: statusClosedId }, {} as any),
      ).rejects.toBeInstanceOf(BundlePropagationConfirmationRequiredError);
    });

    const masterAfter = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    const childAfter = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(masterAfter?.status_id).toBe(statusOpenId);
    expect(masterAfter?.is_closed).toBe(false);
    expect(childAfter?.status_id).toBe(statusOpenId);
    expect(childAfter?.is_closed).toBe(false);

    const propagationRows = await scopedDb.table('ticket_bundle_status_propagations').where({ master_ticket_id: masterId });
    expect(propagationRows.length).toBe(0);
  });

  it('propagateToChildren:false closes the master only and records propagated:false', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const anotherPriority = await scopedDb.table('priorities').andWhereNot({ priority_id: priorityId }).first();
    const nextPriorityId = anotherPriority?.priority_id ?? priorityId;

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(
        masterId,
        { status_id: statusClosedId, priority_id: nextPriorityId },
        { propagateToChildren: false } as any,
      );
    });

    const master = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(master?.status_id).toBe(statusClosedId);
    expect(master?.is_closed).toBe(true);
    expect(master?.priority_id).toBe(nextPriorityId);

    const child = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(child?.status_id).toBe(statusOpenId);
    expect(child?.is_closed).toBe(false);
    expect(child?.priority_id).toBe(priorityId);

    const propagationRows = await scopedDb.table('ticket_bundle_status_propagations').where({ master_ticket_id: masterId });
    expect(propagationRows.length).toBe(0);

    const activity = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: masterId, event_type: 'TICKET_BUNDLE_STATUS_PROPAGATED' })
      .first();
    expect(activity).toBeTruthy();
    expect(activity?.details?.propagated).toBe(false);
    expect(activity?.details?.action).toBe('close');
  });

  it('propagateToChildren:true closes only open children with consistent close fields', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId, statusClosedId] });
    const closedChildBefore = await scopedDb.table('tickets').where({ ticket_id: childIds[1] }).first();

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });

    const master = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(master?.is_closed).toBe(true);
    expect(master?.closed_at).toBeTruthy();
    expect(master?.closed_by).toBe(internalUser.user_id);

    const openChild = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(openChild?.status_id).toBe(statusClosedId);
    expect(openChild?.is_closed).toBe(true);
    expect(openChild?.closed_at).toBeTruthy();
    expect(openChild?.closed_by).toBe(internalUser.user_id);

    const preClosedChild = await scopedDb.table('tickets').where({ ticket_id: childIds[1] }).first();
    expect(preClosedChild?.status_id).toBe(statusClosedId);
    expect(preClosedChild?.is_closed).toBe(true);
    expect(preClosedChild?.closed_at).toEqual(closedChildBefore?.closed_at);
    expect(preClosedChild?.closed_by).toEqual(closedChildBefore?.closed_by);

    const propagationRows = await scopedDb.table('ticket_bundle_status_propagations').where({ master_ticket_id: masterId });
    expect(propagationRows.length).toBe(1);
    expect(propagationRows[0].child_ticket_id).toBe(childIds[0]);
    expect(propagationRows[0].action).toBe('close');
    expect(propagationRows[0].child_previous_status_id).toBe(statusOpenId);
    expect(propagationRows[0].reverted_at).toBeNull();
    expect(propagationRows[0].propagated_by).toBe(internalUser.user_id);
  });

  it('reopen reopens only propagated children; independently closed stays closed', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId, statusClosedId] });

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
      await updateTicketWithCache(masterId, { status_id: statusOpenId }, { propagateToChildren: true } as any);
    });

    const master = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(master?.status_id).toBe(statusOpenId);
    expect(master?.is_closed).toBe(false);

    const propagatedChild = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(propagatedChild?.status_id).toBe(statusOpenId);
    expect(propagatedChild?.is_closed).toBe(false);
    expect(propagatedChild?.closed_at).toBeNull();

    const independentChild = await scopedDb.table('tickets').where({ ticket_id: childIds[1] }).first();
    expect(independentChild?.status_id).toBe(statusClosedId);
    expect(independentChild?.is_closed).toBe(true);

    const propagationRows = await scopedDb.table('ticket_bundle_status_propagations').where({ master_ticket_id: masterId });
    expect(propagationRows.length).toBe(1);
    expect(propagationRows[0].reverted_at).toBeTruthy();
    expect(propagationRows[0].reverted_by).toBe(internalUser.user_id);
  });

  it('syncs priority-only updates without requiring the flag', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const anotherPriority = await scopedDb.table('priorities').andWhereNot({ priority_id: priorityId }).first();
    const nextPriorityId = anotherPriority?.priority_id ?? priorityId;

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { priority_id: nextPriorityId });
    });

    const child = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(child?.priority_id).toBe(nextPriorityId);
    expect(child?.status_id).toBe(statusOpenId);
  });

  it('removing a child reverts its active propagation row', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
      await removeChildFromBundleAction({ childTicketId: childIds[0] }, internalUser as any);
    });

    const row = await scopedDb.table('ticket_bundle_status_propagations').where({ child_ticket_id: childIds[0] }).first();
    expect(row?.reverted_at).toBeTruthy();

    // A later master reopen cannot touch the detached child.
    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusOpenId }, { propagateToChildren: true } as any);
    });
    const child = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(child?.status_id).toBe(statusClosedId);
    expect(child?.master_ticket_id).toBeNull();
  });

  it('non-boundary master status change leaves an independently closed child status untouched', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const openStatus2Id = await createOpenStatus();

    // Close the child independently. REST rejects this now: the shared
    // BUNDLE_CHILD_LOCKED_FIELDS gate refuses child workflow-field writes, so
    // the precondition is seeded with a direct row write (the shape an
    // out-of-band integration would produce).
    await closeTicketRow(db, tenantId, childIds[0], statusClosedId, internalUser.user_id);
    const closedChild = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(closedChild?.status_id).toBe(statusClosedId);
    expect(closedChild?.is_closed).toBe(true);

    // Master open -> open (non-boundary) must not stamp the new open status
    // onto the independently closed child.
    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: openStatus2Id });
    });

    const childAfter = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(childAfter?.status_id).toBe(statusClosedId);
    expect(childAfter?.is_closed).toBe(true);
  });

  it('close preview reports an independently closed child as unaffected after a non-boundary master change', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const openStatus2Id = await createOpenStatus();

    await closeTicketRow(db, tenantId, childIds[0], statusClosedId, internalUser.user_id);
    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: openStatus2Id });
    });

    const preview = await runWithTenant(tenantId, async () =>
      previewBundleStatusPropagationAction({ masterTicketId: masterId, newStatusId: statusClosedId }, internalUser as any));

    expect(preview.crossesBoundary).toBe('close');
    expect(preview.affectedChildren).toEqual([]);
    // A close preview reports a child already closed as `already_closed` (see
    // F005); the point is that it is unaffected, not silently dragged open.
    expect(preview.unaffectedChildren).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticket_id: childIds[0], reason: 'already_closed' }),
    ]));
  });

  it('propagated reopen leaves an independently closed child closed after a non-boundary master change', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const openStatus2Id = await createOpenStatus();

    await closeTicketRow(db, tenantId, childIds[0], statusClosedId, internalUser.user_id);
    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: openStatus2Id });
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
      await updateTicketWithCache(masterId, { status_id: statusOpenId }, { propagateToChildren: true } as any);
    });

    const childAfter = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(childAfter?.status_id).toBe(statusClosedId);
    expect(childAfter?.is_closed).toBe(true);

    // The independently closed child was never part of a propagated close, so
    // the reopen has no active ledger row to reverse.
    const propagationRows = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childIds[0] });
    expect(propagationRows.length).toBe(0);
  });

  it('bulk preview returns only sync masters whose change crosses the boundary', async () => {
    const { masterId } = await setupSyncBundle({ childStatusIds: [statusOpenId] });

    const clientA = await createClient(db, tenantId, `Bulk Client ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `bulk-${uuidv4().slice(0, 6)}@example.com`);
    const nonMasterId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: nonMasterId, ticketNumber: `BLK-${uuidv4().slice(0, 6)}`, title: 'Non master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    const previews = await runWithTenant(tenantId, async () =>
      previewBulkBundleStatusPropagationAction({ ticketIds: [masterId, nonMasterId], newStatusId: statusClosedId }, internalUser as any));

    expect(Object.keys(previews)).toEqual([masterId]);
    expect(previews[masterId].crossesBoundary).toBe('close');
  });

  it('bulk status update honours propagateToChildren for sync masters', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });

    const result = await runWithTenant(tenantId, async () =>
      bulkUpdateTicketStatus([masterId], statusClosedId, { propagateToChildren: false }));

    expect(result.failed).toEqual([]);
    expect(result.updatedIds).toEqual([masterId]);

    const child = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(child?.status_id).toBe(statusOpenId);
    expect(child?.is_closed).toBe(false);
  });

  it('REST TicketService.update shares the propagation contract (409 source)', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const service = new TicketService();

    await runWithTenant(tenantId, async () => {
      await expect(
        service.update(masterId, { status_id: statusClosedId }, { tenant: tenantId, userId: internalUser.user_id }),
      ).rejects.toBeInstanceOf(BundlePropagationConfirmationRequiredError);
    });

    const masterAfter = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(masterAfter?.status_id).toBe(statusOpenId);

    await runWithTenant(tenantId, async () => {
      await service.update(masterId, { status_id: statusClosedId, propagateToChildren: true }, { tenant: tenantId, userId: internalUser.user_id });
    });

    const childAfter = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(childAfter?.status_id).toBe(statusClosedId);
    expect(childAfter?.is_closed).toBe(true);
  });

  // Regression: REST propagation previously passed only `{ user_id }`, so
  // propagationDisplayName() persisted the literal 'Unknown User' onto the
  // master's TICKET_BUNDLE_STATUS_PROPAGATED row. It is a stored value, so the
  // timeline would show it forever. The REST context carries only a userId, so
  // the service must resolve the acting user's name fields in-transaction.
  it('REST propagation audit records the acting user display name, not Unknown User', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const service = new TicketService();

    await runWithTenant(tenantId, async () => {
      await service.update(
        masterId,
        { status_id: statusClosedId, propagateToChildren: true },
        { tenant: tenantId, userId: internalUser.user_id },
      );
    });

    const child = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(child?.is_closed).toBe(true);

    const activity = await scopedDb.table('ticket_audit_logs')
      .where({ ticket_id: masterId, event_type: 'TICKET_BUNDLE_STATUS_PROPAGATED' })
      .first();
    expect(activity).toBeTruthy();
    expect(activity?.details?.propagated).toBe(true);
    expect(activity?.actor_user_id).toBe(internalUser.user_id);
    expect(activity?.actor_display_name).toBe(
      `${internalUser.first_name} ${internalUser.last_name}`,
    );
    expect(activity?.actor_display_name).not.toBe('Unknown User');
  });

  it('REST TicketService.update with propagateToChildren:false changes the master only', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const service = new TicketService();

    await runWithTenant(tenantId, async () => {
      await service.update(masterId, { status_id: statusClosedId, propagateToChildren: false }, { tenant: tenantId, userId: internalUser.user_id });
    });

    const master = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(master?.is_closed).toBe(true);
    const child = await scopedDb.table('tickets').where({ ticket_id: childIds[0] }).first();
    expect(child?.is_closed).toBe(false);
  });

  // Regression (alga-2026-0002508): a child reopened while a stale active
  // propagation row survives must not abort the next propagated master close on
  // the (tenant, child_ticket_id) WHERE reverted_at IS NULL unique index.
  it('master close after an independently reopened child reverts the stale row instead of aborting', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const childId = childIds[0];

    await runWithTenant(tenantId, async () => {
      // 1. Master close propagates and records an active row for the child.
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });
    const firstRow = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId })
      .first();
    expect(firstRow?.reverted_at).toBeNull();

    // 2. Child reopened out of band (a direct row write): REST cannot reopen a
    //    bundled child because of the workflow-field lock, but an out-of-band
    //    integration can leave exactly this state — an open child with a stale
    //    active propagation row. This is the case the engine's revert-then-insert
    //    must survive.
    await tenantDb(db, tenantId).table('tickets').where({ ticket_id: childId }).update({
      status_id: statusOpenId,
      is_closed: false,
      closed_at: null,
      closed_by: null,
      updated_at: db.fn.now(),
    });

    await runWithTenant(tenantId, async () => {
      // 3. Master reopen (propagated). The child is open, so it is unaffected.
      await updateTicketWithCache(masterId, { status_id: statusOpenId }, { propagateToChildren: true } as any);
    });

    const childAfterReopen = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(childAfterReopen?.status_id).toBe(statusOpenId);
    expect(childAfterReopen?.is_closed).toBe(false);

    // 4. Master close again propagates to the now-open child. The stale active
    //    row must be reverted before the new insert or the whole status change
    //    aborts on the unique index.
    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });

    const master = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(master?.is_closed).toBe(true);

    const childClosed = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(childClosed?.status_id).toBe(statusClosedId);
    expect(childClosed?.is_closed).toBe(true);
    expect(childClosed?.closed_at).toBeTruthy();
    expect(childClosed?.closed_by).toBe(internalUser.user_id);

    const rows = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId });
    const activeRows = rows.filter((row: any) => row.reverted_at === null);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].child_previous_status_id).toBe(statusOpenId);
    expect(activeRows[0].propagated_by).toBe(internalUser.user_id);
    // The superseded row is reverted, not orphaned alongside the new one.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.filter((row: any) => row.reverted_at !== null)).toHaveLength(rows.length - 1);
  });

  it('REST child reopen is rejected by the bundle workflow lock and leaves the propagation ledger intact', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const childId = childIds[0];
    const service = new TicketService();

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });

    const activeBefore = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId })
      .first();
    expect(activeBefore?.reverted_at).toBeNull();

    // The REST surface refuses to move a bundled child's status (main's
    // BUNDLE_CHILD_LOCKED_FIELDS gate), so the ledger cannot end up
    // disagreeing with tickets.is_closed through this path.
    const rejection = await runWithTenant(tenantId, async () =>
      service.update(childId, { status_id: statusOpenId }, { tenant: tenantId, userId: internalUser.user_id })
        .then(() => null, (error: unknown) => error));
    expect(rejection).toBeInstanceOf(ValidationError);

    const childStillClosed = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(childStillClosed?.status_id).toBe(statusClosedId);
    expect(childStillClosed?.is_closed).toBe(true);

    const ledgerAfter = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId })
      .first();
    expect(ledgerAfter?.reverted_at).toBeNull();

    // A propagated master reopen now correctly reverses the close it performed:
    // the child is still in the affected set because REST could not remove it.
    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusOpenId }, { propagateToChildren: true } as any);
    });

    const child = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(child?.status_id).toBe(statusOpenId);
    expect(child?.is_closed).toBe(false);

    const rows = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId });
    expect(rows).toHaveLength(1);
    expect(rows[0].reverted_at).toBeTruthy();
  });

  // Belt A in isolation: a stale active row written outside the ledger (direct
  // DB child reopen) must be reverted by the propagation engine before the next
  // propagated master close inserts — independent of any write-path hook.
  it('reverts a stale active row written outside the ledger before a propagated master close', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const { masterId, childIds } = await setupSyncBundle({ childStatusIds: [statusOpenId] });
    const childId = childIds[0];

    await runWithTenant(tenantId, async () => {
      // Propagated close leaves an active row for the child.
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });
    const seeded = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId })
      .first();
    expect(seeded?.reverted_at).toBeNull();

    // Flip the child open directly, deliberately leaving the ledger row active.
    // No belt-B write path runs here, so only the engine can clear it.
    await tenantDb(db, tenantId).table('tickets')
      .where({ ticket_id: childId })
      .update({ status_id: statusOpenId, is_closed: false, closed_at: null, closed_by: null });

    await runWithTenant(tenantId, async () => {
      // Master reopen: the child is open so it is unaffected; the stale row stays.
      await updateTicketWithCache(masterId, { status_id: statusOpenId }, { propagateToChildren: true } as any);
    });
    const rowBefore = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId })
      .first();
    expect(rowBefore?.reverted_at).toBeNull();

    // Propagated close again: the engine must revert the stale row before the
    // insert or the whole status change aborts on the per-child unique index.
    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, { propagateToChildren: true } as any);
    });

    const master = await scopedDb.table('tickets').where({ ticket_id: masterId }).first();
    expect(master?.is_closed).toBe(true);

    const child = await scopedDb.table('tickets').where({ ticket_id: childId }).first();
    expect(child?.status_id).toBe(statusClosedId);
    expect(child?.is_closed).toBe(true);

    const rows = await scopedDb.table('ticket_bundle_status_propagations')
      .where({ child_ticket_id: childId });
    const activeRows = rows.filter((row: any) => row.reverted_at === null);
    expect(activeRows).toHaveLength(1);
    expect(activeRows[0].child_previous_status_id).toBe(statusOpenId);
    expect(activeRows[0].propagated_by).toBe(internalUser.user_id);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row: any) => row.reverted_at !== null)).toHaveLength(1);
  });
});

async function ensureTenant(connection: Knex, name: string): Promise<string> {
  const row = await tenantDb(connection, '__test_discovery__')
    .unscoped('tenants', 'test discovery of seeded tenant for ticket bundling integration')
    .first<{ tenant: string }>('tenant');
  if (row?.tenant) {
    return row.tenant;
  }
  return createTenant(connection, name);
}

async function ensureTicketReferenceData(connection: Knex, tenant: string, createdByUserId: string): Promise<void> {
  const scopedDb = tenantDb(connection, tenant);
  let boardId = (await scopedDb.table('boards')
    .orderBy('is_default', 'desc')
    .first<{ board_id: string }>('board_id'))?.board_id;
  if (!boardId) {
    boardId = uuidv4();
    await scopedDb.table('boards').insert({
      tenant,
      board_id: boardId,
      board_name: 'Test Board',
      display_order: 0,
      is_default: true,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
    });
  }

  // Ticket statuses are board-scoped; ensure the chosen board has open and closed statuses.
  const hasTicketStatuses = await scopedDb.table('statuses')
    .where({ status_type: 'ticket', is_closed: false, board_id: boardId })
    .first<{ status_id: string }>('status_id');
  if (!hasTicketStatuses?.status_id) {
    await scopedDb.table('statuses').insert({
      tenant,
      status_id: uuidv4(),
      name: 'Open',
      status_type: 'ticket',
      board_id: boardId,
      order_number: 1,
      created_by: createdByUserId,
      created_at: connection.fn.now(),
      is_closed: false,
      is_default: true,
    });
  }

  const hasClosedTicketStatus = await scopedDb.table('statuses')
    .where({ status_type: 'ticket', is_closed: true, board_id: boardId })
    .first<{ status_id: string }>('status_id');
  if (!hasClosedTicketStatus?.status_id) {
    await scopedDb.table('statuses').insert({
      tenant,
      status_id: uuidv4(),
      name: 'Closed',
      status_type: 'ticket',
      board_id: boardId,
      order_number: 99,
      created_by: createdByUserId,
      created_at: connection.fn.now(),
      is_closed: true,
      is_default: false,
    });
  }

  const existingPriority = await scopedDb.table('priorities').first<{ priority_id: string }>('priority_id');
  if (!existingPriority?.priority_id) {
    await scopedDb.table('priorities').insert({
      tenant,
      priority_id: uuidv4(),
      priority_name: 'Normal',
      created_by: createdByUserId,
      created_at: connection.fn.now(),
      order_number: 50,
      item_type: 'ticket',
      color: '#6B7280',
    });
  }
}

async function loadTicketReferenceData(connection: Knex, tenant: string) {
  // Ticket statuses are board-scoped, so pick a board that has both an open
  // and a closed ticket status, then select statuses from that board only.
  const scopedDb = tenantDb(connection, tenant);
  const ticketStatusFilter = function (this: Knex.QueryBuilder) {
    this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
  };
  const openStatusExists = scopedDb.table('statuses as s_open')
    .select(connection.raw('1'))
    .whereRaw('?? = ??', ['s_open.board_id', 'b.board_id'])
    .where('s_open.is_closed', false)
    .andWhere(ticketStatusFilter);
  const closedStatusExists = scopedDb.table('statuses as s_closed')
    .select(connection.raw('1'))
    .whereRaw('?? = ??', ['s_closed.board_id', 'b.board_id'])
    .where('s_closed.is_closed', true)
    .andWhere(ticketStatusFilter);
  const board = await scopedDb.table('boards as b')
    .whereExists(openStatusExists)
    .whereExists(closedStatusExists)
    .orderBy('b.is_default', 'desc')
    .first<{ board_id: string }>('b.board_id as board_id');
  const openStatus = await scopedDb.table('statuses')
    .where({ is_closed: false, board_id: board?.board_id })
    .andWhere(ticketStatusFilter)
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first<{ status_id: string }>('status_id');
  const closedStatus = await scopedDb.table('statuses')
    .where({ is_closed: true, board_id: board?.board_id })
    .andWhere(ticketStatusFilter)
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first<{ status_id: string }>('status_id');
  const prio = await scopedDb.table('priorities').orderBy('order_number', 'asc').first<{ priority_id: string }>('priority_id');

  if (!board?.board_id || !openStatus?.status_id || !closedStatus?.status_id || !prio?.priority_id) {
    throw new Error('Missing reference data (boards/statuses/priorities) for ticket bundling integration test');
  }

  return {
    boardId: board.board_id,
    statusOpenId: openStatus.status_id,
    statusClosedId: closedStatus.status_id,
    priorityId: prio.priority_id,
  };
}

async function createContact(connection: Knex, tenant: string, clientId: string, email: string): Promise<string> {
  const contactId = uuidv4();
  await tenantDb(connection, tenant).table('contacts').insert({
    tenant,
    contact_name_id: contactId,
    full_name: 'Bundling Contact',
    client_id: clientId,
    email,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return contactId;
}

async function ensureDefaultClientLocation(connection: Knex, tenant: string, clientId: string, email: string): Promise<void> {
  const scopedDb = tenantDb(connection, tenant);
  const existing = await scopedDb.table('client_locations')
    .where({ client_id: clientId, is_default: true, is_active: true })
    .first('location_id');
  if (existing) return;

  await scopedDb.table('client_locations').insert({
    tenant,
    location_id: uuidv4(),
    client_id: clientId,
    location_name: 'Default',
    address_line1: '123 Test St',
    city: 'Test City',
    country_code: 'US',
    country_name: 'United States',
    is_default: true,
    is_active: true,
    email,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}

async function insertTicket(connection: Knex, params: {
  tenant: string;
  ticketId: string;
  ticketNumber: string;
  title: string;
  clientId: string;
  contactId: string;
  statusId: string;
  priorityId: string;
  boardId: string;
}): Promise<void> {
  await tenantDb(connection, params.tenant).table('tickets').insert({
    tenant: params.tenant,
    ticket_id: params.ticketId,
    ticket_number: params.ticketNumber,
    title: params.title,
    client_id: params.clientId,
    contact_name_id: params.contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    board_id: params.boardId,
    email_metadata: JSON.stringify({
      messageId: `message-${uuidv4()}@mail`,
      threadId: `thread-${uuidv4()}`,
      references: [],
    }),
    entered_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
}

async function closeTicketRow(
  connection: Knex,
  tenant: string,
  ticketId: string,
  statusId: string,
  closedBy: string
): Promise<void> {
  await tenantDb(connection, tenant).table('tickets').where({ ticket_id: ticketId }).update({
    status_id: statusId,
    is_closed: true,
    closed_at: connection.fn.now(),
    closed_by: closedBy,
    updated_at: connection.fn.now(),
  });
}

async function insertResolutionComment(
  connection: Knex,
  tenant: string,
  ticketId: string,
  userId: string,
  options: { isInternal: boolean; isResolution: boolean; note: string }
): Promise<string> {
  const scopedDb = tenantDb(connection, tenant);
  const commentId = uuidv4();
  const threadId = uuidv4();
  await scopedDb.table('comment_threads').insert({
    tenant,
    thread_id: threadId,
    ticket_id: ticketId,
    project_task_id: null,
    root_comment_id: commentId,
    is_internal: options.isInternal,
    reply_count: 0,
    last_activity_at: connection.fn.now(),
    created_at: connection.fn.now(),
    created_by: null,
  });
  await scopedDb.table('comments').insert({
    tenant,
    comment_id: commentId,
    thread_id: threadId,
    ticket_id: ticketId,
    user_id: userId,
    author_type: 'unknown',
    note: options.note,
    markdown_content: options.note,
    is_internal: options.isInternal,
    is_resolution: options.isResolution,
    is_system_generated: false,
    created_at: connection.fn.now(),
  });
  return commentId;
}

async function upsertBoardCloseRules(
  connection: Knex,
  tenant: string,
  boardId: string,
  overrides: Partial<{
    require_resolution_comment: boolean;
    require_time_entry: boolean;
    require_checklist_complete: boolean;
    require_no_open_children: boolean;
    is_enabled: boolean;
  }>
): Promise<void> {
  const scopedDb = tenantDb(connection, tenant);
  const existing = await scopedDb.table('board_close_rules').where({ board_id: boardId }).first();
  if (existing) {
    await scopedDb.table('board_close_rules').where({ board_id: boardId }).update({
      ...overrides,
      updated_at: connection.fn.now(),
    });
    return;
  }
  await scopedDb.table('board_close_rules').insert({
    tenant,
    board_id: boardId,
    required_fields: JSON.stringify([]),
    ...overrides,
  });
}

async function clearBoardCloseRules(connection: Knex, tenant: string, boardId: string): Promise<void> {
  await tenantDb(connection, tenant).table('board_close_rules').where({ board_id: boardId }).delete();
}

async function grantUserPermissions(
  connection: Knex,
  tenant: string,
  userId: string,
  permissions: Array<{ resource: string; action: string }>
) {
  const roleId = uuidv4();
  const scopedDb = tenantDb(connection, tenant);
  await scopedDb.table('roles').insert({
    tenant,
    role_id: roleId,
    role_name: `Bundling Test Role ${uuidv4().slice(0, 8)}`,
    description: 'Test role for ticket bundling integration',
    msp: true,
    client: false,
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });

  for (const perm of permissions) {
    const existingPerm = await scopedDb.table('permissions')
      .where({ resource: perm.resource, action: perm.action })
      .first<{ permission_id: string }>('permission_id');
    const permissionId = existingPerm?.permission_id ?? uuidv4();
    if (!existingPerm) {
      await scopedDb.table('permissions').insert({
        tenant,
        permission_id: permissionId,
        resource: perm.resource,
        action: perm.action,
        msp: true,
        client: false,
        created_at: connection.fn.now(),
      });
    }
    await scopedDb.table('role_permissions')
      .insert({
        tenant,
        role_id: roleId,
        permission_id: permissionId,
        created_at: connection.fn.now(),
      })
      .onConflict(['tenant', 'role_id', 'permission_id'])
      .ignore();
  }

  await scopedDb.table('user_roles')
    .insert({
      tenant,
      user_id: userId,
      role_id: roleId,
      created_at: connection.fn.now(),
    })
    .onConflict(['tenant', 'user_id', 'role_id'])
    .ignore();
}
