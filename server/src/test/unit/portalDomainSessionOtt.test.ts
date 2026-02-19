import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'crypto';

import {
  issuePortalDomainOtt,
  consumePortalDomainOtt,
  pruneExpiredPortalDomainOtts,
  __setPortalDomainOttConnectionFactoryForTests,
  __resetPortalDomainOttTestState,
  type PortalDomainSessionOtt,
} from '@alga-psa/auth';
import type { PortalDomainRecord } from 'server/src/models/PortalDomainModel';
import type { PortalSessionTokenPayload } from '@alga-psa/auth';
import { analytics } from 'server/src/lib/analytics/posthog';

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn().mockResolvedValue(undefined),
  },
}));

type PortalDomainSessionOttRow = {
  id: string;
  tenant: string;
  portal_domain_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
};

type FakeDbState = {
  portal_domains: PortalDomainRecord[];
  portal_domain_session_otts: PortalDomainSessionOttRow[];
};

class FakeQueryBuilder<T extends Record<string, any>> {
  private filters: Array<(row: T) => boolean> = [];

  constructor(private readonly table: keyof FakeDbState, private readonly state: FakeDbState) {}

  private rows(): T[] {
    const data = this.state[this.table] as T[];
    if (this.filters.length === 0) {
      return data;
    }
    return data.filter((row) => this.filters.every((predicate) => predicate(row)));
  }

  clone(): FakeQueryBuilder<T> {
    const cloned = new FakeQueryBuilder<T>(this.table, this.state);
    cloned.filters = [...this.filters];
    return cloned;
  }

  where(column: Record<string, any>): this;
  where(column: string, operator: string, value: any): this;
  where(column: any, operator?: any, value?: any): this {
    if (typeof column === 'object' && column !== null) {
      const criteria = column as Record<string, unknown>;
      this.filters.push((row) => Object.entries(criteria).every(([key, expected]) => (row as any)[key] === expected));
      return this;
    }

    const colName = column as string;
    const op = operator as string;
    const val = value;

    if (op === '<') {
      this.filters.push((row) => (row as any)[colName] < val);
    } else if (op === '>') {
      this.filters.push((row) => (row as any)[colName] > val);
    } else {
      this.filters.push((row) => (row as any)[colName] === val);
    }

    return this;
  }

  andWhere(column: Record<string, any>): this;
  andWhere(column: string, value: any): this;
  andWhere(column: string, operator: string, value: any): this;
  andWhere(column: any, operatorOrValue?: any, maybeValue?: any): this {
    if (typeof column === 'object') {
      return this.where(column);
    }
    if (maybeValue !== undefined) {
      return this.where(column as string, operatorOrValue, maybeValue);
    }
    return this.where(column as string, '=', operatorOrValue);
  }

  whereNotNull(column: string): this {
    this.filters.push((row) => (row as any)[column] !== null && (row as any)[column] !== undefined);
    return this;
  }

  whereIn(column: string, values: readonly unknown[]): this {
    const set = new Set(values);
    this.filters.push((row) => set.has((row as any)[column]));
    return this;
  }

  pluck<K extends keyof T>(column: K): Array<T[K]> {
    return this.rows().map((row) => row[column]);
  }

  first(): T | undefined {
    return this.rows()[0];
  }

  insert(data: Partial<T> | Array<Partial<T>>) {
    const items = Array.isArray(data) ? data : [data];
    const inserted = items.map((item) => {
      const row = {
        ...item,
      } as T;
      (row as any).id = (row as any).id ?? randomUUID();
      const now = new Date();
      (row as any).created_at = (row as any).created_at ?? now;
      (row as any).updated_at = (row as any).updated_at ?? now;
      this.state[this.table].push(row as any);
      return row;
    });

    return {
      returning: () => inserted,
    };
  }

  update(patch: Partial<T>) {
    const targetRows = this.rows();
    targetRows.forEach((row) => {
      Object.assign(row as any, patch);
    });

    return {
      returning: () => targetRows,
    };
  }

  del(): number {
    const toDelete = new Set(this.rows());
    const tableData = this.state[this.table] as T[];
    const initialLength = tableData.length;
    this.state[this.table] = tableData.filter((row) => !toDelete.has(row as any)) as any;
    return initialLength - (this.state[this.table] as any[]).length;
  }
}

type FakeKnex = ((table: keyof FakeDbState) => FakeQueryBuilder<any>) & {
  transaction: <T>(callback: (trx: FakeKnex) => Promise<T>) => Promise<T>;
  fn: { now: () => Date };
};

function createFakeKnex(state: FakeDbState): FakeKnex {
  const factory = ((table: keyof FakeDbState) => new FakeQueryBuilder(table, state)) as FakeKnex;
  factory.transaction = async (callback) => callback(createFakeKnex(state));
  factory.fn = {
    now: () => new Date(),
  };
  return factory;
}

describe('PortalDomainSessionToken helpers', () => {
  const captureMock = vi.mocked(analytics.capture);
  let state: FakeDbState;

  const activeDomain: PortalDomainRecord = {
    id: 'domain-1',
    tenant: 'tenant-1',
    domain: 'portal.example.com',
    canonical_host: 't1.portal.algapsa.com',
    status: 'active',
    status_message: null,
    last_checked_at: new Date(),
    verification_method: 'cname',
    verification_details: {},
    certificate_secret_name: null,
    last_synced_resource_version: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const snapshot: PortalSessionTokenPayload = {
    id: 'user-1',
    email: 'user@example.com',
    tenant: 'tenant-1',
    user_type: 'client',
    clientId: 'client-1',
  };

  beforeEach(() => {
    state = {
      portal_domains: [{ ...activeDomain }],
      portal_domain_session_otts: [],
    };

    __setPortalDomainOttConnectionFactoryForTests(async () => createFakeKnex(state) as unknown as any);
    captureMock.mockClear();
  });

  afterEach(() => {
    __resetPortalDomainOttTestState();
    vi.clearAllMocks();
  });

  it('issues a one-time token for an active domain', async () => {
    const { token, record } = await issuePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      userId: 'user-1',
      targetDomain: 'portal.example.com',
      userSnapshot: snapshot,
      issuedFromHost: 'login.algapsa.com',
      returnPath: '/client-portal/dashboard',
    });

    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(40);
    expect(record.metadata.targetDomain).toBe('portal.example.com');
    expect(state.portal_domain_session_otts).toHaveLength(1);
    expect(captureMock).toHaveBeenCalledWith(
      'portal_domain.ott_issued',
      expect.objectContaining({ tenant: 'tenant-1', portal_domain_id: 'domain-1' }),
      'user-1',
    );
  });

  it('rejects issuance if domain is inactive', async () => {
    state.portal_domains[0].status = 'disabled';

    await expect(
      issuePortalDomainOtt({
        tenant: 'tenant-1',
        portalDomainId: 'domain-1',
        userId: 'user-1',
        targetDomain: 'portal.example.com',
        userSnapshot: snapshot,
        issuedFromHost: 'login.algapsa.com',
      }),
    ).rejects.toThrow('Portal domain is not active.');
  });

  it('consumes a valid token exactly once', async () => {
    const { token } = await issuePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      userId: 'user-1',
      targetDomain: 'portal.example.com',
      userSnapshot: snapshot,
      issuedFromHost: 'login.algapsa.com',
    });

    const consumed = await consumePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      token,
    });

    expect(consumed).not.toBeNull();
    expect((consumed as PortalDomainSessionOtt).consumedAt).toBeInstanceOf(Date);
    expect(captureMock).toHaveBeenCalledWith(
      'portal_domain.ott_consumed',
      expect.objectContaining({ tenant: 'tenant-1', portal_domain_id: 'domain-1' }),
      'user-1',
    );

    const secondAttempt = await consumePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      token,
    });

    expect(secondAttempt).toBeNull();
    expect(captureMock).toHaveBeenCalledWith(
      'portal_domain.ott_failed',
      expect.objectContaining({ reason: 'already_consumed' }),
      'user-1',
    );
  });

  it('fails consumption for expired tokens', async () => {
    const { token } = await issuePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      userId: 'user-1',
      targetDomain: 'portal.example.com',
      userSnapshot: snapshot,
      issuedFromHost: 'login.algapsa.com',
    });

    const row = state.portal_domain_session_otts[0];
    row.expires_at = new Date(Date.now() - 1000);

    const result = await consumePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      token,
    });

    expect(result).toBeNull();
    expect(captureMock).toHaveBeenCalledWith(
      'portal_domain.ott_failed',
      expect.objectContaining({ reason: 'expired' }),
      'user-1',
    );
  });

  it('prunes expired and consumed tokens', async () => {
    // Expired token
    await issuePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      userId: 'user-1',
      targetDomain: 'portal.example.com',
      userSnapshot: snapshot,
      issuedFromHost: 'login.algapsa.com',
    });
    state.portal_domain_session_otts[0].expires_at = new Date(Date.now() - 1000);

    // Consumed token
    await issuePortalDomainOtt({
      tenant: 'tenant-1',
      portalDomainId: 'domain-1',
      userId: 'user-2',
      targetDomain: 'portal.example.com',
      userSnapshot: { ...snapshot, id: 'user-2', email: 'u2@example.com' },
      issuedFromHost: 'login.algapsa.com',
    });
    state.portal_domain_session_otts[1].consumed_at = new Date(Date.now() - 1000);

    const deleted = await pruneExpiredPortalDomainOtts({ tenant: 'tenant-1', before: new Date() });

    expect(deleted).toBe(2);
    expect(state.portal_domain_session_otts).toHaveLength(0);
  });
});
