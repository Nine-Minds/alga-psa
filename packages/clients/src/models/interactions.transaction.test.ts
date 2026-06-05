import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
}));

// getById hydrates the linked online meeting via OnlineMeetingModel (its own createTenantKnex);
// this suite focuses on interaction transaction semantics, so stub it to "no meeting".
vi.mock('./onlineMeeting', () => ({
  default: {
    getByInteractionId: vi.fn(async () => null),
  },
}));

import InteractionModel from './interactions';

type Row = Record<string, any>;

class FakeInteractionQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private insertRow: Row | null = null;

  constructor(private readonly rows: Row[]) {}

  insert(data: Row): this {
    this.insertRow = data;
    return this;
  }

  async returning(_columns: string): Promise<Row[]> {
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
    hoisted.createTenantKnexMock.mockReset();
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
});
