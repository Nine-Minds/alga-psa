import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalNotificationListResponse, UnreadCountResponse } from '../../../lib/models/internalNotification';
import { createTenantKnex } from '../../../lib/db';
import {
  broadcastNotification,
  broadcastNotificationRead,
  broadcastAllNotificationsRead
} from '../../../lib/realtime/internalNotificationBroadcaster';
import { randomUUID } from 'crypto';

type Row = Record<string, any>;

// Test UUID constants for notifications
const NOTIFICATION_UUID_1 = '11111111-1111-1111-1111-111111111111';
const NOTIFICATION_UUID_2 = '22222222-2222-2222-2222-222222222222';
const NOTIFICATION_UUID_3 = '33333333-3333-3333-3333-333333333333';
const NOTIFICATION_UUID_4 = '44444444-4444-4444-4444-444444444444';
const NOTIFICATION_UUID_5 = '55555555-5555-5555-5555-555555555555';

interface NotificationRow extends Row {
  internal_notification_id: string;
  tenant: string;
  user_id: string;
  template_name: string | null;
  language_code: string | null;
  title: string | null;
  message: string | null;
  type: string | null;
  category: string | null;
  link: string | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  delivery_status: string | null;
  delivery_attempts: number;
  created_at: string;
  updated_at: string | null;
  read_at: string | null;
  deleted_at: string | null;
}

const PRIMARY_KEYS: Record<string, string | null> = {
  internal_notifications: 'internal_notification_id',
  internal_notification_templates: 'internal_notification_template_id',
  internal_notification_subtypes: 'internal_notification_subtype_id',
  internal_notification_categories: 'internal_notification_category_id',
  user_internal_notification_preferences: 'preference_id'
};

type MockDb = {
  tables: Record<string, Row[]>;
  sequences: Record<string, number>;
};

type MockTransaction = {
  (table: string): QueryBuilder;
  fn: {
    now: () => string;
  };
};

function inferPrimaryKey(table: string): string | null {
  return PRIMARY_KEYS[table] ?? null;
}

function parseTableExpression(expression: string): { table: string; alias: string | null } {
  const match = expression.match(/^\s*([\w.]+)(?:\s+as\s+(\w+))?\s*$/i);
  if (match) {
    return { table: match[1], alias: match[2] ?? null };
  }
  return { table: expression.trim(), alias: null };
}

function normalizeColumnName(column: string, alias: string | null): string {
  if (alias && column.startsWith(`${alias}.`)) {
    return column.slice(alias.length + 1);
  }
  return column;
}

class QueryBuilder {
  private filters: Array<(row: Row) => boolean> = [];
  private limitValue: number | null = null;
  private offsetValue = 0;
  private orderByConfig: { column: string; direction: 'asc' | 'desc' } | null = null;
  private countAlias: string | null = null;
  private selectedColumns: string[] | null = null;
  private readonly alias: string | null;
  private readonly table: string;

  constructor(private readonly db: MockDb, tableExpression: string) {
    const { table, alias } = parseTableExpression(tableExpression);
    this.table = table;
    this.alias = alias;

    if (!this.db.tables[this.table]) {
      this.db.tables[this.table] = [];
    }
    if (!this.db.sequences[this.table]) {
      this.db.sequences[this.table] = 1;
    }
  }

  clone(): QueryBuilder {
    const duplicate = new QueryBuilder(this.db, this.table);
    duplicate.filters = [...this.filters];
    duplicate.limitValue = this.limitValue;
    duplicate.offsetValue = this.offsetValue;
    duplicate.orderByConfig = this.orderByConfig ? { ...this.orderByConfig } : null;
    duplicate.countAlias = this.countAlias;
    duplicate.selectedColumns = this.selectedColumns ? [...this.selectedColumns] : null;
    return duplicate;
  }

  select(...columns: Array<string>): QueryBuilder {
    this.selectedColumns = columns;
    return this;
  }

  leftJoin(_table: string, callback?: (this: any) => void): QueryBuilder {
    if (typeof callback === 'function') {
      const joinClause = {
        on: () => joinClause,
        andOn: () => joinClause
      } as any;
      callback.call(joinClause);
    }
    return this;
  }

  where(columnOrCriteria: Record<string, unknown> | string, value?: unknown): QueryBuilder {
    if (typeof columnOrCriteria === 'object' && columnOrCriteria !== null) {
      const criteria = columnOrCriteria;
      this.filters.push(row =>
        Object.entries(criteria).every(([key, val]) => row[normalizeColumnName(key, this.alias)] === val)
      );
    } else {
      const column = normalizeColumnName(columnOrCriteria, this.alias);
      this.filters.push(row => row[column] === value);
    }
    return this;
  }

  andWhere(columnOrCriteria: Record<string, unknown> | string, value?: unknown): QueryBuilder {
    return this.where(columnOrCriteria, value);
  }

  whereNull(column: keyof NotificationRow | string): QueryBuilder {
    const name = normalizeColumnName(String(column), this.alias);
    this.filters.push(row => row[name] === null || row[name] === undefined);
    return this;
  }

  whereNotNull(column: keyof NotificationRow | string): QueryBuilder {
    const name = normalizeColumnName(String(column), this.alias);
    this.filters.push(row => row[name] !== null && row[name] !== undefined);
    return this;
  }

  orderBy(column: keyof NotificationRow | string, direction: 'asc' | 'desc' = 'asc'): QueryBuilder {
    this.orderByConfig = { column: normalizeColumnName(String(column), this.alias), direction };
    return this;
  }

  limit(count: number): QueryBuilder {
    this.limitValue = count;
    return this;
  }

  offset(count: number): QueryBuilder {
    this.offsetValue = count;
    return this;
  }

  count(expression: string): QueryBuilder {
    const [, alias = 'count'] = expression.split(' as ').map(part => part.trim());
    this.countAlias = alias || 'count';
    return this;
  }

  groupBy(column: keyof NotificationRow | string): Promise<Array<Record<string, unknown>>> {
    const alias = this.countAlias || 'count';
    const columnName = normalizeColumnName(String(column), this.alias);
    const rows = this.applyFilters();
    const aggregation = new Map<unknown, number>();

    for (const row of rows) {
      const key = row[columnName];
      if (!aggregation.has(key)) {
        aggregation.set(key, 0);
      }
      aggregation.set(key, aggregation.get(key)! + 1);
    }

    const result = Array.from(aggregation.entries()).map(([key, count]) => ({
      [columnName]: key,
      [alias]: count
    }));

    return Promise.resolve(result);
  }

  async first<T extends Row>(): Promise<T | undefined> {
    const rows = this.applyFilters();
    return rows[0] as T | undefined;
  }

  update(values: Record<string, unknown>): {
    returning: (columns: string) => Promise<Row[]>;
    then: <TResult1 = number, TResult2 = never>(
      onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) => Promise<TResult1 | TResult2>;
    catch: <TResult = never>(
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
    ) => Promise<number | TResult>;
  } {
    const table = this.db.tables[this.table] ?? [];
    const updatedRows: Row[] = [];

    table.forEach((row, index) => {
      if (this.filters.every(filter => filter(row))) {
        const updated: Row = {
          ...row,
          ...values
        };
        table[index] = updated;
        updatedRows.push(copyRow(updated));
      }
    });

    const updatedCount = updatedRows.length;
    return {
      returning: async () => updatedRows,
      then: (onfulfilled, onrejected) => Promise.resolve(updatedCount).then(onfulfilled, onrejected),
      catch: onrejected => Promise.resolve(updatedCount).catch(onrejected)
    };
  }

  insert(data: Row | Row[]): {
    returning: (columns: string) => Promise<Row[]>;
    then: <TResult1 = number, TResult2 = never>(
      onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) => Promise<TResult1 | TResult2>;
    catch: <TResult = never>(
      onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
    ) => Promise<number | TResult>;
  } {
    const tableRows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    const insertedRows: Row[] = [];
    const records = Array.isArray(data) ? data : [data];
    const primaryKey = inferPrimaryKey(this.table);

    records.forEach(record => {
      const newRow = copyRow(record);

      if (primaryKey && (newRow[primaryKey] === undefined || newRow[primaryKey] === null)) {
        // Use UUID for internal_notification_id, numeric sequence for others
        if (this.table === 'internal_notifications' && primaryKey === 'internal_notification_id') {
          newRow[primaryKey] = randomUUID();
        } else {
          const currentSeq = this.db.sequences[this.table] ?? 1;
          newRow[primaryKey] = currentSeq;
          this.db.sequences[this.table] = currentSeq + 1;
        }
      }

      tableRows.push(newRow);
      insertedRows.push(copyRow(newRow));
    });

    const insertedCount = insertedRows.length;
    return {
      returning: async () => insertedRows,
      then: (onfulfilled, onrejected) => Promise.resolve(insertedCount).then(onfulfilled, onrejected),
      catch: onrejected => Promise.resolve(insertedCount).catch(onrejected)
    };
  }

  private applyFilters(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)));

    if (this.orderByConfig) {
      const { column, direction } = this.orderByConfig;
      rows = [...rows].sort((a, b) => {
        const valueA = a[column];
        const valueB = b[column];

        if (valueA === valueB) return 0;
        if (valueA === null || valueA === undefined) return direction === 'asc' ? -1 : 1;
        if (valueB === null || valueB === undefined) return direction === 'asc' ? 1 : -1;
        return direction === 'asc'
          ? valueA > valueB ? 1 : -1
          : valueA < valueB ? 1 : -1;
      });
    }

    if (this.offsetValue) {
      rows = rows.slice(this.offsetValue);
    }

    if (this.limitValue !== null) {
      rows = rows.slice(0, this.limitValue);
    }

    return rows.map(copyRow);
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[] | Array<Record<string, number>>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    try {
      const result = this.countAlias
        ? [{ [this.countAlias]: this.applyFilters().length }]
        : this.applyFilters();
      return Promise.resolve(onfulfilled ? onfulfilled(result) : (result as unknown as TResult1));
    } catch (error) {
      if (onrejected) {
        return Promise.resolve(onrejected(error));
      }
      return Promise.reject(error);
    }
  }

  catch(onrejected?: (reason: unknown) => unknown): Promise<unknown> {
    return this.then(undefined, onrejected);
  }
}

function copyRow<T extends Row>(row: T): T {
  return JSON.parse(JSON.stringify(row));
}

function createMockDb(initialData: Row[] | Record<string, Row[]> = []): MockDb {
  const tables: Record<string, Row[]> = {};
  const sequences: Record<string, number> = {};

  const tableEntries = Array.isArray(initialData)
    ? { internal_notifications: initialData }
    : initialData;

  for (const [table, rows] of Object.entries(tableEntries)) {
    tables[table] = rows.map(copyRow);
    const primaryKey = inferPrimaryKey(table);
    if (primaryKey && rows.length) {
      const maxId = rows.reduce((acc, row) => {
        const value = row[primaryKey];
        return typeof value === 'number' ? Math.max(acc, value) : acc;
      }, 0);
      sequences[table] = maxId + 1;
    } else {
      sequences[table] = 1;
    }
  }

  return { tables, sequences };
}

function createMockTransaction(db: MockDb): MockTransaction {
  const trx = ((table: string) => new QueryBuilder(db, table)) as unknown as MockTransaction;
  trx.fn = {
    now: () => new Date().toISOString()
  };
  return trx;
}

function buildNotification(overrides: Partial<NotificationRow>): NotificationRow {
  const now = new Date().toISOString();
  return {
    internal_notification_id: overrides.internal_notification_id ?? randomUUID(),
    tenant: overrides.tenant ?? 'tenant-1',
    user_id: overrides.user_id ?? 'user-1',
    template_name: overrides.template_name ?? 'ticket-assigned',
    language_code: overrides.language_code ?? 'en',
    title: overrides.title ?? 'Ticket Assigned',
    message: overrides.message ?? 'You have a new ticket',
    type: overrides.type ?? 'info',
    category: overrides.category ?? null,
    link: overrides.link ?? null,
    metadata: overrides.metadata ?? null,
    is_read: overrides.is_read ?? false,
    delivery_status: overrides.delivery_status ?? 'pending',
    delivery_attempts: overrides.delivery_attempts ?? 0,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? null,
    read_at: overrides.read_at ?? null,
    deleted_at: overrides.deleted_at ?? null
  };
}

let currentDb: MockDb | null = null;

const withTransactionSpy = vi.fn(async (_knex: unknown, callback: (trx: MockTransaction) => Promise<unknown>) => {
  if (!currentDb) {
    throw new Error('Mock database not configured');
  }
  const trx = createMockTransaction(currentDb);
  return callback(trx);
});

vi.mock('@shared/db', () => ({
  withTransaction: withTransactionSpy
}));

vi.mock('../../../lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {}, tenant: 'tenant-1' })),
  getConnection: vi.fn()
}));

vi.mock('../../../lib/realtime/internalNotificationBroadcaster', () => ({
  broadcastNotification: vi.fn(),
  broadcastNotificationRead: vi.fn(),
  broadcastAllNotificationsRead: vi.fn(),
  broadcastUnreadCount: vi.fn()
}));

const createTenantKnexMock = vi.mocked(createTenantKnex);
const broadcastNotificationMock = vi.mocked(broadcastNotification);
const broadcastNotificationReadMock = vi.mocked(broadcastNotificationRead);
const broadcastAllNotificationsReadMock = vi.mocked(broadcastAllNotificationsRead);

let createNotificationFromTemplateAction: (request: Record<string, any>) => Promise<NotificationRow | null>;
let getNotificationsAction: (request: { tenant: string; user_id: string; limit?: number; offset?: number; is_read?: boolean; category?: string }) => Promise<InternalNotificationListResponse>;
let getUnreadCountAction: (tenant: string, userId: string, byCategory?: boolean) => Promise<UnreadCountResponse>;
let markAsReadAction: (tenant: string, userId: string, notificationId: string) => Promise<NotificationRow>;
let markAllAsReadAction: (tenant: string, userId: string) => Promise<{ updated_count: number }>;
let deleteNotificationAction: (tenant: string, userId: string, notificationId: string) => Promise<void>;

beforeAll(async () => {
  const module = await import('../../../lib/actions/internal-notification-actions/internalNotificationActions');
  createNotificationFromTemplateAction = module.createNotificationFromTemplateAction as unknown as typeof createNotificationFromTemplateAction;
  getNotificationsAction = module.getNotificationsAction;
  getUnreadCountAction = module.getUnreadCountAction;
  markAsReadAction = module.markAsReadAction as unknown as typeof markAsReadAction;
  markAllAsReadAction = module.markAllAsReadAction;
  deleteNotificationAction = module.deleteNotificationAction;
});

beforeEach(() => {
  vi.clearAllMocks();
  currentDb = null;
  broadcastNotificationMock.mockResolvedValue(undefined);
  broadcastNotificationReadMock.mockResolvedValue(undefined);
  broadcastAllNotificationsReadMock.mockResolvedValue(undefined);
});

describe('internalNotificationActions data access', () => {
  describe('createNotificationFromTemplateAction', () => {
    const baseTimestamp = '2024-01-01T00:00:00.000Z';

    function buildBaseTables(
      overrides: Partial<Record<string, Row[]>> = {}
    ): Record<string, Row[]> {
      return {
        internal_notifications: [],
        users: [
          {
            user_id: 'user-1',
            tenant: 'tenant-1',
            user_type: 'internal',
            contact_id: null,
            properties: null
          }
        ],
        internal_notification_templates: [
          {
            internal_notification_template_id: 1,
            name: 'ticket-assigned',
            language_code: 'en',
            title: 'Ticket {{ticketId}} assigned',
            message: 'Ticket {{ticketTitle}} assigned',
            subtype_id: 1,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ],
        internal_notification_subtypes: [
          {
            internal_notification_subtype_id: 1,
            internal_category_id: 10,
            name: 'ticket-assigned',
            description: null,
            is_enabled: true,
            is_default_enabled: true,
            available_for_client_portal: true,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ],
        internal_notification_categories: [
          {
            internal_notification_category_id: 10,
            name: 'tickets',
            description: null,
            is_enabled: true,
            is_default_enabled: true,
            available_for_client_portal: true,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ],
        user_internal_notification_preferences: [],
        user_preferences: [],
        tenant_settings: [],
        contacts: [],
        clients: [],
        ...overrides
      };
    }

    it('creates a notification for the intended user when enabled', async () => {
      currentDb = createMockDb(buildBaseTables());

      const request = {
        tenant: 'tenant-1',
        user_id: 'user-1',
        template_name: 'ticket-assigned',
        data: { ticketId: 'T-123', ticketTitle: 'Network outage' },
        type: 'info',
        category: 'tickets',
        metadata: { source: 'test-suite' }
      };

      const created = await createNotificationFromTemplateAction(request);

      expect(created).toBeTruthy();
      expect(created?.user_id).toBe('user-1');
      expect(created?.tenant).toBe('tenant-1');
      expect(created?.title).toBe('Ticket T-123 assigned');
      expect(created?.message).toBe('Ticket Network outage assigned');

      const stored = currentDb!.tables.internal_notifications[0] as NotificationRow;
      expect(stored.category).toBe('tickets');
      expect(typeof stored.metadata).toBe('string');
      expect(JSON.parse(stored.metadata as unknown as string)).toEqual({ source: 'test-suite' });
      expect(broadcastNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
        internal_notification_id: stored.internal_notification_id
      }));
    });

    it('returns null and stores nothing when category preference disables notifications', async () => {
      currentDb = createMockDb(buildBaseTables({
        user_internal_notification_preferences: [
          {
            preference_id: 1,
            tenant: 'tenant-1',
            user_id: 'user-1',
            category_id: 10,
            subtype_id: null,
            is_enabled: false,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ]
      }));

      const request = {
        tenant: 'tenant-1',
        user_id: 'user-1',
        template_name: 'ticket-assigned',
        data: { ticketId: 'T-123', ticketTitle: 'Muted ticket' },
        type: 'info',
        category: 'tickets'
      };

      const created = await createNotificationFromTemplateAction(request);

      expect(created).toBeNull();
      expect(currentDb!.tables.internal_notifications).toHaveLength(0);
      expect(broadcastNotificationMock).not.toHaveBeenCalled();
    });

    it('allows subtype preference to override disabled category', async () => {
      currentDb = createMockDb(buildBaseTables({
        user_internal_notification_preferences: [
          {
            preference_id: 1,
            tenant: 'tenant-1',
            user_id: 'user-1',
            category_id: 10,
            subtype_id: null,
            is_enabled: false,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          },
          {
            preference_id: 2,
            tenant: 'tenant-1',
            user_id: 'user-1',
            category_id: null,
            subtype_id: 1,
            is_enabled: true,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ]
      }));

      const request = {
        tenant: 'tenant-1',
        user_id: 'user-1',
        template_name: 'ticket-assigned',
        data: { ticketId: 'T-456', ticketTitle: 'Escalated ticket' },
        type: 'info',
        category: 'tickets'
      };

      const created = await createNotificationFromTemplateAction(request);

      expect(created).toBeTruthy();
      expect(currentDb!.tables.internal_notifications).toHaveLength(1);
      expect(broadcastNotificationMock).toHaveBeenCalled();
    });

    it('uses user locale preference when localized template exists', async () => {
      currentDb = createMockDb(buildBaseTables({
        users: [
          {
            user_id: 'user-1',
            tenant: 'tenant-1',
            user_type: 'client',
            contact_id: null,
            properties: null
          }
        ],
        user_preferences: [
          {
            tenant: 'tenant-1',
            user_id: 'user-1',
            setting_name: 'locale',
            setting_value: 'es',
            updated_at: baseTimestamp
          }
        ],
        internal_notification_templates: [
          {
            internal_notification_template_id: 1,
            name: 'ticket-assigned',
            language_code: 'en',
            title: 'Ticket {{ticketId}} assigned',
            message: 'Ticket {{ticketTitle}} assigned',
            subtype_id: 1,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          },
          {
            internal_notification_template_id: 2,
            name: 'ticket-assigned',
            language_code: 'es',
            title: 'Ticket {{ticketId}} asignado',
            message: 'Ticket {{ticketTitle}} asignado',
            subtype_id: 1,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ]
      }));

      const created = await createNotificationFromTemplateAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        template_name: 'ticket-assigned',
        data: { ticketId: 'T-789', ticketTitle: 'Servidor' }
      });

      expect(created?.language_code).toBe('es');
      expect(created?.title).toBe('Ticket T-789 asignado');
      expect(created?.message).toBe('Ticket Servidor asignado');
      expect(broadcastNotificationMock).toHaveBeenCalled();
    });

    it('falls back to English template when preferred locale is unavailable', async () => {
      currentDb = createMockDb(buildBaseTables({
        users: [
          {
            user_id: 'user-1',
            tenant: 'tenant-1',
            user_type: 'client',
            contact_id: null,
            properties: null
          }
        ],
        user_preferences: [
          {
            tenant: 'tenant-1',
            user_id: 'user-1',
            setting_name: 'locale',
            setting_value: 'fr',
            updated_at: baseTimestamp
          }
        ]
      }));

      const created = await createNotificationFromTemplateAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        template_name: 'ticket-assigned',
        data: { ticketId: 'T-321', ticketTitle: 'Fallback' }
      });

      expect(created).toBeTruthy();
      expect(created?.language_code).toBe('fr');
      expect(created?.title).toBe('Ticket T-321 assigned');
      expect(broadcastNotificationMock).toHaveBeenCalled();
    });

    it('throws when template name does not exist', async () => {
      currentDb = createMockDb(buildBaseTables());

      await expect(
        createNotificationFromTemplateAction({
          tenant: 'tenant-1',
          user_id: 'user-1',
          template_name: 'missing-template',
          data: {}
        })
      ).rejects.toThrow("Template 'missing-template' not found");
      expect(currentDb!.tables.internal_notifications).toHaveLength(0);
      expect(broadcastNotificationMock).not.toHaveBeenCalled();
    });

    it('skips notification when subtype is disabled system-wide', async () => {
      currentDb = createMockDb(buildBaseTables({
        internal_notification_subtypes: [
          {
            internal_notification_subtype_id: 1,
            internal_category_id: 10,
            name: 'ticket-assigned',
            description: null,
            is_enabled: false,
            is_default_enabled: true,
            available_for_client_portal: true,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ]
      }));

      const created = await createNotificationFromTemplateAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        template_name: 'ticket-assigned',
        data: { ticketId: 'T-999' }
      });

      expect(created).toBeNull();
      expect(currentDb!.tables.internal_notifications).toHaveLength(0);
      expect(broadcastNotificationMock).not.toHaveBeenCalled();
    });

    it('skips notification when category is disabled system-wide', async () => {
      currentDb = createMockDb(buildBaseTables({
        internal_notification_categories: [
          {
            internal_notification_category_id: 10,
            name: 'tickets',
            description: null,
            is_enabled: false,
            is_default_enabled: true,
            available_for_client_portal: true,
            created_at: baseTimestamp,
            updated_at: baseTimestamp
          }
        ]
      }));

      const created = await createNotificationFromTemplateAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        template_name: 'ticket-assigned',
        data: { ticketId: 'T-1000' }
      });

      expect(created).toBeNull();
      expect(currentDb!.tables.internal_notifications).toHaveLength(0);
      expect(broadcastNotificationMock).not.toHaveBeenCalled();
    });
  });

  describe('getNotificationsAction', () => {
    it('returns notifications sorted by created_at descending and excludes soft-deleted entries', async () => {
      currentDb = createMockDb([
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_1,
          created_at: '2024-01-01T10:00:00.000Z'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_2,
          created_at: '2024-01-02T10:00:00.000Z'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_3,
          created_at: '2024-01-03T10:00:00.000Z',
          deleted_at: '2024-01-04T00:00:00.000Z'
        })
      ]);

      const response = await getNotificationsAction({
        tenant: 'tenant-1',
        user_id: 'user-1'
      });

      expect(response.notifications.map(n => n.internal_notification_id)).toEqual([NOTIFICATION_UUID_2, NOTIFICATION_UUID_1]);
      expect(response.total).toBe(2);
      expect(response.unread_count).toBe(2);
      expect(response.has_more).toBe(false);
    });

    it('applies read status and category filters', async () => {
      currentDb = createMockDb([
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_1,
          is_read: false,
          category: 'tickets'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_2,
          is_read: true,
          category: 'tickets'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_3,
          is_read: false,
          category: 'projects'
        })
      ]);

      const unread = await getNotificationsAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        is_read: false
      });
      expect(unread.notifications.every(n => !n.is_read)).toBe(true);
      expect(unread.total).toBe(2);

      const tickets = await getNotificationsAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        category: 'tickets'
      });
      expect(tickets.notifications.every(n => n.category === 'tickets')).toBe(true);
      expect(tickets.total).toBe(2);
    });

    it('calculates has_more using total count, limit, and offset', async () => {
      currentDb = createMockDb([
        buildNotification({ internal_notification_id: NOTIFICATION_UUID_1 }),
        buildNotification({ internal_notification_id: NOTIFICATION_UUID_2 }),
        buildNotification({ internal_notification_id: NOTIFICATION_UUID_3 }),
        buildNotification({ internal_notification_id: NOTIFICATION_UUID_4 })
      ]);

      const firstPage = await getNotificationsAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        limit: 2,
        offset: 0
      });
      expect(firstPage.notifications).toHaveLength(2);
      expect(firstPage.has_more).toBe(true);

      const lastPage = await getNotificationsAction({
        tenant: 'tenant-1',
        user_id: 'user-1',
        limit: 2,
        offset: 2
      });
      expect(lastPage.notifications).toHaveLength(2);
      expect(lastPage.has_more).toBe(false);
    });
  });

  describe('getUnreadCountAction', () => {
    it('returns unread totals excluding soft-deleted records', async () => {
      currentDb = createMockDb([
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_1,
          is_read: false,
          category: 'tickets'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_2,
          is_read: false,
          category: 'tickets'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_3,
          is_read: true,
          category: 'tickets'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_4,
          is_read: false,
          category: 'projects',
          deleted_at: '2024-01-10T00:00:00.000Z'
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_5,
          is_read: false,
          category: null
        })
      ]);

      const response = await getUnreadCountAction('tenant-1', 'user-1', true);
      expect(response.unread_count).toBe(3);
      expect(response.by_category).toEqual({
        tickets: 2
      });
    });

    it('returns zero counts for users without notifications', async () => {
      currentDb = createMockDb([]);

      const response = await getUnreadCountAction('tenant-1', 'missing-user');
      expect(response.unread_count).toBe(0);
    });
  });

  describe('markAsReadAction', () => {
    it('marks the notification as read and emits broadcast event', async () => {
      const createdAt = '2024-01-01T00:00:00.000Z';
      currentDb = createMockDb([
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_1,
          created_at: createdAt,
          updated_at: createdAt,
          is_read: false,
          read_at: null
        })
      ]);

      const updated = await markAsReadAction('tenant-1', 'user-1', NOTIFICATION_UUID_1);

      expect(updated.is_read).toBe(true);
      expect(updated.read_at).toBeTruthy();
      expect(broadcastNotificationReadMock).toHaveBeenCalledWith('tenant-1', 'user-1', NOTIFICATION_UUID_1);
    });

    it('throws when notification is not found and does not broadcast', async () => {
      currentDb = createMockDb([]);

      await expect(markAsReadAction('tenant-1', 'user-1', 'nonexistent-uuid')).rejects.toThrow('Notification not found');
      expect(broadcastNotificationReadMock).not.toHaveBeenCalled();
    });

    it('fails when attempting to read a notification owned by another user', async () => {
      currentDb = createMockDb([
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_1,
          user_id: 'owner-user',
          is_read: false
        })
      ]);

      await expect(markAsReadAction('tenant-1', 'other-user', NOTIFICATION_UUID_1)).rejects.toThrow('Notification not found');
      expect(broadcastNotificationReadMock).not.toHaveBeenCalled();
      const row = currentDb.tables.internal_notifications[0];
      expect(row.is_read).toBe(false);
    });
  });

  describe('markAllAsReadAction', () => {
    it('updates only unread and non-deleted notifications', async () => {
      currentDb = createMockDb([
        buildNotification({ internal_notification_id: NOTIFICATION_UUID_1, is_read: false }),
        buildNotification({ internal_notification_id: NOTIFICATION_UUID_2, is_read: true }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_3,
          is_read: false,
          deleted_at: '2024-01-02T00:00:00.000Z'
        })
      ]);

      const result = await markAllAsReadAction('tenant-1', 'user-1');
      expect(result.updated_count).toBe(1);

      const remaining = currentDb.tables.internal_notifications;
      const updated = remaining.find(row => row.internal_notification_id === NOTIFICATION_UUID_1);
      expect(updated?.is_read).toBe(true);
      expect(updated?.read_at).toBeTruthy();

      const deleted = remaining.find(row => row.internal_notification_id === NOTIFICATION_UUID_3);
      expect(deleted?.is_read).toBe(false);

      expect(broadcastAllNotificationsReadMock).toHaveBeenCalledWith('tenant-1', 'user-1');
      expect(broadcastAllNotificationsReadMock).toHaveBeenCalledTimes(1);
    });

    it('returns zero when there are no unread notifications', async () => {
      currentDb = createMockDb([
        buildNotification({ internal_notification_id: NOTIFICATION_UUID_1, is_read: true })
      ]);

      const result = await markAllAsReadAction('tenant-1', 'user-1');
      expect(result.updated_count).toBe(0);
      expect(broadcastAllNotificationsReadMock).toHaveBeenCalledWith('tenant-1', 'user-1');
    });
  });

  describe('deleteNotificationAction', () => {
    it('soft deletes the notification in the table', async () => {
      currentDb = createMockDb([
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_1,
          deleted_at: null
        })
      ]);

      await deleteNotificationAction('tenant-1', 'user-1', NOTIFICATION_UUID_1);

      const deletedRow = currentDb.tables.internal_notifications[0];
      expect(deletedRow.deleted_at).toBeTruthy();
    });

    it('does not delete notifications for a different user or tenant', async () => {
      currentDb = createMockDb([
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_1,
          user_id: 'owner-user',
          tenant: 'tenant-1',
          deleted_at: null
        }),
        buildNotification({
          internal_notification_id: NOTIFICATION_UUID_2,
          user_id: 'owner-user',
          tenant: 'tenant-2',
          deleted_at: null
        })
      ]);

      await deleteNotificationAction('tenant-1', 'another-user', NOTIFICATION_UUID_1);
      await deleteNotificationAction('tenant-1', 'owner-user', NOTIFICATION_UUID_2);

      const [firstRow, secondRow] = currentDb.tables.internal_notifications;
      expect(firstRow.deleted_at).toBeNull();
      expect(secondRow.deleted_at).toBeNull();
    });
  });
});
