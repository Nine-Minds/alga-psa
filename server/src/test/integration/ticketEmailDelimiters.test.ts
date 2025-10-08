import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

interface TemplateRecord {
  subject: string;
  html_content: string;
  text_content: string;
}

interface TokenRecord {
  tenant: string;
  token: string;
  ticket_id?: string | null;
  comment_id?: string | null;
  metadata?: string | null;
}

interface TicketRecord {
  ticket_id: string;
  ticket_number: string;
  title: string;
  client_email?: string | null;
  contact_email?: string | null;
  assigned_to_email?: string | null;
  email_metadata?: { threadId?: string | null } | null;
}

interface UserRecord {
  user_id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
}

const templateStore = new Map<string, TemplateRecord>();
const tokenStore = new Map<string, TokenRecord>();

let currentTicket: TicketRecord | null = null;
let currentUser: UserRecord | null = null;
let currentResources: Array<{ email: string }> = [];

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const eventHandlers = vi.hoisted(() => new Map<string, (event: any) => Promise<void> | void>());

const subscribeMock = vi.hoisted(() =>
  vi.fn(async (eventType: string, handler: (event: any) => Promise<void> | void) => {
    eventHandlers.set(eventType, handler);
  }),
);
const unsubscribeMock = vi.hoisted(() =>
  vi.fn(async (eventType: string, handler: (event: any) => Promise<void> | void) => {
    const existing = eventHandlers.get(eventType);
    if (existing === handler) {
      eventHandlers.delete(eventType);
    }
  }),
);

function createQuery(getter: () => any) {
  let resolveFn = getter;
  const builder: any = {
    select: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    toSQL: () => ({ sql: 'mock-query', bindings: [] }),
    first: () => {
      const prev = resolveFn;
      resolveFn = () => {
        const value = prev();
        if (Array.isArray(value)) {
          return value[0] ?? null;
        }
        return value ?? null;
      };
      return builder;
    },
    then: (resolve: any, reject: any) => Promise.resolve(resolveFn()).then(resolve, reject),
  };
  return builder;
}

function tenantTemplateBuilder() {
  const builder = createQuery(() => null);
  builder.where = () => builder;
  return builder;
}

function systemTemplateBuilder() {
  let templateName: string | undefined;
  const builder = createQuery(() => (templateName ? templateStore.get(templateName) ?? null : null));
  builder.where = (conditions: Record<string, any>) => {
    templateName = conditions.name;
    return builder;
  };
  return builder;
}

function tokenTableBuilder() {
  const builder: any = {
    insert: (data: any) => {
      const rows = Array.isArray(data) ? data : [data];
      for (const row of rows) {
        tokenStore.set(row.token, row);
      }
      const response: any = {
        returning: (columns?: string[]) => {
          if (!columns) {
            return Promise.resolve(rows);
          }
          return Promise.resolve(
            rows.map((row) => {
              const picked: Record<string, any> = {};
              for (const column of columns) {
                picked[column] = row[column];
              }
              return picked;
            }),
          );
        },
      };
      response.onConflict = () => ({
        ignore: () => response,
        merge: () => response,
      });
      return response;
    },
  };
  return builder;
}

function ticketTableBuilder() {
  let result = currentTicket;
  const builder = createQuery(() => result);
  builder.where = (column: any, value?: any) => {
    if (typeof column === 'object') {
      const ticketId = column['t.ticket_id'] ?? column.ticket_id;
      result = ticketId && currentTicket?.ticket_id !== ticketId ? null : currentTicket;
    } else if (value) {
      result = currentTicket?.ticket_id === value ? currentTicket : null;
    }
    return builder;
  };
  return builder;
}

function userTableBuilder() {
  let result = currentUser;
  const builder = createQuery(() => result);
  builder.where = () => builder;
  return builder;
}

function resourceTableBuilder() {
  const builder = createQuery(() => currentResources);
  builder.select = () => builder;
  builder.leftJoin = () => builder;
  builder.where = () => builder;
  return builder;
}

function createMockKnex() {
  const knexFn: any = (tableName: string) => {
    switch (tableName) {
      case 'tenant_email_templates':
        return tenantTemplateBuilder();
      case 'system_email_templates':
        return systemTemplateBuilder();
      case 'email_reply_tokens':
        return tokenTableBuilder();
      case 'tickets as t':
        return ticketTableBuilder();
      case 'users':
        return userTableBuilder();
      case 'ticket_resources as tr':
        return resourceTableBuilder();
      default:
        throw new Error(`Unhandled table: ${tableName}`);
    }
  };
  knexFn.schema = {
    hasTable: async () => true,
  };
  knexFn.client = { config: { connection: { database: 'mock-db' } } };
  return knexFn;
}

const mockKnex = createMockKnex();

vi.mock('../../lib/db/db', () => ({
  __esModule: true,
  getConnection: async () => mockKnex,
}));

vi.mock('../../lib/services/TenantEmailService', () => ({
  __esModule: true,
  TenantEmailService: {
    getInstance: () => ({ sendEmail: sendEmailMock }),
  },
}));

vi.mock('../../lib/eventBus/index', () => ({
  __esModule: true,
  getEventBus: () => ({ subscribe: subscribeMock, unsubscribe: unsubscribeMock }),
}));

let sendEventEmail: typeof import('../../lib/notifications/sendEventEmail').sendEventEmail;
let registerTicketEmailSubscriber: typeof import('../../lib/eventBus/subscribers/ticketEmailSubscriber').registerTicketEmailSubscriber;

beforeAll(async () => {
  ({ sendEventEmail } = await import('../../lib/notifications/sendEventEmail'));
  ({ registerTicketEmailSubscriber } = await import('../../lib/eventBus/subscribers/ticketEmailSubscriber'));
});

beforeEach(() => {
  templateStore.clear();
  tokenStore.clear();
  currentTicket = null;
  currentUser = null;
  currentResources = [];
  sendEmailMock.mockReset();
  subscribeMock.mockClear();
  unsubscribeMock.mockClear();
  eventHandlers.clear();
});

afterAll(() => {
  vi.restoreAllMocks();
});

function seedTemplate(name: string, subject: string, html: string, text?: string) {
  templateStore.set(name, {
    subject,
    html_content: html,
    text_content: text ?? html.replace(/<[^>]*>/g, '').trim(),
  });
}

function setTicket(row: TicketRecord | null) {
  currentTicket = row;
}

function setUser(row: UserRecord | null) {
  currentUser = row;
}

function setResources(rows: Array<{ email: string }>) {
  currentResources = rows;
}

function handlerFor(eventType: string) {
  const handler = eventHandlers.get(eventType);
  if (!handler) {
    throw new Error(`No handler registered for ${eventType}`);
  }
  return handler;
}

function processedCall(index: number) {
  const call = sendEmailMock.mock.calls[index];
  if (!call) {
    throw new Error('Expected sendEmail to have been called');
  }
  return call[0].templateProcessor.process({});
}

describe('sendEventEmail reply markers', () => {
  it('adds reply markers when conversation token is provided', async () => {
    const templateName = `template-${randomUUID()}`;
    seedTemplate(templateName, 'New Ticket {{body}}', '<p>{{body}}</p>');

    const conversationToken = randomUUID();
    const templateData = { body: 'Ticket #123 created.' };

    await expect(
      sendEventEmail({
        tenantId: randomUUID(),
        to: 'user@example.com',
        subject: 'New Ticket',
        template: templateName,
        context: templateData,
        replyContext: {
          ticketId: randomUUID(),
          commentId: randomUUID(),
          conversationToken,
        },
      }),
    ).resolves.toBeUndefined();

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const [{ templateProcessor }] = sendEmailMock.mock.calls[0];
    const processed = await templateProcessor.process({ templateData });
    expect(processed.html).toContain('--- Please reply above this line ---');
    expect(processed.html).toContain(`data-alga-reply-token="${conversationToken}`);
    expect(processed.text).toContain(`[ALGA-REPLY-TOKEN ${conversationToken}`);
    expect(tokenStore.has(conversationToken)).toBe(true);
  });

  it('generates a conversation token when one is not supplied', async () => {
    const templateName = `template-${randomUUID()}`;
    seedTemplate(templateName, 'Ticket Updated {{body}}', '<p>{{body}}</p>');

    const templateData = { body: 'Ticket #789 was updated.' };
    const tenantId = randomUUID();
    const ticketId = randomUUID();

    await expect(
      sendEventEmail({
        tenantId,
        to: 'user@example.com',
        subject: 'Ticket Updated',
        template: templateName,
        context: templateData,
        replyContext: {
          ticketId,
        },
      }),
    ).resolves.toBeUndefined();

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const [{ templateProcessor }] = sendEmailMock.mock.calls[0];
    const processed = await templateProcessor.process({ templateData });
    const tokenMatch = processed.html.match(/data-alga-reply-token="([^"]+)"/);
    expect(tokenMatch).toBeTruthy();
    expect(tokenStore.has(tokenMatch![1])).toBe(true);
  });

  it('includes comment and thread markers for comment notifications', async () => {
    const templateName = `template-${randomUUID()}`;
    seedTemplate(templateName, 'Comment Added {{body}}', '<p>{{body}}</p>');

    const templateData = { body: 'A new comment was added.' };
    const tenantId = randomUUID();
    const ticketId = randomUUID();
    const commentId = randomUUID();
    const conversationToken = randomUUID();

    await expect(
      sendEventEmail({
        tenantId,
        to: 'user@example.com',
        subject: 'Comment Added',
        template: templateName,
        context: templateData,
        replyContext: {
          ticketId,
          commentId,
          threadId: 'thread-123',
          conversationToken,
        },
      }),
    ).resolves.toBeUndefined();

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const [{ templateProcessor }] = sendEmailMock.mock.calls[0];
    const processed = await templateProcessor.process({ templateData });
    expect(processed.html).toContain(`data-alga-comment-id="${commentId}`);
    expect(processed.text).toContain('ALGA-THREAD-ID:thread-123');
    expect(tokenStore.get(conversationToken)?.comment_id).toBe(commentId);
  });
});

describe('ticket email subscriber reply markers', () => {
  beforeEach(async () => {
    eventHandlers.clear();
    await registerTicketEmailSubscriber();
  });

  it('processes ticket created events with delimiters', async () => {
    seedTemplate('ticket-created', 'Ticket Created: {{ticket.title}}', '<p>{{ticket.title}}</p>');

    const tenantId = randomUUID();
    const ticketId = randomUUID();

    setTicket({
      ticket_id: ticketId,
      ticket_number: 'T-0001',
      title: 'Created Ticket',
      contact_email: 'contact@example.com',
      email_metadata: { threadId: 'thread-1' },
    });

    await handlerFor('TICKET_CREATED')({
      id: randomUUID(),
      eventType: 'TICKET_CREATED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: randomUUID(),
      },
    });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const processed = await processedCall(0);
    expect(processed.html).toContain('--- Please reply above this line ---');
    expect(processed.html).toContain(`data-alga-ticket-id="${ticketId}`);
  });

  it('processes ticket updated events with delimiters', async () => {
    seedTemplate('ticket-updated', 'Ticket Updated: {{ticket.title}}', '<p>{{ticket.title}}</p>');

    const tenantId = randomUUID();
    const ticketId = randomUUID();
    const userId = randomUUID();

    setTicket({
      ticket_id: ticketId,
      ticket_number: 'T-0002',
      title: 'Updated Ticket',
      contact_email: 'contact@example.com',
      email_metadata: { threadId: 'thread-2' },
    });
    setUser({ user_id: userId, first_name: 'Test', last_name: 'User' });

    await handlerFor('TICKET_UPDATED')({
      id: randomUUID(),
      eventType: 'TICKET_UPDATED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId,
        changes: { notes: 'Updated' },
      },
    });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const processed = await processedCall(0);
    expect(processed.html).toContain('--- Please reply above this line ---');
    expect(processed.html).toContain(`data-alga-ticket-id="${ticketId}`);
  });

  it('processes ticket comment events with comment markers', async () => {
    seedTemplate('ticket-comment-added', 'New Comment {{ticket.title}}', '<p>{{comment.content}}</p>');

    const tenantId = randomUUID();
    const ticketId = randomUUID();
    const commentId = randomUUID();

    setTicket({
      ticket_id: ticketId,
      ticket_number: 'T-0003',
      title: 'Comment Ticket',
      contact_email: 'contact@example.com',
      email_metadata: { threadId: 'thread-3' },
    });

    await handlerFor('TICKET_COMMENT_ADDED')({
      id: randomUUID(),
      eventType: 'TICKET_COMMENT_ADDED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: randomUUID(),
        comment: {
          id: commentId,
          content: 'Follow up',
          author: 'contact@example.com',
          isInternal: false,
        },
      },
    });

    expect(sendEmailMock).toHaveBeenCalledOnce();
    const processed = await processedCall(0);
    expect(processed.html).toContain('--- Please reply above this line ---');
    expect(processed.html).toContain(`data-alga-comment-id="${commentId}`);
  });
});
