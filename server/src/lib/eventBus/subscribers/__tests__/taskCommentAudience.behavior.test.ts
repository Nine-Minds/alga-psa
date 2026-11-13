import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  notifications: [] as any[],
  emails: [] as any[],
  allowed: new Set<string>(),
  projectIds: [] as string[],
  primaryAssignee: 'primary',
  additionalAssignee: 'additional',
}));

vi.mock('@alga-psa/notifications/actions', () => ({
  createNotificationFromTemplateInternal: vi.fn(async (_db: unknown, request: any) => { state.notifications.push(request); }),
}));
vi.mock('../../../db/db', () => ({ getConnection: async () => fakeDb() }));
vi.mock('../../../db', () => ({ createTenantKnex: async () => ({ knex: fakeDb() }) }));
vi.mock('@alga-psa/db', () => ({
  getUserWithRoles: vi.fn(async () => null),
  tenantDb: (conn: any) => ({ table: (name: string) => conn(name), tenantJoin: (query: any) => query }),
}));
vi.mock('../../../notifications/projectNotificationAudience', () => ({
  filterRecipientsWhoCanReadProject: vi.fn(async (_db: unknown, _tenant: string, projectId: string, userIds: string[]) => {
    state.projectIds.push(projectId);
    return userIds.filter((id) => state.allowed.has(id));
  }),
}));
vi.mock('../../../utils/notificationLinkResolver', () => ({ resolveNotificationLinks: async () => ({ internalUrl: '/task' }) }));
vi.mock('@alga-psa/formatting/blocknoteUtils', () => ({
  convertBlockNoteToMarkdown: () => 'secret comment body',
  formatBlockNoteContent: () => ({ html: '<p>secret comment body</p>', text: 'secret comment body' }),
}));
vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({ getTenantDefaultLocale: async () => 'en' }));
vi.mock('@alga-psa/notifications', () => ({ getEmailEventChannel: () => 'email' }));
vi.mock('../../../notifications/sendEventEmail', () => ({ sendEventEmail: async (request: any) => { state.emails.push(request); } }));
vi.mock('@alga-psa/tenancy/server', () => ({ resolveTenantAppBase: async () => ({ source: 'canonical', baseUrl: 'https://example.test' }) }));
vi.mock('@alga-psa/core', () => ({ isValidEmail: (email: string) => email.includes('@') }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

function fakeDb() {
  const table = (source: string) => {
    const name = source.split(' as ')[0];
    let whereIn: string[] | null = null;
    let where: any = null;
    const chain: any = {
      select: () => chain,
      where: (value: any) => { where = value; return chain; },
      whereIn: (_column: string, ids: string[]) => { whereIn = ids; return chain; },
      whereNotNull: () => chain,
      tenantJoin: () => chain,
      first: async () => {
        if (name === 'project_tasks') return { task_id: 'task-1', task_name: 'Secret task', assigned_to: state.primaryAssignee, phase_id: 'phase-1', project_id: 'resolved-project', project_name: 'Secret project' };
        if (name === 'users' && where?.user_id === 'author') return { user_id: 'author', first_name: 'Author', last_name: 'User', email: 'author@example.test' };
        if (name === 'users' && where?.user_id === 'primary') return { user_id: 'primary', email: 'primary@example.test' };
        return undefined;
      },
      insert: async () => undefined,
      then: (resolve: any) => resolve(name === 'users' && whereIn
        ? whereIn.map((user_id) => ({ user_id, username: user_id, display_name: user_id }))
        : name === 'users' && where?.user_type === 'internal'
          ? ['allowed', 'denied', 'author'].map((user_id) => ({ user_id }))
          : name === 'task_resources'
            ? [{ additional_user_id: state.additionalAssignee, user_id: state.additionalAssignee, email: `${state.additionalAssignee}@example.test` }]
            : name === 'users' && where?.user_id
              ? (where.user_id === 'author'
                ? [{ user_id: 'author', first_name: 'Author', last_name: 'User', email: 'author@example.test' }]
                : where.user_id === 'primary' ? [{ user_id: 'primary', email: 'primary@example.test' }] : [])
              : []),
    };
    return chain;
  };
  const db: any = (name: string) => table(name);
  db.raw = (sql: string) => sql;
  return db;
}

import { internalNotificationSubscriberTestHarness } from '../internalNotificationSubscriber';
import { projectEmailSubscriberTestHarness } from '../projectEmailSubscriber';

const tenantId = 'tenant-1';
const commentMention = (id: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'mention', props: { userId: id, displayName: id } }] }]);
const commentMentions = (...ids: string[]) => JSON.stringify([{ type: 'paragraph', content: ids.map((id) => ({ type: 'mention', props: { userId: id, displayName: id } })) }]);
const event = (eventType: string, commentContent: string, oldCommentContent = '[]') => ({
  id: 'event-1', eventType,
  payload: {
    tenantId, taskId: 'task-1', projectId: 'conflicting-payload-project', userId: 'author', taskCommentId: 'comment-1',
    taskName: 'Payload task', commentContent, oldCommentContent, newCommentContent: commentContent,
  },
}) as any;

beforeEach(() => {
  state.notifications = [];
  state.emails = [];
  state.allowed = new Set(['allowed', 'primary', 'additional']);
  state.projectIds = [];
  state.primaryAssignee = 'primary';
  state.additionalAssignee = 'additional';
});

describe('task comment notification audience', () => {
  it('gates direct mentions and @everyone against the resolved project, excludes author, and keeps admitted content', async () => {
    await internalNotificationSubscriberTestHarness.handleTaskCommentAdded(
      event('TASK_COMMENT_ADDED', commentMentions('allowed', 'denied', '@everyone')),
    );

    expect(state.projectIds).toContain('resolved-project');
    expect(state.projectIds).not.toContain('conflicting-payload-project');
    expect(state.notifications.map((request) => request.user_id)).toEqual(['allowed', 'primary', 'additional']);
    expect(state.notifications.some((request) => request.user_id === 'author' || request.user_id === 'denied')).toBe(false);
    expect(state.notifications.find((request) => request.user_id === 'allowed')?.metadata.commentText).toBe('secret comment body');
  });

  it('gates added-comment primary and additional assignee notifications without mention deduplication', async () => {
    state.allowed = new Set(['additional']);
    await internalNotificationSubscriberTestHarness.handleTaskCommentAdded(event('TASK_COMMENT_ADDED', '[]'));

    expect(state.notifications.map((request) => request.user_id)).toEqual(['additional']);
    expect(state.notifications.every((request) => request.data.commentPreview === 'secret comment body')).toBe(true);
  });

  it('drops a denied additional assignee while retaining an admitted primary assignee', async () => {
    state.allowed = new Set(['primary']);
    state.additionalAssignee = 'denied';
    await internalNotificationSubscriberTestHarness.handleTaskCommentAdded(event('TASK_COMMENT_ADDED', '[]'));

    expect(state.notifications.map((request) => request.user_id)).toEqual(['primary']);
  });

  it('gates newly added edit mentions and expanded @everyone recipients', async () => {
    await internalNotificationSubscriberTestHarness.handleTaskCommentUpdated(
      event('TASK_COMMENT_UPDATED', commentMention('@everyone')),
    );

    expect(state.projectIds).toEqual(['resolved-project']);
    expect(state.notifications.map((request) => request.user_id)).toEqual(['allowed']);
    expect(state.notifications[0].metadata.commentText).toBe('secret comment body');
  });

  it('gates primary and additional assignee emails and preserves admitted email content', async () => {
    state.allowed = new Set(['additional']);
    await projectEmailSubscriberTestHarness.handleTaskCommentAdded(event('TASK_COMMENT_ADDED', '[]'));

    expect(state.projectIds).toEqual(['resolved-project']);
    expect(state.emails.map((email) => email.to)).toEqual(['additional@example.test']);
    expect(state.emails.every((email) => email.context.comment.contentText === 'secret comment body')).toBe(true);
  });

  it('drops a denied additional assignee email while retaining an admitted primary assignee', async () => {
    state.allowed = new Set(['primary']);
    state.additionalAssignee = 'denied';
    await projectEmailSubscriberTestHarness.handleTaskCommentAdded(event('TASK_COMMENT_ADDED', '[]'));

    expect(state.emails.map((email) => email.to)).toEqual(['primary@example.test']);
  });

  it('excludes the comment author when the author is also a primary email assignee', async () => {
    state.primaryAssignee = 'author';
    state.allowed.add('author');
    await projectEmailSubscriberTestHarness.handleTaskCommentAdded(event('TASK_COMMENT_ADDED', '[]'));

    expect(state.emails.map((email) => email.to)).toEqual(['additional@example.test']);
  });
});
