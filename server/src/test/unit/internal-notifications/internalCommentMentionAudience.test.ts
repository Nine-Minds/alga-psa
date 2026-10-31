import { beforeEach, describe, expect, it, vi } from 'vitest';

// N1: an @mention inside an INTERNAL ticket comment must never notify (or
// preview the note to) a client/portal user. Internal users are still notified,
// portal-visible comments still notify mentioned client users, and main's
// `isInteractiveUserType` recipient filter keeps excluding non-interactive users.

const { createNotificationMock, usersByTable } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(async () => undefined),
  usersByTable: { users: [] as Array<Record<string, any>> },
}));

vi.mock('@alga-psa/core/logger', () => ({
  __esModule: true,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/notifications/actions', () => ({
  createNotificationFromTemplateInternal: createNotificationMock,
}));
vi.mock('../../../lib/utils/notificationLinkResolver', () => ({
  resolveNotificationLinks: vi.fn(async () => ({ internalUrl: '/internal/t/1', portalUrl: '/portal/t/1' })),
}));
vi.mock('@alga-psa/shared/lib/tickets/ticketAssignees', () => ({
  getAllTicketAssignees: vi.fn(async () => []),
}));
vi.mock('../../../lib/db/db', () => ({ getConnection: vi.fn() }));
vi.mock('../../../lib/eventBus/index', () => ({ getEventBus: vi.fn() }));
vi.mock('../../../lib/eventBus', () => ({ getEventBus: vi.fn() }));

// Minimal tenant-scoped query builder: `users` rows are filtered by whereIn/where,
// every other table resolves to the ticket row.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  const builder = (table: string) => {
    let rows: Array<Record<string, any>> =
      table === 'tickets'
        ? [{ ticket_id: 'ticket-1', ticket_number: 'T-1', title: 'Printer', contact_name_id: null, tenant: 'tenant-1' }]
        : table === 'users'
          ? [...usersByTable.users]
          : [];
    const api: any = {
      select: () => api,
      whereIn: (col: string, values: any[]) => { rows = rows.filter((r) => values.includes(r[col])); return api; },
      where: (colOrObj: any, val?: any) => {
        const cond = typeof colOrObj === 'string' ? { [colOrObj]: val } : colOrObj;
        rows = rows.filter((r) => Object.entries(cond).every(([k, v]) => r[k] === v));
        return api;
      },
      first: async () => rows[0],
      then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return api;
  };
  return { ...actual, tenantDb: () => ({ table: builder }) };
});

import { internalNotificationSubscriberTestHarness } from '../../../lib/eventBus/subscribers/internalNotificationSubscriber';

const fakeDb = { raw: (sql: string) => sql } as any;
const mention = (userId: string) => ({ type: 'mention', props: { userId } });
const content = JSON.stringify([
  { type: 'paragraph', content: [mention('internal-1'), { type: 'text', text: ' secret ' }, mention('client-1'), mention('service-1')] },
]);

function commentEvent(isInternal: boolean) {
  return {
    id: 'evt-1',
    eventType: 'TICKET_COMMENT_ADDED',
    timestamp: new Date().toISOString(),
    payload: {
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      userId: 'author-1',
      comment: { id: 'c-1', content, author: 'Author', isInternal },
    },
  } as any;
}

const notified = () =>
  createNotificationMock.mock.calls
    .map((c: any[]) => c[1])
    .filter((n: any) => n.template_name === 'user-mentioned-in-comment');

describe('ticket comment mentions respect comment audience (N1)', () => {
  beforeEach(() => {
    createNotificationMock.mockClear();
    usersByTable.users = [
      { user_id: 'internal-1', username: 'int', user_type: 'internal', first_name: 'I', last_name: 'U' },
      { user_id: 'client-1', username: 'cli', user_type: 'client', first_name: 'C', last_name: 'U' },
      { user_id: 'service-1', username: 'svc', user_type: 'service', first_name: 'S', last_name: 'U' },
    ];
  });

  it('internal comment: notifies the internal user only, with no preview reaching the client user', async () => {
    await internalNotificationSubscriberTestHarness.handleTicketCommentAdded(commentEvent(true), { db: fakeDb });

    const sent = notified();
    expect(sent.map((n: any) => n.user_id)).toEqual(['internal-1']);
    expect(createNotificationMock.mock.calls.map((c: any[]) => c[1].user_id)).not.toContain('client-1');
  });

  it('portal-visible comment: still notifies the mentioned client user; non-interactive users stay excluded', async () => {
    await internalNotificationSubscriberTestHarness.handleTicketCommentAdded(commentEvent(false), { db: fakeDb });

    expect(notified().map((n: any) => n.user_id).sort()).toEqual(['client-1', 'internal-1']);
  });
  describe('comment edited to add new mentions', () => {
    const oldContent = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'no mentions yet' }] }]);
    const updatedEvent = (isInternal: boolean) =>
      ({
        id: 'evt-2',
        eventType: 'TICKET_COMMENT_UPDATED',
        timestamp: new Date().toISOString(),
        payload: {
          tenantId: 'tenant-1',
          ticketId: 'ticket-1',
          userId: 'author-1',
          oldComment: { id: 'c-1', content: oldContent, author: 'Author', isInternal },
          newComment: { id: 'c-1', content, author: 'Author', isInternal },
        },
      }) as any;

    it('internal comment edited to mention a client user: the client is not notified, the internal user is', async () => {
      await internalNotificationSubscriberTestHarness.handleTicketCommentUpdated(updatedEvent(true), { db: fakeDb });

      expect(notified().map((n: any) => n.user_id)).toEqual(['internal-1']);
      expect(createNotificationMock.mock.calls.map((c: any[]) => c[1].user_id)).not.toContain('client-1');
    });

    it('portal-visible comment edited to mention a client user: the client is still notified', async () => {
      await internalNotificationSubscriberTestHarness.handleTicketCommentUpdated(updatedEvent(false), { db: fakeDb });

      expect(notified().map((n: any) => n.user_id)).toContain('client-1');
    });
  });
});
