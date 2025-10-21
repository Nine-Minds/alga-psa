import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

interface TemplateRecord {
  subject: string;
  html_content: string;
  text_content: string;
  notification_subtype_id?: number;
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
  assigned_to?: string | null;
  email_metadata?: { threadId?: string | null } | null;
}

interface UserRecord {
  user_id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
}

interface NotificationSettingRecord {
  id: number;
  tenant: string;
  is_enabled: boolean;
  rate_limit_per_minute: number;
}

interface NotificationCategoryRecord {
  id: number;
  name: string;
  description?: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
}

interface NotificationSubtypeRecord {
  id: number;
  category_id: number;
  name: string;
  description?: string | null;
  is_enabled: boolean;
  is_default_enabled: boolean;
}

interface UserNotificationPreferenceRecord {
  id: number;
  tenant: string;
  user_id: string;
  subtype_id: number;
  is_enabled: boolean;
  email_address?: string | null;
  frequency: 'realtime' | 'daily' | 'weekly';
}

interface NotificationLogRecord {
  tenant: string;
  user_id: string;
  subtype_id: number;
  email_address: string;
  subject: string;
  status: 'sent' | 'failed' | 'bounced';
  error_message?: string | null;
}

const templateStore = new Map<string, TemplateRecord>();
const tokenStore = new Map<string, TokenRecord>();

let currentTicket: TicketRecord | null = null;
let currentUser: UserRecord | null = null;
let currentResources: Array<{ email: string }> = [];

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const eventHandlers = vi.hoisted(() => new Map<string, (event: any) => Promise<void> | void>());

const notificationSettingsStore = new Map<string, NotificationSettingRecord>();
const notificationCategoriesStore = new Map<number, NotificationCategoryRecord>();
const notificationSubtypesStore = new Map<number, NotificationSubtypeRecord>();
const notificationSubtypesByName = new Map<string, NotificationSubtypeRecord>();
const userNotificationPreferencesStore = new Map<string, UserNotificationPreferenceRecord>();
const notificationLogs: NotificationLogRecord[] = [];

let notificationSettingsIdCounter = 1;
let notificationCategoryIdCounter = 1;
let subtypeIdCounter = 1;
let userPreferenceIdCounter = 1;

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

function normalizeColumnKey(key: string): string {
  if (key.includes('.')) {
    const segments = key.split('.');
    return segments[segments.length - 1];
  }
  return key;
}

function matchesCondition(row: Record<string, any>, key: string, value: any): boolean {
  const targetKey = normalizeColumnKey(key);
  return row[targetKey] === value;
}

function matchesConditionsObject(row: Record<string, any>, conditions: Record<string, any>): boolean {
  return Object.entries(conditions).every(([key, value]) => matchesCondition(row, key, value));
}

function resetNotificationState() {
  notificationSettingsStore.clear();
  notificationCategoriesStore.clear();
  notificationSubtypesStore.clear();
  notificationSubtypesByName.clear();
  userNotificationPreferencesStore.clear();
  notificationLogs.length = 0;
  notificationSettingsIdCounter = 1;
  notificationCategoryIdCounter = 1;
  subtypeIdCounter = 1;
  userPreferenceIdCounter = 1;
}

function subtypeDisplayNameFromTemplate(templateName: string): string {
  return templateName
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function ensureNotificationCategory(name: string): NotificationCategoryRecord {
  for (const category of notificationCategoriesStore.values()) {
    if (category.name === name) {
      return category;
    }
  }

  const record: NotificationCategoryRecord = {
    id: notificationCategoryIdCounter++,
    name,
    description: null,
    is_enabled: true,
    is_default_enabled: true,
  };

  notificationCategoriesStore.set(record.id, record);
  return record;
}

function ensureNotificationSubtype(name: string): NotificationSubtypeRecord {
  const existing = notificationSubtypesByName.get(name);
  if (existing) {
    return existing;
  }

  const category = ensureNotificationCategory('Tickets');
  const record: NotificationSubtypeRecord = {
    id: subtypeIdCounter++,
    category_id: category.id,
    name,
    description: null,
    is_enabled: true,
    is_default_enabled: true,
  };

  notificationSubtypesByName.set(name, record);
  notificationSubtypesStore.set(record.id, record);
  return record;
}

function setNotificationSettings(
  tenantId: string,
  overrides: Partial<Omit<NotificationSettingRecord, 'tenant'>> = {},
): NotificationSettingRecord {
  const record: NotificationSettingRecord = {
    id:
      overrides.id ??
      notificationSettingsStore.get(tenantId)?.id ??
      notificationSettingsIdCounter++,
    tenant: tenantId,
    is_enabled: overrides.is_enabled ?? true,
    rate_limit_per_minute: overrides.rate_limit_per_minute ?? 60,
  };

  notificationSettingsStore.set(tenantId, record);
  return record;
}

function setSubtypeEnabled(name: string, isEnabled: boolean): NotificationSubtypeRecord {
  const subtype = ensureNotificationSubtype(name);
  const updated: NotificationSubtypeRecord = {
    ...subtype,
    is_enabled: isEnabled,
  };
  notificationSubtypesByName.set(name, updated);
  notificationSubtypesStore.set(updated.id, updated);
  return updated;
}

function preferenceKey(tenant: string, userId: string, subtypeId: number): string {
  return `${tenant}:${userId}:${subtypeId}`;
}

function setUserNotificationPreference(
  tenant: string,
  userId: string,
  subtypeName: string,
  isEnabled: boolean,
): UserNotificationPreferenceRecord {
  const subtype = ensureNotificationSubtype(subtypeName);
  const key = preferenceKey(tenant, userId, subtype.id);
  const record: UserNotificationPreferenceRecord = {
    id:
      userNotificationPreferencesStore.get(key)?.id ??
      userPreferenceIdCounter++,
    tenant,
    user_id: userId,
    subtype_id: subtype.id,
    is_enabled: isEnabled,
    email_address: null,
    frequency: 'realtime',
  };

  userNotificationPreferencesStore.set(key, record);
  return record;
}

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

function notificationSettingsTableBuilder() {
  let result: NotificationSettingRecord | NotificationSettingRecord[] | null = Array.from(
    notificationSettingsStore.values(),
  );
  const builder: any = createQuery(() => result);
  builder.where = (conditions: Record<string, any>) => {
    if (conditions.tenant) {
      const record = notificationSettingsStore.get(conditions.tenant) ?? null;
      result = record;
    }
    return builder;
  };
  builder.insert = (data: any) => {
    const rows = Array.isArray(data) ? data : [data];
    for (const row of rows) {
      const record: NotificationSettingRecord = {
        id: row.id ?? notificationSettingsIdCounter++,
        tenant: row.tenant,
        is_enabled: row.is_enabled ?? true,
        rate_limit_per_minute: row.rate_limit_per_minute ?? 60,
      };
      notificationSettingsStore.set(record.tenant, record);
      result = record;
    }
    return {
      returning: (columns?: string[]) => {
        const latestRows = rows.map((row: any) => notificationSettingsStore.get(row.tenant)!);
        if (!columns) {
          return Promise.resolve(latestRows);
        }
        return Promise.resolve(
          latestRows.map((row) => {
            const picked: Record<string, any> = {};
            for (const column of columns) {
              picked[column] = (row as any)[column];
            }
            return picked;
          }),
        );
      },
    };
  };
  builder.update = (updates: Partial<NotificationSettingRecord>) => {
    const current = result;
    const records = Array.isArray(current) ? current : current ? [current] : [];
    const updatedRecords = records.map((record) => {
      const next: NotificationSettingRecord = {
        ...record,
        ...updates,
      };
      notificationSettingsStore.set(next.tenant, next);
      return next;
    });
    result = updatedRecords.length <= 1 ? updatedRecords[0] ?? null : updatedRecords;
    return Promise.resolve(updatedRecords);
  };
  return builder;
}

function notificationCategoriesTableBuilder() {
  let result: NotificationCategoryRecord[] = Array.from(notificationCategoriesStore.values());
  const builder: any = createQuery(() => result);
  builder.where = (conditions: Record<string, any>) => {
    result = result.filter((row) => matchesConditionsObject(row as any, conditions));
    return builder;
  };
  builder.orderBy = () => builder;
  builder.insert = (data: any) => {
    const rows = Array.isArray(data) ? data : [data];
    const inserted: NotificationCategoryRecord[] = [];
    for (const row of rows) {
      const record: NotificationCategoryRecord = {
        id: row.id ?? notificationCategoryIdCounter++,
        name: row.name,
        description: row.description ?? null,
        is_enabled: row.is_enabled ?? true,
        is_default_enabled: row.is_default_enabled ?? true,
      };
      notificationCategoriesStore.set(record.id, record);
      inserted.push(record);
    }
    result = Array.from(notificationCategoriesStore.values());
    return {
      returning: (columns?: string[]) => {
        if (!columns) {
          return Promise.resolve(inserted);
        }
        return Promise.resolve(
          inserted.map((row) => {
            const picked: Record<string, any> = {};
            for (const column of columns) {
              picked[column] = (row as any)[column];
            }
            return picked;
          }),
        );
      },
    };
  };
  return builder;
}

function notificationSubtypesTableBuilder() {
  let result: NotificationSubtypeRecord[] = Array.from(notificationSubtypesStore.values());
  const builder: any = createQuery(() => result);
  builder.where = (arg1: any, arg2?: any) => {
    if (typeof arg1 === 'object') {
      result = result.filter((row) => matchesConditionsObject(row as any, arg1));
    } else if (typeof arg1 === 'string') {
      result = result.filter((row) => matchesCondition(row as any, arg1, arg2));
    }
    return builder;
  };
  builder.orderBy = (column: string, direction: 'asc' | 'desc' = 'asc') => {
    const factor = direction === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const aValue = (a as any)[normalizeColumnKey(column)];
      const bValue = (b as any)[normalizeColumnKey(column)];
      if (aValue === bValue) {
        return 0;
      }
      return aValue > bValue ? factor : -factor;
    });
    return builder;
  };
  builder.insert = (data: any) => {
    const rows = Array.isArray(data) ? data : [data];
    const inserted: NotificationSubtypeRecord[] = [];
    for (const row of rows) {
      const record: NotificationSubtypeRecord = {
        id: row.id ?? subtypeIdCounter++,
        category_id: row.category_id ?? ensureNotificationCategory('Tickets').id,
        name: row.name,
        description: row.description ?? null,
        is_enabled: row.is_enabled ?? true,
        is_default_enabled: row.is_default_enabled ?? true,
      };
      notificationSubtypesStore.set(record.id, record);
      notificationSubtypesByName.set(record.name, record);
      inserted.push(record);
    }
    result = Array.from(notificationSubtypesStore.values());
    return {
      returning: (columns?: string[]) => {
        if (!columns) {
          return Promise.resolve(inserted);
        }
        return Promise.resolve(
          inserted.map((row) => {
            const picked: Record<string, any> = {};
            for (const column of columns) {
              picked[column] = (row as any)[column];
            }
            return picked;
          }),
        );
      },
    };
  };
  builder.update = (updates: Partial<NotificationSubtypeRecord>) => {
    result = result.map((row) => {
      const updated: NotificationSubtypeRecord = {
        ...row,
        ...updates,
      };
      notificationSubtypesStore.set(updated.id, updated);
      notificationSubtypesByName.set(updated.name, updated);
      return updated;
    });
    return Promise.resolve(result);
  };
  return builder;
}

function userNotificationPreferencesTableBuilder() {
  let result: UserNotificationPreferenceRecord[] = Array.from(
    userNotificationPreferencesStore.values(),
  );
  const builder: any = createQuery(() => result);
  builder.where = (arg1: any, arg2?: any) => {
    if (typeof arg1 === 'object') {
      result = result.filter((row) => matchesConditionsObject(row as any, arg1));
    } else if (typeof arg1 === 'string') {
      result = result.filter((row) => matchesCondition(row as any, arg1, arg2));
    }
    return builder;
  };
  builder.insert = (data: any) => {
    const rows = Array.isArray(data) ? data : [data];
    const inserted: UserNotificationPreferenceRecord[] = [];
    for (const row of rows) {
      const record: UserNotificationPreferenceRecord = {
        id: row.id ?? userPreferenceIdCounter++,
        tenant: row.tenant,
        user_id: row.user_id,
        subtype_id: row.subtype_id,
        is_enabled: row.is_enabled ?? true,
        email_address: row.email_address ?? null,
        frequency: row.frequency ?? 'realtime',
      };
      const key = preferenceKey(record.tenant, record.user_id, record.subtype_id);
      userNotificationPreferencesStore.set(key, record);
      inserted.push(record);
    }
    result = Array.from(userNotificationPreferencesStore.values());
    return {
      returning: (columns?: string[]) => {
        if (!columns) {
          return Promise.resolve(inserted);
        }
        return Promise.resolve(
          inserted.map((row) => {
            const picked: Record<string, any> = {};
            for (const column of columns) {
              picked[column] = (row as any)[column];
            }
            return picked;
          }),
        );
      },
    };
  };
  builder.update = (updates: Partial<UserNotificationPreferenceRecord>) => {
    result = result.map((row) => {
      const updated: UserNotificationPreferenceRecord = {
        ...row,
        ...updates,
      };
      const key = preferenceKey(updated.tenant, updated.user_id, updated.subtype_id);
      userNotificationPreferencesStore.set(key, updated);
      return updated;
    });
    return Promise.resolve(result);
  };
  builder.delete = () => {
    for (const row of result) {
      const key = preferenceKey(row.tenant, row.user_id, row.subtype_id);
      userNotificationPreferencesStore.delete(key);
    }
    result = Array.from(userNotificationPreferencesStore.values());
    return Promise.resolve();
  };
  return builder;
}

function notificationLogsTableBuilder() {
  const builder: any = createQuery(() => notificationLogs);
  builder.insert = (data: any) => {
    const rows = Array.isArray(data) ? data : [data];
    notificationLogs.push(...rows);
    return {
      returning: (columns?: string[]) => {
        if (!columns) {
          return Promise.resolve(rows);
        }
        return Promise.resolve(
          rows.map((row) => {
            const picked: Record<string, any> = {};
            for (const column of columns) {
              picked[column] = (row as any)[column];
            }
            return picked;
          }),
        );
      },
    };
  };
  builder.where = () => builder;
  builder.orderBy = () => builder;
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
      case 'notification_settings':
        return notificationSettingsTableBuilder();
      case 'notification_categories':
        return notificationCategoriesTableBuilder();
      case 'notification_subtypes':
        return notificationSubtypesTableBuilder();
      case 'user_notification_preferences':
        return userNotificationPreferencesTableBuilder();
      case 'notification_logs':
        return notificationLogsTableBuilder();
      default:
        throw new Error(`Unhandled table: ${tableName}`);
    }
  };
  knexFn.schema = {
    hasTable: async () => true,
  };
  knexFn.client = { config: { connection: { database: 'mock-db' } } };
  knexFn.raw = (value: any) => value;
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

vi.mock('next/headers', () => ({
  headers: () => ({
    get: () => null,
  }),
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
  resetNotificationState();
  sendEmailMock.mockReset();
  subscribeMock.mockClear();
  unsubscribeMock.mockClear();
  eventHandlers.clear();
});

afterAll(() => {
  vi.restoreAllMocks();
});

function seedTemplate(
  name: string,
  subject: string,
  html: string,
  options: { text?: string; subtypeName?: string } = {},
) {
  const subtypeName = options.subtypeName ?? subtypeDisplayNameFromTemplate(name);
  const subtype = ensureNotificationSubtype(subtypeName);

  templateStore.set(name, {
    subject,
    html_content: html,
    text_content: options.text ?? html.replace(/<[^>]*>/g, '').trim(),
    notification_subtype_id: subtype.id,
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

describe('ticket email subscriber notification gating (known gap)', () => {
  beforeEach(async () => {
    eventHandlers.clear();
    await registerTicketEmailSubscriber();
  });

  it('skips ticket created email when tenant notifications are disabled', async () => {
    const tenantId = randomUUID();
    const ticketId = randomUUID();

    seedTemplate('ticket-created', 'Ticket Created: {{ticket.title}}', '<p>{{ticket.title}}</p>', {
      subtypeName: 'Ticket Created',
    });

    setNotificationSettings(tenantId, { is_enabled: false });

    setTicket({
      ticket_id: ticketId,
      ticket_number: 'T-0100',
      title: 'Disabled tenant notifications',
      contact_email: 'contact@example.com',
      email_metadata: { threadId: 'thread-disabled-tenant' },
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

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('skips ticket created email when subtype is disabled', async () => {
    const tenantId = randomUUID();
    const ticketId = randomUUID();

    seedTemplate('ticket-created', 'Ticket Created: {{ticket.title}}', '<p>{{ticket.title}}</p>', {
      subtypeName: 'Ticket Created',
    });

    setNotificationSettings(tenantId, { is_enabled: true });
    setSubtypeEnabled('Ticket Created', false);

    setTicket({
      ticket_id: ticketId,
      ticket_number: 'T-0101',
      title: 'Subtype disabled',
      contact_email: 'contact@example.com',
      email_metadata: { threadId: 'thread-disabled-subtype' },
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

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('skips ticket assigned email when user preference is disabled', async () => {
    const tenantId = randomUUID();
    const ticketId = randomUUID();
    const assigneeId = randomUUID();
    const actorId = randomUUID();

    seedTemplate('ticket-assigned', 'Ticket Assigned: {{ticket.title}}', '<p>{{ticket.title}}</p>', {
      subtypeName: 'Ticket Assigned',
    });

    setNotificationSettings(tenantId, { is_enabled: true });
    setSubtypeEnabled('Ticket Assigned', true);
    setUserNotificationPreference(tenantId, assigneeId, 'Ticket Assigned', false);

    setTicket({
      ticket_id: ticketId,
      ticket_number: 'T-0102',
      title: 'Assignee opted out',
      assigned_to_email: 'assignee@example.com',
      assigned_to: assigneeId,
      email_metadata: { threadId: 'thread-disabled-user' },
    });

    setUser({
      user_id: actorId,
      first_name: 'Assigning',
      last_name: 'User',
      email: 'assigner@example.com',
    });

    await handlerFor('TICKET_ASSIGNED')({
      id: randomUUID(),
      eventType: 'TICKET_ASSIGNED',
      timestamp: new Date().toISOString(),
      payload: {
        tenantId,
        ticketId,
        userId: actorId,
      },
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
