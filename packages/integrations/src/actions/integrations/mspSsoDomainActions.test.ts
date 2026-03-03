import { beforeEach, describe, expect, it, vi } from 'vitest';

type DomainRow = {
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
  created_at?: string | null;
  updated_at?: string | null;
};

type ChallengeRow = {
  tenant: string;
  id: string;
  claim_id: string;
  challenge_type: string;
  challenge_label: string;
  challenge_value: string;
  challenge_token_hash: string;
  is_active: boolean;
  expires_at?: string | null;
  verified_at?: string | null;
  invalidated_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
};

let mockUser: { user_id: string; user_type: string } = { user_id: 'user-1', user_type: 'internal' };
let mockCtx: { tenant: string } = { tenant: 'tenant-1' };
let hasPermissionValue = true;
let rows: DomainRow[] = [];
let challengeRows: ChallengeRow[] = [];
let hasChallengeTable = false;

const resolveTxtMock = vi.hoisted(() => vi.fn(async () => []));

function normalize(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
}

class QueryBuilder {
  private table: string;
  private selected: string[] = [];
  private whereClauses: Array<(row: Record<string, unknown>) => boolean> = [];
  private whereNotClauses: Array<(row: Record<string, unknown>) => boolean> = [];
  private whereInValues: string[] | null = null;
  private whereNotInValues: string[] | null = null;
  private whereInColumn: string | null = null;
  private whereNotInColumn: string | null = null;
  private whereRawDomain: string | null = null;
  private orderByColumn: string | null = null;
  private orderDirection: 'asc' | 'desc' = 'asc';

  constructor(table: string) {
    this.table = table;
  }

  select(...columns: string[]): QueryBuilder {
    this.selected = columns;
    return this;
  }

  where(conditions: Record<string, unknown>): QueryBuilder {
    this.whereClauses.push((row) =>
      Object.entries(conditions).every(([key, value]) => row[key] === value)
    );
    return this;
  }

  whereNot(conditions: Record<string, unknown>): QueryBuilder {
    this.whereNotClauses.push((row) =>
      Object.entries(conditions).every(([key, value]) => row[key] === value)
    );
    return this;
  }

  whereIn(column: unknown, values: string[]): QueryBuilder {
    this.whereInColumn = String(column ?? '');
    this.whereInValues = values.map((value) =>
      this.whereInColumn.includes('claim_status') ? String(value) : normalize(String(value))
    );
    return this;
  }

  whereNotIn(column: unknown, values: string[]): QueryBuilder {
    this.whereNotInColumn = String(column ?? '');
    this.whereNotInValues = values.map((value) =>
      this.whereNotInColumn.includes('claim_status') ? String(value) : normalize(String(value))
    );
    return this;
  }

  whereRaw(_sql: string, bindings: unknown[]): QueryBuilder {
    this.whereRawDomain = normalize(String(bindings[0] ?? ''));
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc'): QueryBuilder {
    this.orderByColumn = column;
    this.orderDirection = direction;
    return this;
  }

  orderByRaw(_raw: string): QueryBuilder {
    this.orderByColumn = 'domain';
    this.orderDirection = 'asc';
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
    if (this.table === 'msp_sso_tenant_login_domains') {
      rows.push(payload as DomainRow);
      return;
    }
    if (this.table === 'msp_sso_domain_verification_challenges') {
      challengeRows.push(payload as ChallengeRow);
    }
  }

  first(): Promise<Record<string, unknown> | undefined> {
    return this.then((result) => (result as Record<string, unknown>[])[0]);
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const selectedRows = this.filterRows().map((row) => {
      if (!this.selected.length) return row;
      const projection: Record<string, unknown> = {};
      for (const key of this.selected) {
        projection[key] = row[key];
      }
      return projection;
    });
    const sorted = selectedRows.sort((a, b) => {
      if (!this.orderByColumn && this.table !== 'msp_sso_tenant_login_domains') return 0;
      const column = this.orderByColumn ?? 'domain';
      const left = String((a as Record<string, unknown>)[column] ?? '');
      const right = String((b as Record<string, unknown>)[column] ?? '');
      const comparison = left.localeCompare(right);
      return this.orderDirection === 'desc' ? comparison * -1 : comparison;
    });
    return Promise.resolve(sorted).then(onfulfilled, onrejected);
  }

  private filterRows(): Array<Record<string, unknown>> {
    const source: Array<Record<string, unknown>> =
      this.table === 'msp_sso_tenant_login_domains'
        ? (rows as Array<Record<string, unknown>>)
        : this.table === 'msp_sso_domain_verification_challenges'
          ? (challengeRows as Array<Record<string, unknown>>)
          : [];

    return source.filter((row) => {
      if (this.whereClauses.some((clause) => !clause(row))) return false;
      if (this.whereNotClauses.some((clause) => clause(row))) return false;
      if (this.whereRawDomain && normalize(String(row.domain ?? '')) !== this.whereRawDomain) return false;
      if (this.whereInValues) {
        const column = this.whereInColumn?.includes('claim_status') ? 'claim_status' : 'domain';
        const rowValue = column === 'claim_status' ? String(row[column] ?? '') : normalize(String(row[column] ?? ''));
        if (!this.whereInValues.includes(rowValue)) return false;
      }
      if (this.whereNotInValues) {
        const column = this.whereNotInColumn?.includes('claim_status') ? 'claim_status' : 'domain';
        const rowValue = column === 'claim_status' ? String(row[column] ?? '') : normalize(String(row[column] ?? ''));
        if (this.whereNotInValues.includes(rowValue)) return false;
      }
      return true;
    });
  }
}

const knexMock: any = (table: string) => new QueryBuilder(table);
knexMock.raw = (value: string) => value;
knexMock.fn = { now: () => 'now()' };
knexMock.schema = {
  hasColumn: async (_table: string, _column: string) => true,
  hasTable: async (table: string) => {
    if (table === 'msp_sso_tenant_login_domains') return true;
    if (table === 'msp_sso_domain_verification_challenges') return hasChallengeTable;
    return false;
  },
};
knexMock.transaction = async (handler: (trx: any) => Promise<unknown>) => {
  const trx = (table: string) => new QueryBuilder(table);
  trx.raw = knexMock.raw;
  trx.fn = knexMock.fn;
  trx.schema = knexMock.schema;
  return handler(trx);
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

vi.mock('node:dns/promises', () => ({
  resolveTxt: (...args: unknown[]) => resolveTxtMock(...args),
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
    challengeRows = [];
    hasChallengeTable = true;
    resolveTxtMock.mockReset();
    resolveTxtMock.mockResolvedValue([]);
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
          active_challenge_label: null,
          active_challenge_value: null,
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

  it('T010: request action creates pending claim and active dns challenge', async () => {
    const result = await requestMspSsoDomainClaim({ domain: 'Acme.com' });

    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(result.claim).toMatchObject({
      domain: 'acme.com',
      claim_status: 'pending',
      is_active: true,
    });
    expect(result.challenge).toMatchObject({
      claim_id: result.claim?.id,
      challenge_type: 'dns_txt',
      challenge_label: '_alga-msp-sso.acme.com',
      is_active: true,
    });
    expect(challengeRows).toHaveLength(1);
  });

  it('T011: request action is idempotent for existing pending claim with active challenge', async () => {
    rows.push({
      tenant: 'tenant-1',
      id: 'claim-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'pending',
      claim_status_updated_at: '2026-03-03T00:00:00.000Z',
      claimed_at: '2026-03-03T00:00:00.000Z',
    });
    challengeRows.push({
      tenant: 'tenant-1',
      id: 'challenge-1',
      claim_id: 'claim-1',
      challenge_type: 'dns_txt',
      challenge_label: '_alga-msp-sso.acme.com',
      challenge_value: 'alga-sso-verification=existing-token',
      challenge_token_hash: 'hash',
      is_active: true,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T00:00:00.000Z',
    });

    const result = await requestMspSsoDomainClaim({ domain: 'acme.com' });
    expect(result.success).toBe(true);
    expect(result.idempotent).toBe(true);
    expect(result.claim?.id).toBe('claim-1');
    expect(result.challenge?.id).toBe('challenge-1');
    expect(challengeRows).toHaveLength(1);
  });

  it('T012: refresh action rotates challenge material and invalidates prior challenge', async () => {
    rows.push({
      tenant: 'tenant-1',
      id: 'claim-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'pending',
      claim_status_updated_at: '2026-03-03T00:00:00.000Z',
      claimed_at: '2026-03-03T00:00:00.000Z',
    });
    challengeRows.push({
      tenant: 'tenant-1',
      id: 'challenge-1',
      claim_id: 'claim-1',
      challenge_type: 'dns_txt',
      challenge_label: '_alga-msp-sso.acme.com',
      challenge_value: 'alga-sso-verification=old-token',
      challenge_token_hash: 'old-hash',
      is_active: true,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T00:00:00.000Z',
    });

    const result = await refreshMspSsoDomainClaimChallenge({ claimId: 'claim-1' });
    expect(result.success).toBe(true);
    expect(result.challenge?.challenge_value).not.toBe('alga-sso-verification=old-token');
    expect(challengeRows.find((row) => row.id === 'challenge-1')?.is_active).toBe(false);
    expect(challengeRows.filter((row) => row.claim_id === 'claim-1' && row.is_active)).toHaveLength(1);
  });

  it('T013/T016: verify action promotes claim when dns challenge matches and blocks verified conflicts', async () => {
    rows.push(
      {
        tenant: 'tenant-1',
        id: 'claim-1',
        domain: 'acme.com',
        is_active: true,
        claim_status: 'pending',
        claim_status_updated_at: '2026-03-03T00:00:00.000Z',
        claimed_at: '2026-03-03T00:00:00.000Z',
      },
      {
        tenant: 'tenant-2',
        id: 'claim-2',
        domain: 'shared.com',
        is_active: true,
        claim_status: 'verified',
        claim_status_updated_at: '2026-03-03T00:00:00.000Z',
        verified_at: '2026-03-03T00:00:00.000Z',
      },
      {
        tenant: 'tenant-1',
        id: 'claim-3',
        domain: 'shared.com',
        is_active: true,
        claim_status: 'pending',
        claim_status_updated_at: '2026-03-03T00:00:00.000Z',
        claimed_at: '2026-03-03T00:00:00.000Z',
      }
    );
    challengeRows.push(
      {
        tenant: 'tenant-1',
        id: 'challenge-1',
        claim_id: 'claim-1',
        challenge_type: 'dns_txt',
        challenge_label: '_alga-msp-sso.acme.com',
        challenge_value: 'alga-sso-verification=match-token',
        challenge_token_hash: 'hash',
        is_active: true,
        created_at: '2026-03-03T00:00:00.000Z',
        updated_at: '2026-03-03T00:00:00.000Z',
      },
      {
        tenant: 'tenant-1',
        id: 'challenge-3',
        claim_id: 'claim-3',
        challenge_type: 'dns_txt',
        challenge_label: '_alga-msp-sso.shared.com',
        challenge_value: 'alga-sso-verification=conflict-token',
        challenge_token_hash: 'hash',
        is_active: true,
        created_at: '2026-03-03T00:00:00.000Z',
        updated_at: '2026-03-03T00:00:00.000Z',
      }
    );

    resolveTxtMock.mockResolvedValueOnce([['alga-sso-verification=match-token']]);
    const verifyResult = await verifyMspSsoDomainClaimOwnership({ claimId: 'claim-1' });
    expect(verifyResult.success).toBe(true);
    expect(verifyResult.claim?.claim_status).toBe('verified');
    expect(challengeRows.find((row) => row.id === 'challenge-1')?.is_active).toBe(false);

    resolveTxtMock.mockResolvedValueOnce([['alga-sso-verification=conflict-token']]);
    const conflictResult = await verifyMspSsoDomainClaimOwnership({ claimId: 'claim-3' });
    expect(conflictResult.success).toBe(false);
    expect(conflictResult.error).toContain('another tenant already has an active verified claim');
    expect(rows.find((row) => row.id === 'claim-3')?.claim_status).toBe('pending');
  });

  it('T014/T015: verify mismatch returns neutral error and revoke transitions claim to revoked', async () => {
    rows.push({
      tenant: 'tenant-1',
      id: 'claim-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'verified',
      claim_status_updated_at: '2026-03-03T00:00:00.000Z',
      verified_at: '2026-03-03T00:00:00.000Z',
    });
    challengeRows.push({
      tenant: 'tenant-1',
      id: 'challenge-1',
      claim_id: 'claim-1',
      challenge_type: 'dns_txt',
      challenge_label: '_alga-msp-sso.acme.com',
      challenge_value: 'alga-sso-verification=expected-token',
      challenge_token_hash: 'hash',
      is_active: true,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T00:00:00.000Z',
    });

    rows.push({
      tenant: 'tenant-1',
      id: 'claim-2',
      domain: 'beta.com',
      is_active: true,
      claim_status: 'pending',
      claim_status_updated_at: '2026-03-03T00:00:00.000Z',
      claimed_at: '2026-03-03T00:00:00.000Z',
    });
    challengeRows.push({
      tenant: 'tenant-1',
      id: 'challenge-2',
      claim_id: 'claim-2',
      challenge_type: 'dns_txt',
      challenge_label: '_alga-msp-sso.beta.com',
      challenge_value: 'alga-sso-verification=expected-beta',
      challenge_token_hash: 'hash',
      is_active: true,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T00:00:00.000Z',
    });

    resolveTxtMock.mockResolvedValueOnce([['not-a-match']]);
    const mismatch = await verifyMspSsoDomainClaimOwnership({ claimId: 'claim-2' });
    expect(mismatch.success).toBe(false);
    expect(mismatch.error).toContain('Unable to verify domain ownership');
    expect(rows.find((row) => row.id === 'claim-2')?.claim_status).toBe('pending');

    const revokeResult = await revokeMspSsoDomainClaim({ claimId: 'claim-1' });
    expect(revokeResult.success).toBe(true);
    expect(revokeResult.claim?.claim_status).toBe('revoked');
    expect(challengeRows.find((row) => row.id === 'challenge-1')?.is_active).toBe(false);
  });
});
