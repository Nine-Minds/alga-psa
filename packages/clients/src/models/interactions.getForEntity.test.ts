import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  createTenantKnexMock: vi.fn(),
  tenantDbMock: vi.fn((conn: any, tenant: string) => ({
    table: (table: string) => conn(table, tenant),
    tenantJoin: (query: any) => query,
  })),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: hoisted.createTenantKnexMock,
  tenantDb: hoisted.tenantDbMock,
}));

// getForEntity hydrates the linked online meeting via OnlineMeetingModel (its own
// createTenantKnex); this suite is about the entity filter, so stub it to "no meeting".
vi.mock('./onlineMeeting', () => ({
  default: {
    getByInteractionId: vi.fn(async () => null),
  },
}));

import InteractionModel from './interactions';

type Row = Record<string, any>;

class FakeInteractionQuery {
  private filters: Array<(row: Row) => boolean> = [];

  constructor(private readonly rows: Row[]) {}

  select(..._columns: unknown[]): this {
    return this;
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

  orderBy(..._args: unknown[]): this {
    return this;
  }

  then(resolve: (rows: Row[]) => unknown, reject?: (error: unknown) => unknown): Promise<unknown> {
    return Promise.resolve(this.execute()).then(resolve, reject);
  }

  private execute(): Row[] {
    return this.rows.filter((row) => this.filters.every((filter) => filter(row)));
  }

  private normalizeColumn(column: string): string {
    return column.includes('.') ? (column.split('.').pop() as string) : column;
  }
}

function createFakeDb(rows: Row[]) {
  const db = ((tableName: string) => new FakeInteractionQuery(rows)) as any;
  db.raw = (sql: string) => sql;
  return db;
}

function interaction(overrides: Row = {}): Row {
  return {
    interaction_id: 'interaction-1',
    type_id: 'type-call',
    type_name: 'Call',
    icon: 'phone',
    interaction_date: new Date('2026-07-16T14:30:00.000Z'),
    title: 'Discovery call',
    notes: null,
    start_time: null,
    end_time: null,
    contact_name_id: 'contact-1',
    contact_name: 'Dana',
    client_id: 'client-1',
    client_name: 'Acme',
    user_id: 'user-1',
    user_name: 'Agent',
    ticket_id: null,
    opportunity_id: 'opportunity-1',
    duration: 25,
    status_id: 'status-open',
    status_name: 'Planned',
    is_status_closed: false,
    ...overrides,
  };
}

describe('InteractionModel.getForEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createTenantKnexMock.mockReset();
  });

  it('filters interactions by opportunity_id for the opportunity entity', async () => {
    const rows = [
      interaction({ interaction_id: 'on-deal', opportunity_id: 'opportunity-1' }),
      interaction({ interaction_id: 'other-deal', opportunity_id: 'opportunity-2' }),
    ];
    hoisted.createTenantKnexMock.mockResolvedValue({ knex: createFakeDb(rows), tenant: 'tenant-1' });

    const result = await InteractionModel.getForEntity('opportunity-1', 'opportunity', 'tenant-1');

    expect(result.map((row) => row.interaction_id)).toEqual(['on-deal']);
    expect(result[0]).toMatchObject({ opportunity_id: 'opportunity-1', type_name: 'call' });
  });

  it('keeps the contact and client filters keyed to their own columns', async () => {
    const rows = [
      interaction({ interaction_id: 'on-contact', contact_name_id: 'contact-1', client_id: 'client-2' }),
      interaction({ interaction_id: 'on-client', client_id: 'client-1', contact_name_id: 'contact-2' }),
    ];
    hoisted.createTenantKnexMock.mockResolvedValue({ knex: createFakeDb(rows), tenant: 'tenant-1' });

    const forContact = await InteractionModel.getForEntity('contact-1', 'contact', 'tenant-1');
    const forClient = await InteractionModel.getForEntity('client-1', 'client', 'tenant-1');

    expect(forContact.map((row) => row.interaction_id)).toEqual(['on-contact']);
    expect(forClient.map((row) => row.interaction_id)).toEqual(['on-client']);
  });
});
