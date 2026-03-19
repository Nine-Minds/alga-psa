// Import mocks first to ensure they're hoisted
import 'server/test-utils/testMocks';

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { TestContext } from 'server/test-utils/testContext';
import { setupCommonMocks } from 'server/test-utils/testMocks';
import { v4 as uuidv4 } from 'uuid';

import { toggleCommentReaction, getCommentsReactionsBatch } from '@alga-psa/tickets/actions/comment-actions/commentReactionActions';
import { toggleTaskCommentReaction, getTaskCommentsReactionsBatch } from '@alga-psa/projects/actions/projectTaskCommentReactionActions';

// Suppress event publishing (not relevant for reaction tests)
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

// Hoisted refs so mocks return the test transaction and user
const dbRef = vi.hoisted(() => ({
  knex: null as any,
  tenant: '' as string,
}));

const userRef = vi.hoisted(() => ({
  user: null as any,
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: dbRef.knex, tenant: dbRef.tenant })),
}));

// Mock withAuth to bypass session/tenant resolution and call the action directly
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action(userRef.user, { tenant: dbRef.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));

const HOOK_TIMEOUT = 120_000;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext,
} = TestContext.createHelpers();

let context: TestContext;

beforeAll(async () => {
  context = await setupContext({
    runSeeds: true,
    cleanupTables: [
      'comment_reactions', 'project_task_comment_reactions',
      'comments', 'project_task_comments',
      'project_tasks', 'project_phases', 'projects', 'tickets',
    ],
  });

  setupCommonMocks({
    tenantId: context.tenantId,
    userId: context.userId,
    user: context.user,
    permissionCheck: () => true,
  });
}, HOOK_TIMEOUT);

afterAll(async () => {
  await cleanupContext();
}, HOOK_TIMEOUT);

describe('Comment Reactions - Ticket Comments', () => {
  let ticketId: string;
  let commentId: string;
  let secondCommentId: string;

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true,
    });
    dbRef.knex = context.db;
    dbRef.tenant = context.tenantId;
    userRef.user = context.user;

    // Create a ticket
    ticketId = uuidv4();

    // Get or create a default ticket status
    let statusId: string;
    const existingStatus = await context.db('statuses')
      .where({ tenant: context.tenantId, status_type: 'ticket' })
      .first();

    if (existingStatus) {
      statusId = existingStatus.status_id;
    } else {
      const [status] = await context.db('statuses')
        .insert({
          tenant: context.tenantId,
          name: 'Open',
          status_type: 'ticket',
          order_number: 1,
          created_by: context.userId,
          is_closed: false,
          is_default: true,
        })
        .returning('status_id');
      statusId = status.status_id;
    }

    await context.db('tickets').insert({
      ticket_id: ticketId,
      tenant: context.tenantId,
      ticket_number: `TEST-${Date.now()}`,
      title: 'Test Ticket for Reactions',
      status_id: statusId,
      client_id: context.clientId,
      entered_by: context.userId,
    });

    // Create two comments
    commentId = uuidv4();
    secondCommentId = uuidv4();
    await context.db('comments').insert([
      {
        comment_id: commentId,
        tenant: context.tenantId,
        ticket_id: ticketId,
        user_id: context.userId,
        note: '[]',
        is_internal: false,
        is_resolution: false,
        author_type: 'internal',
      },
      {
        comment_id: secondCommentId,
        tenant: context.tenantId,
        ticket_id: ticketId,
        user_id: context.userId,
        note: '[]',
        is_internal: false,
        is_resolution: false,
        author_type: 'internal',
      },
    ]);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await rollbackContext();
  }, HOOK_TIMEOUT);

  it('should add a reaction to a comment', async () => {
    const result = await toggleCommentReaction(commentId, '\u{1F44D}');
    expect(result).toEqual({ added: true });

    // Verify in database
    const rows = await context.db('comment_reactions')
      .where({ tenant: context.tenantId, comment_id: commentId });
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe('\u{1F44D}');
    expect(rows[0].user_id).toBe(context.userId);
  });

  it('should remove a reaction when toggled again', async () => {
    await toggleCommentReaction(commentId, '\u{1F44D}');
    const result = await toggleCommentReaction(commentId, '\u{1F44D}');
    expect(result).toEqual({ added: false });

    const rows = await context.db('comment_reactions')
      .where({ tenant: context.tenantId, comment_id: commentId });
    expect(rows).toHaveLength(0);
  });

  it('should allow multiple different emojis on the same comment', async () => {
    await toggleCommentReaction(commentId, '\u{1F44D}');
    await toggleCommentReaction(commentId, '\u{2764}\u{FE0F}');
    await toggleCommentReaction(commentId, '\u{1F525}');

    const rows = await context.db('comment_reactions')
      .where({ tenant: context.tenantId, comment_id: commentId });
    expect(rows).toHaveLength(3);

    const emojis = rows.map((r: any) => r.emoji).sort();
    expect(emojis).toEqual(['\u{2764}\u{FE0F}', '\u{1F44D}', '\u{1F525}'].sort());
  });

  it('should get aggregated reactions in batch', async () => {
    // Add reactions to first comment
    await toggleCommentReaction(commentId, '\u{1F44D}');
    await toggleCommentReaction(commentId, '\u{2764}\u{FE0F}');

    // Add reactions to second comment
    await toggleCommentReaction(secondCommentId, '\u{1F525}');

    const { reactions: result, userNames } = await getCommentsReactionsBatch([commentId, secondCommentId]);

    // First comment should have 2 reactions
    expect(result[commentId]).toHaveLength(2);
    const thumbsUp = result[commentId].find((r: any) => r.emoji === '\u{1F44D}');
    expect(thumbsUp).toBeDefined();
    expect(thumbsUp!.count).toBe(1);
    expect(thumbsUp!.currentUserReacted).toBe(true);
    expect(thumbsUp!.userIds).toContain(context.userId);

    // Second comment should have 1 reaction
    expect(result[secondCommentId]).toHaveLength(1);
    expect(result[secondCommentId][0].emoji).toBe('\u{1F525}');

    // Should include user display name
    expect(userNames[context.userId]).toBeDefined();
    expect(userNames[context.userId]).not.toBe(context.userId);
  });

  it('should return empty object for empty comment IDs', async () => {
    const { reactions } = await getCommentsReactionsBatch([]);
    expect(reactions).toEqual({});
  });

  it('should return empty arrays for comments with no reactions', async () => {
    const { reactions } = await getCommentsReactionsBatch([commentId]);
    // commentId not in result means no reactions
    expect(reactions[commentId]).toBeUndefined();
  });

  it('should support custom alga emoji', async () => {
    const result = await toggleCommentReaction(commentId, ':alga:');
    expect(result).toEqual({ added: true });

    const rows = await context.db('comment_reactions')
      .where({ tenant: context.tenantId, comment_id: commentId });
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe(':alga:');
  });

  it('should count reactions from multiple users on the same emoji', async () => {
    // Add reaction as primary user
    await toggleCommentReaction(commentId, '\u{1F44D}');

    // Create a second user and add their reaction directly in DB
    const secondUserId = uuidv4();
    await context.db('users').insert({
      user_id: secondUserId,
      tenant: context.tenantId,
      username: `second-user-${Date.now()}`,
      first_name: 'Second',
      last_name: 'User',
      email: `second-${Date.now()}@test.com`,
      hashed_password: 'placeholder',
      is_inactive: false,
    });
    await context.db('comment_reactions').insert({
      tenant: context.tenantId,
      comment_id: commentId,
      user_id: secondUserId,
      emoji: '\u{1F44D}',
    });

    const { reactions, userNames } = await getCommentsReactionsBatch([commentId]);

    const thumbsUp = reactions[commentId].find((r: any) => r.emoji === '\u{1F44D}');
    expect(thumbsUp).toBeDefined();
    expect(thumbsUp!.count).toBe(2);
    expect(thumbsUp!.userIds).toContain(context.userId);
    expect(thumbsUp!.userIds).toContain(secondUserId);
    expect(thumbsUp!.currentUserReacted).toBe(true);

    // Both users should have display names
    expect(userNames[context.userId]).toBeDefined();
    expect(userNames[secondUserId]).toBe('Second User');
  });

  it('should cascade delete reactions when ticket comment is deleted', async () => {
    await toggleCommentReaction(commentId, '\u{1F44D}');
    await toggleCommentReaction(commentId, '\u{2764}\u{FE0F}');

    let rows = await context.db('comment_reactions')
      .where({ tenant: context.tenantId, comment_id: commentId });
    expect(rows).toHaveLength(2);

    // Delete reactions first, then comment (CitusDB doesn't support ON DELETE CASCADE)
    await context.db('comment_reactions')
      .where({ tenant: context.tenantId, comment_id: commentId })
      .del();
    await context.db('comments')
      .where({ tenant: context.tenantId, comment_id: commentId })
      .del();

    rows = await context.db('comment_reactions')
      .where({ tenant: context.tenantId, comment_id: commentId });
    expect(rows).toHaveLength(0);
  });
});

describe('Comment Reactions - Task Comments', () => {
  let taskId: string;
  let taskCommentId: string;
  let secondTaskCommentId: string;

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true,
    });
    dbRef.knex = context.db;
    dbRef.tenant = context.tenantId;
    userRef.user = context.user;

    // Get or create default project status
    let statusId: string;
    const existingStatus = await context.db('statuses')
      .where({ tenant: context.tenantId, status_type: 'project' })
      .first();

    if (existingStatus) {
      statusId = existingStatus.status_id;
    } else {
      const [status] = await context.db('statuses')
        .insert({
          tenant: context.tenantId,
          name: 'Active',
          status_type: 'project',
          order_number: 1,
          created_by: context.userId,
          is_closed: false,
          is_default: true,
        })
        .returning('status_id');
      statusId = status.status_id;
    }

    // Create a project
    const projectId = uuidv4();
    await context.db('projects').insert({
      project_id: projectId,
      tenant: context.tenantId,
      project_name: 'Test Project for Reactions',
      client_id: context.clientId,
      status: statusId,
      wbs_code: 'TEST',
      project_number: `P-${Date.now()}`,
    });

    // Create a phase
    const phaseId = uuidv4();
    await context.db('project_phases').insert({
      phase_id: phaseId,
      tenant: context.tenantId,
      project_id: projectId,
      phase_name: 'Test Phase',
      order_number: 1,
      status: 'active',
      wbs_code: '1',
    });

    // Get or create default project task status mapping
    let taskStatusMappingId: string;
    const existingTaskStatus = await context.db('project_status_mappings')
      .where({ tenant: context.tenantId })
      .first();

    if (existingTaskStatus) {
      taskStatusMappingId = existingTaskStatus.project_status_mapping_id;
    } else {
      // Create a task status, then a project_status_mappings row that references it
      let taskStatusId: string;
      const taskStatus = await context.db('statuses')
        .where({ tenant: context.tenantId, status_type: 'project_task' })
        .first();
      if (taskStatus) {
        taskStatusId = taskStatus.status_id;
      } else {
        const [newStatus] = await context.db('statuses')
          .insert({
            tenant: context.tenantId,
            name: 'To Do',
            status_type: 'project_task',
            order_number: 1,
            created_by: context.userId,
            is_closed: false,
            is_default: true,
          })
          .returning('status_id');
        taskStatusId = newStatus.status_id;
      }

      const [mapping] = await context.db('project_status_mappings')
        .insert({
          tenant: context.tenantId,
          project_id: projectId,
          status_id: taskStatusId,
          display_order: 1,
          is_standard: false,
        })
        .returning('project_status_mapping_id');
      taskStatusMappingId = mapping.project_status_mapping_id;
    }

    // Create a task
    taskId = uuidv4();
    await context.db('project_tasks').insert({
      task_id: taskId,
      tenant: context.tenantId,
      phase_id: phaseId,
      task_name: 'Test Task for Reactions',
      project_status_mapping_id: taskStatusMappingId,
      wbs_code: '1.1',
    });

    // Create two task comments
    taskCommentId = uuidv4();
    secondTaskCommentId = uuidv4();
    await context.db('project_task_comments').insert([
      {
        task_comment_id: taskCommentId,
        tenant: context.tenantId,
        task_id: taskId,
        user_id: context.userId,
        note: '[]',
        author_type: 'internal',
      },
      {
        task_comment_id: secondTaskCommentId,
        tenant: context.tenantId,
        task_id: taskId,
        user_id: context.userId,
        note: '[]',
        author_type: 'internal',
      },
    ]);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await rollbackContext();
  }, HOOK_TIMEOUT);

  it('should add a reaction to a task comment', async () => {
    const result = await toggleTaskCommentReaction(taskCommentId, '\u{1F44D}');
    expect(result).toEqual({ added: true });

    const rows = await context.db('project_task_comment_reactions')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId });
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe('\u{1F44D}');
  });

  it('should remove a reaction when toggled again', async () => {
    await toggleTaskCommentReaction(taskCommentId, '\u{1F44D}');
    const result = await toggleTaskCommentReaction(taskCommentId, '\u{1F44D}');
    expect(result).toEqual({ added: false });

    const rows = await context.db('project_task_comment_reactions')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId });
    expect(rows).toHaveLength(0);
  });

  it('should allow multiple different emojis on the same task comment', async () => {
    await toggleTaskCommentReaction(taskCommentId, '\u{1F680}');
    await toggleTaskCommentReaction(taskCommentId, '\u{1F525}');

    const rows = await context.db('project_task_comment_reactions')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId });
    expect(rows).toHaveLength(2);
  });

  it('should get aggregated reactions in batch for task comments', async () => {
    await toggleTaskCommentReaction(taskCommentId, '\u{1F44D}');
    await toggleTaskCommentReaction(secondTaskCommentId, '\u{1F680}');
    await toggleTaskCommentReaction(secondTaskCommentId, '\u{1F44D}');

    const { reactions: result, userNames } = await getTaskCommentsReactionsBatch([taskCommentId, secondTaskCommentId]);

    expect(result[taskCommentId]).toHaveLength(1);
    expect(result[taskCommentId][0].emoji).toBe('\u{1F44D}');
    expect(result[taskCommentId][0].currentUserReacted).toBe(true);

    expect(result[secondTaskCommentId]).toHaveLength(2);

    // Should include user display name
    expect(userNames[context.userId]).toBeDefined();
  });

  it('should manually cascade delete reactions when task comment is deleted', async () => {
    await toggleTaskCommentReaction(taskCommentId, '\u{1F44D}');
    await toggleTaskCommentReaction(taskCommentId, '\u{2764}\u{FE0F}');

    // Verify reactions exist
    let rows = await context.db('project_task_comment_reactions')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId });
    expect(rows).toHaveLength(2);

    // Delete reactions first, then comment (CitusDB doesn't support ON DELETE CASCADE)
    await context.db('project_task_comment_reactions')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId })
      .del();
    await context.db('project_task_comments')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId })
      .del();

    // Verify reactions are gone
    rows = await context.db('project_task_comment_reactions')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId });
    expect(rows).toHaveLength(0);

    // Verify comment is gone
    const comment = await context.db('project_task_comments')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId })
      .first();
    expect(comment).toBeUndefined();
  });

  it('should return empty object for empty task comment IDs', async () => {
    const { reactions } = await getTaskCommentsReactionsBatch([]);
    expect(reactions).toEqual({});
  });

  it('should return undefined for task comments with no reactions', async () => {
    const { reactions } = await getTaskCommentsReactionsBatch([taskCommentId]);
    expect(reactions[taskCommentId]).toBeUndefined();
  });

  it('should support custom alga emoji on task comment', async () => {
    const result = await toggleTaskCommentReaction(taskCommentId, ':alga:');
    expect(result).toEqual({ added: true });

    const rows = await context.db('project_task_comment_reactions')
      .where({ tenant: context.tenantId, task_comment_id: taskCommentId });
    expect(rows).toHaveLength(1);
    expect(rows[0].emoji).toBe(':alga:');
  });

  it('should count reactions from multiple users on the same emoji', async () => {
    // Add reaction as primary user
    await toggleTaskCommentReaction(taskCommentId, '\u{1F44D}');

    // Create a second user and add their reaction directly in DB
    const secondUserId = uuidv4();
    await context.db('users').insert({
      user_id: secondUserId,
      tenant: context.tenantId,
      username: `second-user-${Date.now()}`,
      first_name: 'Second',
      last_name: 'User',
      email: `second-${Date.now()}@test.com`,
      hashed_password: 'placeholder',
      is_inactive: false,
    });
    await context.db('project_task_comment_reactions').insert({
      tenant: context.tenantId,
      task_comment_id: taskCommentId,
      user_id: secondUserId,
      emoji: '\u{1F44D}',
    });

    const { reactions, userNames } = await getTaskCommentsReactionsBatch([taskCommentId]);

    const thumbsUp = reactions[taskCommentId].find((r: any) => r.emoji === '\u{1F44D}');
    expect(thumbsUp).toBeDefined();
    expect(thumbsUp!.count).toBe(2);
    expect(thumbsUp!.userIds).toContain(context.userId);
    expect(thumbsUp!.userIds).toContain(secondUserId);
    expect(thumbsUp!.currentUserReacted).toBe(true);

    expect(userNames[secondUserId]).toBe('Second User');
  });
});

describe('Emoji Validation', () => {
  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true,
    });
    dbRef.knex = context.db;
    dbRef.tenant = context.tenantId;
    userRef.user = context.user;
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await rollbackContext();
  }, HOOK_TIMEOUT);

  it('should reject empty emoji string on ticket comment', async () => {
    const fakeId = uuidv4();
    await expect(toggleCommentReaction(fakeId, '')).rejects.toThrow('Invalid emoji');
  });

  it('should reject emoji exceeding max length on ticket comment', async () => {
    const fakeId = uuidv4();
    const longEmoji = 'x'.repeat(51);
    await expect(toggleCommentReaction(fakeId, longEmoji)).rejects.toThrow('Invalid emoji');
  });

  it('should reject empty emoji string on task comment', async () => {
    const fakeId = uuidv4();
    await expect(toggleTaskCommentReaction(fakeId, '')).rejects.toThrow('Invalid emoji');
  });

  it('should reject emoji exceeding max length on task comment', async () => {
    const fakeId = uuidv4();
    const longEmoji = 'x'.repeat(51);
    await expect(toggleTaskCommentReaction(fakeId, longEmoji)).rejects.toThrow('Invalid emoji');
  });
});

describe('Tenant Isolation', () => {
  let commentId: string;

  beforeEach(async () => {
    context = await resetContext();
    setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      user: context.user,
      permissionCheck: () => true,
    });
    dbRef.knex = context.db;
    dbRef.tenant = context.tenantId;
    userRef.user = context.user;

    // Create a ticket and comment for the primary tenant
    const existingStatus = await context.db('statuses')
      .where({ tenant: context.tenantId, status_type: 'ticket' })
      .first();

    const statusId = existingStatus
      ? existingStatus.status_id
      : (await context.db('statuses')
          .insert({
            tenant: context.tenantId,
            name: 'Open',
            status_type: 'ticket',
            order_number: 1,
            created_by: context.userId,
            is_closed: false,
            is_default: true,
          })
          .returning('status_id'))[0].status_id;

    const ticketId = uuidv4();
    await context.db('tickets').insert({
      ticket_id: ticketId,
      tenant: context.tenantId,
      ticket_number: `TEST-ISO-${Date.now()}`,
      title: 'Isolation Test Ticket',
      status_id: statusId,
      client_id: context.clientId,
      entered_by: context.userId,
    });

    commentId = uuidv4();
    await context.db('comments').insert({
      comment_id: commentId,
      tenant: context.tenantId,
      ticket_id: ticketId,
      user_id: context.userId,
      note: '[]',
      is_internal: false,
      is_resolution: false,
      author_type: 'internal',
    });
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await rollbackContext();
  }, HOOK_TIMEOUT);

  it('should only return reactions belonging to the current tenant', async () => {
    // Add a reaction as the current tenant
    await toggleCommentReaction(commentId, '\u{1F44D}');

    // Insert a reaction row with a foreign tenant directly in DB
    // (bypassing FK constraints since this is within the test transaction)
    const otherTenant = uuidv4();
    await context.db('tenants').insert({
      tenant: otherTenant,
      client_name: 'Other Tenant',
      email: `other-tenant-${Date.now()}@test.com`,
    });
    const otherUserId = uuidv4();
    await context.db('users').insert({
      user_id: otherUserId,
      tenant: otherTenant,
      username: `other-tenant-user-${Date.now()}`,
      first_name: 'Other',
      last_name: 'Tenant',
      email: `other-${Date.now()}@test.com`,
      hashed_password: 'placeholder',
      is_inactive: false,
    });

    // Create a comment in the other tenant with the same comment_id
    // (possible because PK is (comment_id, tenant))
    const otherStatusId = (await context.db('statuses')
      .insert({
        tenant: otherTenant,
        name: 'Open',
        status_type: 'ticket',
        order_number: 1,
        created_by: otherUserId,
        is_closed: false,
        is_default: true,
      })
      .returning('status_id'))[0].status_id;

    const otherClientId = uuidv4();
    await context.db('clients').insert({
      client_id: otherClientId,
      tenant: otherTenant,
      client_name: 'Other Tenant Client',
    });

    const otherTicketId = uuidv4();
    await context.db('tickets').insert({
      ticket_id: otherTicketId,
      tenant: otherTenant,
      ticket_number: `OTHER-${Date.now()}`,
      title: 'Other Tenant Ticket',
      status_id: otherStatusId,
      client_id: otherClientId,
      entered_by: otherUserId,
    });

    await context.db('comments').insert({
      comment_id: commentId, // same comment_id, different tenant
      tenant: otherTenant,
      ticket_id: otherTicketId,
      user_id: otherUserId,
      note: '[]',
      is_internal: false,
      is_resolution: false,
      author_type: 'internal',
    });

    await context.db('comment_reactions').insert({
      tenant: otherTenant,
      comment_id: commentId,
      user_id: otherUserId,
      emoji: '\u{1F525}',
    });

    // Query as the primary tenant — should only see the primary tenant's reaction
    const { reactions } = await getCommentsReactionsBatch([commentId]);

    expect(reactions[commentId]).toHaveLength(1);
    expect(reactions[commentId][0].emoji).toBe('\u{1F44D}');
    expect(reactions[commentId][0].userIds).not.toContain(otherUserId);
  });
});
