import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  tenant: string;
  id: string;
  domain: string;
  is_active: boolean;
  claim_status?: string | null;
  claim_status_updated_at?: string | null;
  claimed_at?: string | null;
  verified_at?: string | null;
  rejected_at?: string | null;
  revoked_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
};

let mockUser: { user_id: string; user_type: string } = { user_id: 'user-1', user_type: 'internal' };
let mockCtx: { tenant: string } = { tenant: 'tenant-1' };
let hasPermissionValue = true;
let rows: Row[] = [];

function normalize(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

class QueryBuilder {
  private table: string;
  private selected: string[] = [];
  private whereClauses: Array<(row: Row) => boolean> = [];
  private whereNotClauses: Array<(row: Row) => boolean> = [];
  private whereInValues: string[] | null = null;
  private whereNotInValues: string[] | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(...columns: string[]): QueryBuilder {
    this.selected = columns;
    return this;
  }

  where(conditions: Record<string, unknown>): QueryBuilder {
    this.whereClauses.push((row) =>
      Object.entries(conditions).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)
    );
    return this;
  }

  whereNot(conditions: Record<string, unknown>): QueryBuilder {
    this.whereNotClauses.push((row) =>
      Object.entries(conditions).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)
    );
    return this;
  }

  whereIn(_column: unknown, values: string[]): QueryBuilder {
    this.whereInValues = values.map(normalize);
    return this;
  }

  whereNotIn(_column: unknown, values: string[]): QueryBuilder {
    this.whereNotInValues = values.map(normalize);
    return this;
  }

  orderByRaw(_raw: string): QueryBuilder {
    return this;
  }

  async update(values: Record<string, unknown>): Promise<number> {
    let updated = 0;
    for (const row of this.filterRows()) {
      Object.assign(row, values);
      updated += 1;
    }
    return updated;
  }

  async insert(payload: Record<string, unknown>): Promise<void> {
    rows.push(payload as Row);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const selectedRows = this.filterRows().map((row) => {
      if (!this.selected.length) return row;
      const projection: Record<string, unknown> = {};
      for (const key of this.selected) {
        projection[key] = (row as unknown as Record<string, unknown>)[key];
      }
      return projection;
    });
    selectedRows.sort((a, b) => String((a as Record<string, unknown>).domain ?? '').localeCompare(String((b as Record<string, unknown>).domain ?? '')));
    return Promise.resolve(selectedRows).then(onfulfilled, onrejected);
  }

  private filterRows(): Row[] {
    return rows.filter((row) => {
      if (this.table !== 'msp_sso_tenant_login_domains') return false;
      if (this.whereClauses.some((clause) => !clause(row))) return false;
      if (this.whereNotClauses.some((clause) => clause(row))) return false;
      if (this.whereInValues && !this.whereInValues.includes(normalize(row.domain))) return false;
      if (this.whereNotInValues && this.whereNotInValues.includes(normalize(row.domain))) return false;
      return true;
    });
  }
}

const knexMock: any = (table: string) => new QueryBuilder(table);
knexMock.raw = (value: string) => value;
knexMock.fn = { now: () => 'now()' };
knexMock.schema = {
  hasColumn: async (_table: string, _column: string) => true,
  hasTable: async (_table: string) => false,
};
knexMock.transaction = async (handler: (trx: any) => Promise<void>) => {
  const trx = (table: string) => new QueryBuilder(table);
  trx.raw = knexMock.raw;
  trx.fn = knexMock.fn;
  trx.schema = knexMock.schema;
  await handler(trx);
};

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth:
    (action: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) =>
      action(mockUser, mockCtx, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async () => hasPermissionValue),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexMock })),
}));

import {
  listMspSsoDomainClaims,
  listMspSsoLoginDomains,
  refreshMspSsoDomainClaimChallenge,
  requestMspSsoDomainClaim,
  revokeMspSsoDomainClaim,
  saveMspSsoLoginDomains,
  verifyMspSsoDomainClaimOwnership,
} from './mspSsoDomainActions';

describe('msp sso domain actions', () => {
  beforeEach(() => {
    mockUser = { user_id: 'user-1', user_type: 'internal' };
    mockCtx = { tenant: 'tenant-1' };
    hasPermissionValue = true;
    rows = [];
  });

  it('T004: list action denies unauthorized users and client users', async () => {
    mockUser = { user_id: 'client-1', user_type: 'client' };
    await expect(listMspSsoLoginDomains()).resolves.toEqual({ success: false, error: 'Forbidden' });

    mockUser = { user_id: 'user-1', user_type: 'internal' };
    hasPermissionValue = false;
    await expect(listMspSsoLoginDomains()).resolves.toEqual({ success: false, error: 'Forbidden' });
  });

  it('T004b: lifecycle actions deny unauthorized users and client users', async () => {
    mockUser = { user_id: 'client-1', user_type: 'client' };
    await expect(requestMspSsoDomainClaim({ domain: 'acme.com' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(refreshMspSsoDomainClaimChallenge({ claimId: 'claim-1' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(verifyMspSsoDomainClaimOwnership({ claimId: 'claim-1' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(revokeMspSsoDomainClaim({ claimId: 'claim-1' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });

    mockUser = { user_id: 'user-1', user_type: 'internal' };
    hasPermissionValue = false;
    await expect(requestMspSsoDomainClaim({ domain: 'acme.com' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(refreshMspSsoDomainClaimChallenge({ claimId: 'claim-1' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(verifyMspSsoDomainClaimOwnership({ claimId: 'claim-1' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
    await expect(revokeMspSsoDomainClaim({ claimId: 'claim-1' })).resolves.toEqual({
      success: false,
      error: 'Forbidden',
    });
  });

  it('T005: list action returns normalized, deduplicated tenant domains', async () => {
    rows.push(
      { tenant: 'tenant-1', id: '1', domain: 'Example.com', is_active: true, claim_status: 'verified' },
      { tenant: 'tenant-1', id: '2', domain: 'example.com', is_active: true, claim_status: 'pending' },
      { tenant: 'tenant-1', id: '3', domain: 'beta.io', is_active: false },
      { tenant: 'tenant-2', id: '4', domain: 'other.com', is_active: true }
    );

    await expect(listMspSsoLoginDomains()).resolves.toEqual({
      success: true,
      domains: ['example.com'],
    });
  });

  it('T005b: claims list returns lifecycle metadata and applies same permission guard', async () => {
    rows.push({
      tenant: 'tenant-1',
      id: '1',
      domain: 'Example.com',
      is_active: true,
      claim_status: 'verified',
      claim_status_updated_at: '2026-03-03T00:00:00.000Z',
      claimed_at: '2026-03-03T00:00:00.000Z',
      verified_at: '2026-03-03T00:00:00.000Z',
      rejected_at: null,
      revoked_at: null,
    });

    await expect(listMspSsoDomainClaims()).resolves.toEqual({
      success: true,
      claims: [
        {
          id: '1',
          domain: 'example.com',
          is_active: true,
          claim_status: 'verified',
          claim_status_updated_at: '2026-03-03T00:00:00.000Z',
          claimed_at: '2026-03-03T00:00:00.000Z',
          verified_at: '2026-03-03T00:00:00.000Z',
          rejected_at: null,
          revoked_at: null,
        },
      ],
    });

    mockUser = { user_id: 'client-1', user_type: 'client' };
    await expect(listMspSsoDomainClaims()).resolves.toEqual({ success: false, error: 'Forbidden' });
  });

  it('T006/T007: save action persists and normalizes valid domains', async () => {
    const result = await saveMspSsoLoginDomains({
      domains: ['  AcMe.com  ', '@Beta.io'],
    });

    expect(result).toEqual({
      success: true,
      domains: ['acme.com', 'beta.io'],
    });
    expect(rows.filter((row) => row.tenant === 'tenant-1' && row.is_active)).toHaveLength(2);
    expect(rows.some((row) => row.domain === 'acme.com')).toBe(true);
    expect(rows.some((row) => row.domain === 'beta.io')).toBe(true);
  });

  it('T008: save action rejects malformed domains with deterministic validation error', async () => {
    await expect(saveMspSsoLoginDomains({ domains: ['bad_domain'] })).resolves.toEqual({
      success: false,
      error: 'Invalid domain "bad_domain". Enter a valid domain like example.com.',
    });
  });

  it('T009: save action rejects duplicate domains in payload', async () => {
    await expect(saveMspSsoLoginDomains({ domains: ['acme.com', 'Acme.com'] })).resolves.toEqual({
      success: false,
      error: 'Duplicate domains are not allowed.',
    });
  });

  it('T010: save action rejects cross-tenant active domain conflicts', async () => {
    rows.push({ tenant: 'tenant-2', id: '1', domain: 'acme.com', is_active: true });

    await expect(saveMspSsoLoginDomains({ domains: ['acme.com'] })).resolves.toEqual({
      success: false,
      error: 'One or more domains are already in use.',
      conflicts: ['acme.com'],
    });
  });

  it('T011: save action deactivates removed domains and updates subsequent listing', async () => {
    rows.push(
      { tenant: 'tenant-1', id: '1', domain: 'acme.com', is_active: true },
      { tenant: 'tenant-1', id: '2', domain: 'beta.io', is_active: true }
    );

    await expect(saveMspSsoLoginDomains({ domains: ['acme.com'] })).resolves.toEqual({
      success: true,
      domains: ['acme.com'],
    });

    const beta = rows.find((row) => row.id === '2');
    expect(beta?.is_active).toBe(false);
    await expect(listMspSsoLoginDomains()).resolves.toEqual({
      success: true,
      domains: ['acme.com'],
    });
  });

  it('T012: request action validates malformed domains before db operations', async () => {
    await expect(requestMspSsoDomainClaim({ domain: 'bad_domain' })).resolves.toEqual({
      success: false,
      error: 'Invalid domain "bad_domain". Enter a valid domain like example.com.',
    });
  });

  it('T013/T014/T015: refresh/verify/revoke require claim id', async () => {
    await expect(refreshMspSsoDomainClaimChallenge({ claimId: '' })).resolves.toEqual({
      success: false,
      error: 'Claim id is required.',
    });
    await expect(verifyMspSsoDomainClaimOwnership({ claimId: '   ' })).resolves.toEqual({
      success: false,
      error: 'Claim id is required.',
    });
    await expect(revokeMspSsoDomainClaim({ claimId: '' })).resolves.toEqual({
      success: false,
      error: 'Claim id is required.',
    });
  });
});
