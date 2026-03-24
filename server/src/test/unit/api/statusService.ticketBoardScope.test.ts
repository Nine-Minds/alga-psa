import { describe, expect, it, vi } from 'vitest';

import { statusListQuerySchema } from '@/lib/api/schemas/status';
import { StatusService } from '@/lib/api/services/StatusService';

type StatusRow = {
  tenant: string;
  status_id: string;
  status_type: string;
  board_id: string | null;
  name: string;
  order_number: number;
  is_closed: boolean;
};

class FakeStatusQueryBuilder {
  private filters: Array<(row: StatusRow) => boolean> = [];
  private searchTerm: string | null = null;
  private orderings: Array<{ column: keyof StatusRow; direction: 'asc' | 'desc' }> = [];
  private limitValue: number | null = null;
  private offsetValue = 0;
  private mode: 'select' | 'count' | 'first' = 'select';

  constructor(private readonly rows: StatusRow[]) {}

  where(columnOrConditions: string | Record<string, any>, value?: any): this {
    if (typeof columnOrConditions === 'string') {
      this.filters.push((row) => row[columnOrConditions as keyof StatusRow] === value);
    } else {
      this.filters.push((row) =>
        Object.entries(columnOrConditions).every(
          ([column, expected]) => row[column as keyof StatusRow] === expected
        )
      );
    }

    return this;
  }

  whereNotNull(column: string): this {
    this.filters.push((row) => row[column as keyof StatusRow] != null);
    return this;
  }

  whereILike(column: string, term: string): this {
    this.searchTerm = term.replaceAll('%', '').toLowerCase();
    this.filters.push((row) =>
      String(row[column as keyof StatusRow]).toLowerCase().includes(this.searchTerm as string)
    );
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderings.push({ column: column as keyof StatusRow, direction });
    return this;
  }

  limit(value: number): this {
    this.limitValue = value;
    return this;
  }

  offset(value: number): this {
    this.offsetValue = value;
    return this;
  }

  select(): this {
    this.mode = 'select';
    return this;
  }

  count(): this {
    this.mode = 'count';
    return this;
  }

  async first(): Promise<StatusRow | undefined> {
    this.mode = 'first';
    return this.execute()[0];
  }

  then(resolve: (value: any) => void): Promise<any> {
    let result: any;
    if (this.mode === 'count') {
      result = [{ count: String(this.execute().length) }];
    } else {
      result = this.execute();
    }

    return Promise.resolve(result).then(resolve);
  }

  private execute(): StatusRow[] {
    const rows = this.rows
      .filter((row) => this.filters.every((filter) => filter(row)))
      .sort((left, right) => {
        for (const ordering of this.orderings) {
          const leftValue = left[ordering.column];
          const rightValue = right[ordering.column];
          if (leftValue === rightValue) {
            continue;
          }
          if (leftValue < rightValue) {
            return ordering.direction === 'asc' ? -1 : 1;
          }
          if (leftValue > rightValue) {
            return ordering.direction === 'asc' ? 1 : -1;
          }
        }

        return 0;
      });

    const sliced = rows.slice(this.offsetValue, this.limitValue == null ? undefined : this.offsetValue + this.limitValue);
    return this.mode === 'first' ? sliced.slice(0, 1) : sliced;
  }
}

function createFakeKnex(rows: StatusRow[]) {
  return ((tableName: string) => {
    if (tableName !== 'statuses') {
      throw new Error(`Unexpected table ${tableName}`);
    }

    return new FakeStatusQueryBuilder(rows);
  }) as any;
}

describe('status service ticket board scope', () => {
  it('T044: query schema requires board_id when listing generic ticket statuses', () => {
    const result = statusListQuerySchema.safeParse({ type: 'ticket' });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected ticket status query without board_id to fail');
    }

    expect(result.error.issues.some((issue) => issue.path.join('.') === 'board_id')).toBe(true);
  });

  it('T044: list filters generic ticket statuses by board and excludes board-less legacy ticket rows', async () => {
    const rows: StatusRow[] = [
      {
        tenant: 'tenant-1',
        status_id: 'legacy-ticket-status',
        status_type: 'ticket',
        board_id: null,
        name: 'Legacy Ticket',
        order_number: 1,
        is_closed: false,
      },
      {
        tenant: 'tenant-1',
        status_id: 'board-a-ticket-status',
        status_type: 'ticket',
        board_id: 'board-a',
        name: 'Board A Ticket',
        order_number: 2,
        is_closed: false,
      },
      {
        tenant: 'tenant-1',
        status_id: 'board-b-ticket-status',
        status_type: 'ticket',
        board_id: 'board-b',
        name: 'Board B Ticket',
        order_number: 3,
        is_closed: true,
      },
      {
        tenant: 'tenant-1',
        status_id: 'project-status',
        status_type: 'project',
        board_id: null,
        name: 'Project Status',
        order_number: 1,
        is_closed: false,
      },
    ];
    const service = new StatusService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: createFakeKnex(rows) });

    const result = await service.list(
      {
        page: 1,
        limit: 25,
        filters: {
          type: 'ticket',
          board_id: 'board-a',
        },
      } as any,
      {
        tenant: 'tenant-1',
      } as any
    );

    expect(result.data.map((status) => status.status_id)).toEqual(['board-a-ticket-status']);
    expect(result.total).toBe(1);
  });

  it('T044: getById hides legacy board-less ticket statuses but still returns board-owned ticket statuses', async () => {
    const rows: StatusRow[] = [
      {
        tenant: 'tenant-1',
        status_id: 'legacy-ticket-status',
        status_type: 'ticket',
        board_id: null,
        name: 'Legacy Ticket',
        order_number: 1,
        is_closed: false,
      },
      {
        tenant: 'tenant-1',
        status_id: 'board-a-ticket-status',
        status_type: 'ticket',
        board_id: 'board-a',
        name: 'Board A Ticket',
        order_number: 2,
        is_closed: false,
      },
    ];
    const service = new StatusService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: createFakeKnex(rows) });

    await expect(
      service.getById('legacy-ticket-status', { tenant: 'tenant-1' } as any)
    ).resolves.toBeNull();
    await expect(
      service.getById('board-a-ticket-status', { tenant: 'tenant-1' } as any)
    ).resolves.toMatchObject({
      status_id: 'board-a-ticket-status',
      board_id: 'board-a',
    });
  });
});
