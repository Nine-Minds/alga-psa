import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type StatusRow = {
  tenant: string;
  status_id: string;
  status_type: string;
  board_id: string | null;
  name: string;
  is_closed: boolean;
  is_default?: boolean;
  order_number?: number;
};

const routeState = vi.hoisted(() => ({
  rows: [] as StatusRow[],
}));

class FakeTicketStatusQueryBuilder {
  private filters: Record<string, any> = {};
  private notNullColumns = new Set<string>();
  private selectedColumns: string[] = [];
  private orderings: Array<{ column: string; direction: 'asc' | 'desc' }> = [];

  where(conditions: Record<string, any>): this {
    Object.assign(this.filters, conditions);
    return this;
  }

  whereNotNull(column: string): this {
    this.notNullColumns.add(column);
    return this;
  }

  modify(callback: (builder: this) => void): this {
    callback(this);
    return this;
  }

  andWhere(conditions: Record<string, any>): this {
    return this.where(conditions);
  }

  select(...columns: string[]): this {
    this.selectedColumns = columns;
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): this {
    this.orderings.push({ column, direction });
    return this;
  }

  then(resolve: (value: any[]) => void): Promise<any[]> {
    const filtered = routeState.rows
      .filter((row) =>
        Object.entries(this.filters).every(([column, value]) => row[column as keyof StatusRow] === value)
      )
      .filter((row) => Array.from(this.notNullColumns).every((column) => row[column as keyof StatusRow] != null))
      .sort((left, right) => {
        for (const ordering of this.orderings) {
          const leftValue = left[ordering.column as keyof StatusRow];
          const rightValue = right[ordering.column as keyof StatusRow];
          if (leftValue === rightValue) {
            continue;
          }

          if (leftValue == null) {
            return ordering.direction === 'asc' ? 1 : -1;
          }

          if (rightValue == null) {
            return ordering.direction === 'asc' ? -1 : 1;
          }

          if (leftValue < rightValue) {
            return ordering.direction === 'asc' ? -1 : 1;
          }

          if (leftValue > rightValue) {
            return ordering.direction === 'asc' ? 1 : -1;
          }
        }

        return 0;
      })
      .map((row) => {
        if (this.selectedColumns.length === 0) {
          return row;
        }

        return this.selectedColumns.reduce<Record<string, any>>((acc, column) => {
          acc[column] = row[column as keyof StatusRow];
          return acc;
        }, {});
      });

    return Promise.resolve(filtered).then(resolve);
  }
}

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({
      tenant: 'tenant-1',
      user_id: 'user-1',
    })),
    validateApiKeyForTenant: vi.fn(async () => ({
      tenant: 'tenant-1',
      user_id: 'user-1',
    })),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({
    user_id: 'user-1',
  })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ((tableName: string) => {
    if (tableName !== 'statuses') {
      throw new Error(`Unexpected table ${tableName}`);
    }

    return new FakeTicketStatusQueryBuilder();
  })),
}));

import { GET } from '@/app/api/v1/tickets/statuses/route';

describe('ticket statuses route board scope', () => {
  const boardAId = '11111111-1111-1111-1111-111111111111';
  const boardBId = '22222222-2222-2222-2222-222222222222';

  beforeEach(() => {
    routeState.rows = [
      {
        tenant: 'tenant-1',
        status_id: 'legacy-ticket-status',
        status_type: 'ticket',
        board_id: null,
        name: 'Legacy Global',
        is_closed: false,
        is_default: false,
        order_number: 1,
      },
      {
        tenant: 'tenant-1',
        status_id: 'board-a-status',
        status_type: 'ticket',
        board_id: boardAId,
        name: 'Board A',
        is_closed: false,
        is_default: true,
        order_number: 2,
      },
      {
        tenant: 'tenant-1',
        status_id: 'board-b-status',
        status_type: 'ticket',
        board_id: boardBId,
        name: 'Board B',
        is_closed: true,
        is_default: false,
        order_number: 3,
      },
      {
        tenant: 'tenant-1',
        status_id: 'project-status',
        status_type: 'project',
        board_id: null,
        name: 'Project',
        is_closed: false,
        is_default: false,
        order_number: 1,
      },
    ];
  });

  it('T043: filters ticket statuses by board and excludes board-less legacy rows', async () => {
    const request = new NextRequest(`http://localhost/api/v1/tickets/statuses?board_id=${boardAId}`, {
      headers: {
        'x-api-key': 'test-api-key',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        status_id: 'board-a-status',
        board_id: boardAId,
        name: 'Board A',
        is_closed: false,
        is_default: true,
        order_number: 2,
      },
    ]);
  });

  it('returns all board-owned ticket statuses when board scope is omitted', async () => {
    const request = new NextRequest('http://localhost/api/v1/tickets/statuses', {
      headers: {
        'x-api-key': 'test-api-key',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.map((status: any) => status.status_id)).toEqual(['board-a-status', 'board-b-status']);
  });
});
