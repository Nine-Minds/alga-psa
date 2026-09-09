import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  withTransactionMock: vi.fn(),
  syncInteractionScheduleEntriesMock: vi.fn(),
  publishInteractionSearchEventMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  tenantDbMock: vi.fn((conn: any, tenant: string) => ({
    table: (table: string) => conn(table).where({ tenant }),
    tenantJoin: (query: any) => query,
  })),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: hoisted.tenantDbMock,
  withTransaction: hoisted.withTransactionMock,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal' }, { tenant: 'tenant-1' }, ...args),
}));
vi.mock('../lib/authHelpers', () => ({
  assertMspPermission: vi.fn(),
  hasPermissionAsync: vi.fn(),
}));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: {} }));
vi.mock('next/cache', () => ({ revalidatePath: hoisted.revalidatePathMock }));
vi.mock('../actions/interactionCreateHelper', () => ({
  createInteractionScheduleEntry: vi.fn(),
  createInteractionWithSideEffects: vi.fn(),
  deleteInteractionScheduleEntries: vi.fn(),
  resolveScheduleAssignees: vi.fn(),
  syncInteractionScheduleEntries: hoisted.syncInteractionScheduleEntriesMock,
  publishInteractionSearchEvent: hoisted.publishInteractionSearchEventMock,
}));

// getById hydrates the linked online meeting via OnlineMeetingModel (its own createTenantKnex);
// this suite focuses on interaction transaction semantics, so stub it to "no meeting".
vi.mock('./onlineMeeting', () => ({
  default: {
    getByInteractionId: vi.fn(async () => null),
  },
}));

import InteractionModel from './interactions';
import { updateInteraction } from '../actions/interactionActions';

type Row = Record<string, any>;

class FakeInteractionQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private insertRow: Row | null = null;
  private updateData: Row | null = null;

  constructor(private readonly rows: Row[]) {}

  insert(data: Row): this {
    this.insertRow = data;
    return this;
  }

  update(data: Row): this {
    this.updateData = data;
    return this;
  }

  async returning(_columns: string): Promise<Row[]> {
    if (this.updateData) {
      for (const row of this.rows.filter((row) => this.filters.every((filter) => filter(row)))) {
        Object.assign(row, this.updateData);
      }
    }
    if (!this.insertRow) {
      return this.execute();
    }

    const row = {
      ...this.insertRow,
      interaction_id: this.insertRow.interaction_id ?? `interaction-${this.rows.length + 1}`,
    };
    this.rows.push(row);
    return [row];
  }

  where(columnOrConditions: string | Row, value?: unknown): this {
    if (typeof columnOrConditions === 'string') {
      const key = this.normalizeColumn(columnOrConditions);
      this.filters.push((row) => row[key] === value);
      return this;
    }

    this.filters.push((row) =>
      Object.entries(columnOrConditions).every(([key, expected]) => row[this.normalizeColumn(key)] === expected),
    );
    return this;
  }

  select(..._columns: unknown[]): this {
    return this;
  }

  leftJoin(..._args: unknown[]): this {
    return this;
  }

  async first(): Promise<Row | undefined> {
    return this.execute()[0];
  }

  private execute(): Row[] {
    return this.rows
      .filter((row) => this.filters.every((filter) => filter(row)))
      .map((row) => ({
        ...row,
        type_name: row.type_name ?? 'Online Meeting',
        icon: row.icon ?? 'video',
        contact_name: row.contact_name ?? null,
        client_name: row.client_name ?? null,
        user_name: row.user_name ?? null,
        status_name: row.status_name ?? null,
        is_status_closed: row.is_status_closed ?? false,
      }));
  }

  private normalizeColumn(column: string): string {
    return column.includes('.') ? column.split('.').pop() as string : column;
  }
}

function createFakeDb(rows: Row[]) {
  const db = ((tableName: string) => {
    if (tableName !== 'interactions') {
      throw new Error(`Unexpected table ${tableName}`);
    }
    return new FakeInteractionQuery(rows);
  }) as any;

  db.raw = (sql: string) => sql;
  return db;
}

function interactionInput(overrides: Row = {}) {
  return {
    type_id: 'type-online-meeting',
    type_name: 'Online Meeting',
    contact_name_id: null,
    contact_name: null,
    client_id: 'client-1',
    client_name: null,
    user_id: 'user-1',
    user_name: 'Agent',
    ticket_id: null,
    title: 'Support meeting',
    notes: undefined,
    interaction_date: new Date('2026-06-01T12:00:00.000Z'),
    duration: null,
    status_id: 'status-open',
    ...overrides,
  };
}

describe('InteractionModel transaction support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createTenantKnexMock.mockReset();
    hoisted.withTransactionMock.mockReset();
    hoisted.syncInteractionScheduleEntriesMock.mockReset();
  });

  it('writes addInteraction through the passed transaction so rollback leaves the base store unchanged', async () => {
    const baseRows: Row[] = [];
    const stagedRows: Row[] = [];
    const trx = createFakeDb(stagedRows);

    const created = await InteractionModel.addInteraction(interactionInput(), 'tenant-1', trx);

    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
    expect(created).toMatchObject({
      interaction_id: 'interaction-1',
      tenant: 'tenant-1',
      client_id: 'client-1',
      type_name: 'online meeting',
    });
    expect(stagedRows).toHaveLength(1);
    expect(baseRows).toHaveLength(0);

    stagedRows.length = 0;
    expect(baseRows).toHaveLength(0);
  });

  it('keeps addInteraction working without an explicit transaction', async () => {
    const rows: Row[] = [];
    const db = createFakeDb(rows);
    hoisted.createTenantKnexMock.mockResolvedValue({ knex: db, tenant: 'tenant-1' });

    const created = await InteractionModel.addInteraction(interactionInput(), 'tenant-1');

    expect(hoisted.createTenantKnexMock).toHaveBeenCalledWith('tenant-1');
    expect(rows).toHaveLength(1);
    expect(created).toMatchObject({
      interaction_id: 'interaction-1',
      tenant: 'tenant-1',
      client_id: 'client-1',
    });
  });

  it('updates and reloads through the supplied transaction without opening a pooled connection', async () => {
    const baseRows = [interactionInput({ interaction_id: 'interaction-1', tenant: 'tenant-1' })];
    const stagedRows = structuredClone(baseRows);
    const trx = createFakeDb(stagedRows);

    const updated = await InteractionModel.updateInteraction('interaction-1', { title: 'New title' }, 'tenant-1', trx);

    expect(updated.title).toBe('New title');
    expect(stagedRows[0].title).toBe('New title');
    expect(baseRows[0].title).toBe('Support meeting');
    expect(hoisted.createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('keeps updateInteraction working without an explicit transaction', async () => {
    const rows = [interactionInput({ interaction_id: 'interaction-1', tenant: 'tenant-1' })];
    hoisted.createTenantKnexMock.mockResolvedValue({ knex: createFakeDb(rows), tenant: 'tenant-1' });

    const updated = await InteractionModel.updateInteraction('interaction-1', { title: 'New title' }, 'tenant-1');

    expect(updated.title).toBe('New title');
    expect(rows[0].title).toBe('New title');
    expect(hoisted.createTenantKnexMock).toHaveBeenCalledExactlyOnceWith('tenant-1');
  });

  it.each([false, true])('keeps interaction and calendar updates atomic (sync fails: %s)', async (syncFails) => {
    const rows = [interactionInput({ interaction_id: 'interaction-1', tenant: 'tenant-1' })];
    const calendar = { title: 'Support meeting' };
    const db = createFakeDb(rows);
    hoisted.createTenantKnexMock.mockResolvedValue({ knex: db, tenant: 'tenant-1' });
    hoisted.withTransactionMock.mockImplementation(async (_db, callback) => {
      const stagedRows = structuredClone(rows);
      const stagedCalendar = { ...calendar };
      const trx = createFakeDb(stagedRows);
      hoisted.syncInteractionScheduleEntriesMock.mockImplementation(async (connection, tenant, interaction) => {
        expect(connection).toBe(trx);
        expect(tenant).toBe('tenant-1');
        expect(interaction.title).toBe('New title');
        expect(stagedRows[0].title).toBe('New title');
        stagedCalendar.title = interaction.title;
        if (syncFails) throw new Error('Calendar synchronization failed');
      });
      // A transaction only commits the staged state when its callback succeeds.
      const result = await callback(trx);
      rows.splice(0, rows.length, ...stagedRows);
      Object.assign(calendar, stagedCalendar);
      return result;
    });

    const result = updateInteraction('interaction-1', { title: 'New title' });

    if (syncFails) {
      await expect(result).rejects.toThrow('Calendar synchronization failed');
      expect(rows[0].title).toBe('Support meeting');
      expect(calendar.title).toBe('Support meeting');
      expect(hoisted.publishInteractionSearchEventMock).not.toHaveBeenCalled();
      expect(hoisted.revalidatePathMock).not.toHaveBeenCalled();
    } else {
      await expect(result).resolves.toMatchObject({ title: 'New title' });
      expect(rows[0].title).toBe('New title');
      expect(calendar.title).toBe('New title');
      expect(hoisted.publishInteractionSearchEventMock).toHaveBeenCalledOnce();
      expect(hoisted.revalidatePathMock).toHaveBeenCalledOnce();
    }
    expect(hoisted.syncInteractionScheduleEntriesMock).toHaveBeenCalledOnce();
    expect(hoisted.createTenantKnexMock).toHaveBeenCalledExactlyOnceWith();
  });
});
