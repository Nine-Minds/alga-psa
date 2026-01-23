import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? ''),
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

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: mockSessionUserId ? { id: mockSessionUserId } : undefined,
  })),
}));

vi.mock('@alga-psa/users/actions', async () => {
  return {
    getCurrentUser: vi.fn(async () => mockCurrentUser),
  };
});

let runWithTenant: any;
let bundleTicketsAction: any;
let addChildrenToBundleAction: any;
let removeChildFromBundleAction: any;
let unbundleMasterTicketAction: any;
let promoteBundleMasterAction: any;
let updateBundleSettingsAction: any;
let updateTicketWithCache: any;
let addTicketCommentWithCache: any;
let getConsolidatedTicketData: any;
let updateComment: any;
let createComment: any;
let saveTimeEntry: any;

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
      removeChildFromBundleAction,
      unbundleMasterTicketAction,
      promoteBundleMasterAction,
      updateBundleSettingsAction,
    } = await import('@alga-psa/tickets/actions/ticketBundleActions'));

    ({ updateTicketWithCache, addTicketCommentWithCache, getConsolidatedTicketData } = await import(
      '@alga-psa/tickets/actions/optimizedTicketActions'
    ));

    ({ updateComment, createComment } = await import('@/lib/actions/comment-actions/commentActions'));
    ({ saveTimeEntry } = await import('@/lib/actions/timeEntryCrudActions'));

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
      { resource: 'timeentry', action: 'create' },
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

    await expect(
      runWithTenant(tenantId, async () => {
        await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'link_only' }, noPermUser as any);
      })
    ).rejects.toThrow(/permission denied/i);

    await grantUserPermissions(db, tenantId, noPermUserId, [
      { resource: 'ticket', action: 'update' },
      { resource: 'ticket', action: 'read' },
    ]);

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'link_only' }, noPermUser as any);
    });

    const linkedChild = await db('tickets').where({ tenant: tenantId, ticket_id: childId }).first();
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

    const child1 = await db('tickets').where({ tenant: tenantId, ticket_id: child1Id }).first();
    const child2 = await db('tickets').where({ tenant: tenantId, ticket_id: child2Id }).first();
    expect(child1?.master_ticket_id).toBe(masterId);
    expect(child2?.master_ticket_id).toBe(masterId);
    expect(child2?.status_id).toBe(statusClosedId);

    const settings = await db('ticket_bundle_settings').where({ tenant: tenantId, master_ticket_id: masterId }).first();
    expect(settings).toBeTruthy();
    expect(settings?.mode).toBe('sync_updates');

    // Cannot add an already-bundled ticket to a bundle
    await expect(
      runWithTenant(tenantId, async () => {
        await addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [child1Id] }, internalUser as any);
      })
    ).rejects.toThrow(/already bundled/i);

    // Cannot add a bundle master as a child (no nesting)
    const otherMasterId = uuidv4();
    const nestedChildId = uuidv4();
    await insertTicket(db, { tenant: tenantId, ticketId: otherMasterId, ticketNumber: `BND-${uuidv4().slice(0, 6)}`, title: 'Other master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: nestedChildId, ticketNumber: `BND-${uuidv4().slice(0, 6)}`, title: 'Nested child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: otherMasterId, childTicketIds: [nestedChildId], mode: 'link_only' }, internalUser as any);
    });

    await expect(
      runWithTenant(tenantId, async () => {
        await addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [otherMasterId] }, internalUser as any);
      })
    ).rejects.toThrow(/cannot be added as children/i);

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

    await expect(
      runWithTenant(tenantId, async () => {
        await addChildrenToBundleAction({ masterTicketId: masterId, childTicketIds: [foreignTicketId] }, internalUser as any);
      })
    ).rejects.toThrow(/not found/i);

    // Remove a child only unlinks that ticket.
    await runWithTenant(tenantId, async () => {
      await removeChildFromBundleAction({ childTicketId: child2Id }, internalUser as any);
    });
    const child2After = await db('tickets').where({ tenant: tenantId, ticket_id: child2Id }).first();
    expect(child2After?.master_ticket_id).toBeNull();

    // Unbundle detaches all children + removes settings.
    await runWithTenant(tenantId, async () => {
      await unbundleMasterTicketAction({ masterTicketId: masterId }, internalUser as any);
    });
    const child1After = await db('tickets').where({ tenant: tenantId, ticket_id: child1Id }).first();
    expect(child1After?.master_ticket_id).toBeNull();
    const settingsAfter = await db('ticket_bundle_settings').where({ tenant: tenantId, master_ticket_id: masterId }).first();
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
      await expect(
        promoteBundleMasterAction({ oldMasterTicketId: oldMasterId, newMasterTicketId: oldMasterId }, internalUser as any)
      ).rejects.toThrow(/must be different/i);
      await promoteBundleMasterAction({ oldMasterTicketId: oldMasterId, newMasterTicketId: child1Id }, internalUser as any);
    });

    const newMaster = await db('tickets').where({ tenant: tenantId, ticket_id: child1Id }).first();
    expect(newMaster?.master_ticket_id).toBeNull();
    const oldMaster = await db('tickets').where({ tenant: tenantId, ticket_id: oldMasterId }).first();
    expect(oldMaster?.master_ticket_id).toBe(child1Id);
    const otherChild = await db('tickets').where({ tenant: tenantId, ticket_id: child2Id }).first();
    expect(otherChild?.master_ticket_id).toBe(child1Id);

    const settings = await db('ticket_bundle_settings').where({ tenant: tenantId, master_ticket_id: child1Id }).first();
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

    const anotherPriority = await db('priorities').where({ tenant: tenantId }).andWhereNot({ priority_id: priorityId }).first();
    const nextPriorityId = anotherPriority?.priority_id ?? priorityId;

    await runWithTenant(tenantId, async () => {
      await updateTicketWithCache(masterId, { status_id: statusClosedId, priority_id: nextPriorityId }, internalUser as any);
    });

    const childAfter = await db('tickets').where({ tenant: tenantId, ticket_id: childId }).first();
    expect(childAfter?.status_id).toBe(statusClosedId);
    expect(childAfter?.priority_id).toBe(nextPriorityId);

    await expect(
      runWithTenant(tenantId, async () => {
        await updateTicketWithCache(childId, { status_id: statusOpenId }, internalUser as any);
      })
    ).rejects.toThrow();

    const childAfterLockAttempt = await db('tickets').where({ tenant: tenantId, ticket_id: childId }).first();
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

    await runWithTenant(tenantId, async () => {
      await addTicketCommentWithCache(masterId, content, false, false, internalUser as any);
    });

    const mirrored = await db('comments')
      .where({ tenant: tenantId, ticket_id: childId })
      .andWhere({ is_system_generated: true })
      .first();

    expect(mirrored).toBeTruthy();
    expect(mirrored?.is_internal).toBe(false);

    const originalNote = mirrored?.note;
    await expect(
      runWithTenant(tenantId, async () => {
        await updateComment(mirrored.comment_id, { note: 'edited' } as any);
      })
    ).rejects.toThrow();

    const mirroredAfter = await db('comments').where({ tenant: tenantId, comment_id: mirrored.comment_id }).first();
    expect(mirroredAfter?.note).toBe(originalNote);
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
      await updateTicketWithCache(masterId, { status_id: statusClosedId }, internalUser as any);
    });

    const closedMaster = await db('tickets').where({ tenant: tenantId, ticket_id: masterId }).first();
    expect(closedMaster?.status_id).toBe(statusClosedId);

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

    const reopenedMaster = await db('tickets').where({ tenant: tenantId, ticket_id: masterId }).first();
    expect(reopenedMaster?.status_id).toBe(statusOpenId);
    expect(reopenedMaster?.closed_at).toBeNull();
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

  it('blocks time entries on bundled children and allows time entries on masters', async () => {
    const clientA = await createClient(db, tenantId, `Client A ${uuidv4().slice(0, 6)}`);
    const contactA = await createContact(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childId = uuidv4();

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: `TME-${uuidv4().slice(0, 6)}`, title: 'Master', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childId, ticketNumber: `TME-${uuidv4().slice(0, 6)}`, title: 'Child', clientId: clientA, contactId: contactA, statusId: statusOpenId, priorityId, boardId });

    await runWithTenant(tenantId, async () => {
      await bundleTicketsAction({ masterTicketId: masterId, childTicketIds: [childId], mode: 'sync_updates' }, internalUser as any);
    });

    const start = new Date();
    const end = new Date(start.getTime() + 30 * 60_000);

    await expect(
      runWithTenant(tenantId, async () => {
        await saveTimeEntry({
          work_item_id: childId,
          work_item_type: 'ticket',
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          created_at: start.toISOString(),
          updated_at: start.toISOString(),
          billable_duration: 30,
          notes: 'test',
          user_id: internalUser.user_id,
          approval_status: 'DRAFT',
        } as any);
      })
    ).rejects.toThrow(/must be added on the master/i);

    await expect(
      runWithTenant(tenantId, async () => {
        await saveTimeEntry({
          work_item_id: masterId,
          work_item_type: 'ticket',
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          created_at: start.toISOString(),
          updated_at: start.toISOString(),
          billable_duration: 30,
          notes: 'test',
          user_id: internalUser.user_id,
          approval_status: 'DRAFT',
        } as any);
      })
    ).resolves.toBeUndefined();

    const entry = await db('time_entries')
      .where({ tenant: tenantId, user_id: internalUser.user_id, work_item_id: masterId, work_item_type: 'ticket' })
      .first();
    expect(entry).toBeTruthy();
  });
});

async function ensureTenant(connection: Knex, name: string): Promise<string> {
  const row = await connection('tenants').first<{ tenant: string }>('tenant');
  if (row?.tenant) {
    return row.tenant;
  }
  return createTenant(connection, name);
}

async function ensureTicketReferenceData(connection: Knex, tenant: string, createdByUserId: string): Promise<void> {
  const existingBoard = await connection('boards').where({ tenant }).first<{ board_id: string }>('board_id');
  if (!existingBoard?.board_id) {
    await connection('boards').insert({
      tenant,
      board_id: uuidv4(),
      board_name: 'Test Board',
      display_order: 0,
      is_default: true,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
    });
  }

  const hasTicketStatuses = await connection('statuses')
    .where({ tenant, status_type: 'ticket', is_closed: false })
    .first<{ status_id: string }>('status_id');
  if (!hasTicketStatuses?.status_id) {
    await connection('statuses').insert({
      tenant,
      status_id: uuidv4(),
      name: 'Open',
      status_type: 'ticket',
      order_number: 1,
      created_by: createdByUserId,
      created_at: connection.fn.now(),
      is_closed: false,
      is_default: true,
    });
  }

  const hasClosedTicketStatus = await connection('statuses')
    .where({ tenant, status_type: 'ticket', is_closed: true })
    .first<{ status_id: string }>('status_id');
  if (!hasClosedTicketStatus?.status_id) {
    await connection('statuses').insert({
      tenant,
      status_id: uuidv4(),
      name: 'Closed',
      status_type: 'ticket',
      order_number: 99,
      created_by: createdByUserId,
      created_at: connection.fn.now(),
      is_closed: true,
      is_default: false,
    });
  }

  const existingPriority = await connection('priorities').where({ tenant }).first<{ priority_id: string }>('priority_id');
  if (!existingPriority?.priority_id) {
    await connection('priorities').insert({
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
  const board = await connection('boards').where({ tenant }).first<{ board_id: string }>('board_id');
  const openStatus = await connection('statuses')
    .where({ tenant, is_closed: false })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first<{ status_id: string }>('status_id');
  const closedStatus = await connection('statuses')
    .where({ tenant, is_closed: true })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first<{ status_id: string }>('status_id');
  const prio = await connection('priorities').where({ tenant }).orderBy('order_number', 'asc').first<{ priority_id: string }>('priority_id');

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
  await connection('contacts').insert({
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
  const existing = await connection('client_locations')
    .where({ tenant, client_id: clientId, is_default: true, is_active: true })
    .first('location_id');
  if (existing) return;

  await connection('client_locations').insert({
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
  await connection('tickets').insert({
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

async function grantUserPermissions(
  connection: Knex,
  tenant: string,
  userId: string,
  permissions: Array<{ resource: string; action: string }>
) {
  const roleId = uuidv4();
  await connection('roles').insert({
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
    const existingPerm = await connection('permissions')
      .where({ tenant, resource: perm.resource, action: perm.action })
      .first<{ permission_id: string }>('permission_id');
    const permissionId = existingPerm?.permission_id ?? uuidv4();
    if (!existingPerm) {
      await connection('permissions').insert({
        tenant,
        permission_id: permissionId,
        resource: perm.resource,
        action: perm.action,
        msp: true,
        client: false,
        created_at: connection.fn.now(),
      });
    }
    await connection('role_permissions')
      .insert({
        tenant,
        role_id: roleId,
        permission_id: permissionId,
        created_at: connection.fn.now(),
      })
      .onConflict(['tenant', 'role_id', 'permission_id'])
      .ignore();
  }

  await connection('user_roles')
    .insert({
      tenant,
      user_id: userId,
      role_id: roleId,
      created_at: connection.fn.now(),
    })
    .onConflict(['tenant', 'user_id', 'role_id'])
    .ignore();
}
