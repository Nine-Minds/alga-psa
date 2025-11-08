import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLinkedSsoProvidersAction } from '@/lib/actions/auth/getLinkedSsoProviders';

type TableRow = Record<string, any>;
type TableStore = Record<string, TableRow[]>;

class MockQueryBuilder {
  private selectColumns: string[] | undefined;
  private filters: Array<(row: TableRow) => boolean> = [];

  constructor(private readonly tableName: string, private readonly tables: TableStore) {}

  select(...columns: string[]) {
    if (columns.length > 0) {
      this.selectColumns = columns;
    }
    return this;
  }

  where(conditions: Record<string, unknown>) {
    this.filters.push((row) => matches(row, conditions));
    return this;
  }

  andWhere(conditions: Record<string, unknown>) {
    return this.where(conditions);
  }

  first() {
    const [firstRow] = this.resolve();
    return Promise.resolve(firstRow);
  }

  then(onFulfilled?: (value: TableRow[]) => unknown, onRejected?: (reason: unknown) => unknown) {
    try {
      const result = this.resolve();
      return Promise.resolve(result).then(onFulfilled, onRejected);
    } catch (error) {
      return Promise.reject(error).then(onFulfilled, onRejected);
    }
  }

  private resolve(): TableRow[] {
    const rows = (this.tables[this.tableName] ?? []).filter((row) =>
      this.filters.every((predicate) => predicate(row)),
    );
    return rows.map((row) => this.project(row));
  }

  private project(row: TableRow): TableRow {
    if (!this.selectColumns || this.selectColumns.length === 0 || this.selectColumns.includes('*')) {
      return { ...row };
    }

    return this.selectColumns.reduce<TableRow>((acc, column) => {
      acc[column] = row[column];
      return acc;
    }, {});
  }
}

function matches(row: TableRow, conditions: Record<string, unknown>): boolean {
  return Object.entries(conditions).every(([key, value]) => row[key] === value);
}

function createMockKnex(tables: TableStore) {
  const factory = (tableName: string) => new MockQueryBuilder(tableName, tables);
  return Object.assign(factory, { fn: {} });
}

const { tables, mockKnex, getAdminConnectionMock, getTenantIdBySlugMock } = vi.hoisted(() => {
  const hoistedTables: TableStore = {
    users: [],
    user_auth_accounts: [],
  };

  return {
    tables: hoistedTables,
    mockKnex: createMockKnex(hoistedTables),
    getAdminConnectionMock: vi.fn(async () => createMockKnex(hoistedTables)),
    getTenantIdBySlugMock: vi.fn(async () => undefined),
  };
});

vi.mock('@shared/db/admin', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

vi.mock('server/src/lib/actions/tenant-actions/tenantSlugActions', () => ({
  getTenantIdBySlug: getTenantIdBySlugMock,
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

describe('getLinkedSsoProvidersAction', () => {
  beforeEach(() => {
    tables.users.length = 0;
    tables.user_auth_accounts.length = 0;
    getAdminConnectionMock.mockClear();
    getAdminConnectionMock.mockResolvedValue(mockKnex);
    getTenantIdBySlugMock.mockReset();
  });

  it('only returns providers while a link exists for the user', async () => {
    tables.users.push({
      user_id: 'user-1',
      email: 'admin@example.com',
      user_type: 'internal',
      tenant: 'tenant-123',
      two_factor_enabled: true,
    });

    // No link yet – providers should be empty.
    let result = await getLinkedSsoProvidersAction({ email: 'admin@example.com', userType: 'internal' });
    expect(result.providers).toEqual([]);
    expect(result.twoFactorEnabled).toBe(true);

    // Link the user to Google – providers should surface that option.
    tables.user_auth_accounts.push({
      tenant: 'tenant-123',
      user_id: 'user-1',
      provider: 'google',
      provider_account_id: 'admin@example.com',
    });

    result = await getLinkedSsoProvidersAction({ email: 'Admin@example.com', userType: 'internal' });
    expect(result.providers).toEqual(['google']);

    // Simulate unlink by clearing the assignment and verify access is removed.
    tables.user_auth_accounts.length = 0;
    result = await getLinkedSsoProvidersAction({ email: 'ADMIN@example.com', userType: 'internal' });
    expect(result.providers).toEqual([]);
  });

  it('scopes lookups by tenant slug before returning linked providers', async () => {
    tables.users.push(
      {
        user_id: 'user-a',
        email: 'ops@example.com',
        user_type: 'internal',
        tenant: 'tenant-a',
        two_factor_enabled: false,
      },
      {
        user_id: 'user-b',
        email: 'ops@example.com',
        user_type: 'internal',
        tenant: 'tenant-b',
        two_factor_enabled: false,
      },
    );

    tables.user_auth_accounts.push({
      tenant: 'tenant-b',
      user_id: 'user-b',
      provider: 'microsoft',
      provider_account_id: 'ops@example.com',
    });

    getTenantIdBySlugMock.mockResolvedValue('tenant-b');

    const result = await getLinkedSsoProvidersAction({
      email: 'ops@example.com',
      userType: 'internal',
      tenantSlug: 'acme',
    });

    expect(getTenantIdBySlugMock).toHaveBeenCalledWith('acme');
    expect(result.providers).toEqual(['microsoft']);
  });
});
