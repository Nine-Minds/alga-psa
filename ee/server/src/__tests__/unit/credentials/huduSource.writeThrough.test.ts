/**
 * Hudu write-through credentials source (CredentialSource abstraction) against
 * a mocked HuduClient: create/update/delete round-trips, cache invalidation on
 * write, and error mapping (no_password_access, not_found, validation 422).
 * Value-bearing fields are only ever sent to the mocked client and never
 * surface in list summaries or audit details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createHuduClientMock,
  resolveHuduCompanyIdForClientMock,
  resolveClientIdForHuduCompanyMock,
  clearCachedHuduListMock,
  writeHuduPasswordRevealAuditMock,
  writeCredentialAuditMock,
  toHuduAssetPasswordSummaryMock,
  createCredentialAuthorizationContextMock,
  authorizeCredentialRecordMock,
  HuduRequestErrorStub,
} = vi.hoisted(() => {
  class HuduRequestErrorStub extends Error {
    readonly hudu: { kind: string; status?: number; message: string };
    constructor(kind: string, status?: number) {
      super(kind);
      this.hudu = { kind, status, message: kind };
    }
  }
  return {
    createHuduClientMock: vi.fn(),
    resolveHuduCompanyIdForClientMock: vi.fn(),
    resolveClientIdForHuduCompanyMock: vi.fn(),
    clearCachedHuduListMock: vi.fn(),
    writeHuduPasswordRevealAuditMock: vi.fn(async () => undefined),
    writeCredentialAuditMock: vi.fn(async () => undefined),
    toHuduAssetPasswordSummaryMock: vi.fn((record: Record<string, unknown>) => ({
      id: record.id,
      company_id: record.company_id,
      name: record.name,
      username: record.username ?? null,
      url: record.url ?? null,
      description: record.description ?? null,
      password_folder_name: record.password_folder_name ?? null,
      created_at: record.created_at ?? null,
      updated_at: record.updated_at ?? null,
    })),
    createCredentialAuthorizationContextMock: vi.fn(async () => ({ bundleNarrowingRules: [], requestCache: {} })),
    authorizeCredentialRecordMock: vi.fn(async () => true),
    HuduRequestErrorStub,
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => Promise<unknown>) => {
    return callback({ raw: async () => undefined });
  }),
}));

vi.mock('@ee/lib/integrations/hudu/huduClient', () => ({
  createHuduClient: createHuduClientMock,
  HuduRequestError: HuduRequestErrorStub,
}));

vi.mock('@ee/lib/integrations/hudu/companyMapping', () => ({
  resolveHuduCompanyIdForClient: resolveHuduCompanyIdForClientMock,
  resolveClientIdForHuduCompany: resolveClientIdForHuduCompanyMock,
}));

vi.mock('@ee/lib/integrations/hudu/referenceData', () => ({
  toHuduAssetPasswordSummary: toHuduAssetPasswordSummaryMock,
  clearCachedHuduList: clearCachedHuduListMock,
  buildHuduRecordUrl: (record: { url?: string | null } | null, baseUrl?: string | null) => {
    if (!record?.url) return null;
    return record.url.startsWith('http') ? record.url : `${baseUrl ?? ''}${record.url}`;
  },
}));

vi.mock('@ee/lib/integrations/hudu/revealAudit', () => ({
  writeHuduPasswordRevealAudit: writeHuduPasswordRevealAuditMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduDataCore', () => ({
  fetchCompanyList: vi.fn(async (_tenant: string, _clientId: string, _resource: string) => {
    return { state: 'unmapped' as const, items: [], count: 0 };
  }),
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  resolveCompanyUrl: vi.fn(async () => ({ baseUrl: 'https://hudu.example', companyUrl: 'https://hudu.example/companies/101' })),
}));

vi.mock('@ee/lib/credentials/audit', () => ({
  writeCredentialAudit: writeCredentialAuditMock,
}));

vi.mock('@ee/lib/credentials/credentialAuthorization', () => ({
  createCredentialAuthorizationContext: createCredentialAuthorizationContextMock,
  authorizeCredentialRecord: authorizeCredentialRecordMock,
}));

import { huduCredentialSource } from '@ee/lib/credentials/huduSource';
import type { CredentialSourceContext } from '@ee/lib/credentials/contracts';

const TENANT = 'tenant-a';
const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const COMPANY_ID = '101';

const ctx: CredentialSourceContext = {
  tenant: TENANT,
  userId: 'user-1',
  user: {
    user_id: 'user-1',
    username: 'tech',
    email: 'tech@example.com',
    is_inactive: false,
    tenant: TENANT,
    user_type: 'internal',
    roles: [],
  },
};

function huduRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    company_id: Number(COMPANY_ID),
    name: 'Domain Admin',
    username: 'admin@example.com',
    password: 'S3cr3t-Hudu-Value',
    otp_secret: null,
    url: '/passwords/42',
    description: 'Notes',
    password_folder_name: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveHuduCompanyIdForClientMock.mockResolvedValue(COMPANY_ID);
  resolveClientIdForHuduCompanyMock.mockResolvedValue(CLIENT_ID);
  createCredentialAuthorizationContextMock.mockResolvedValue({ bundleNarrowingRules: [], requestCache: {} });
  authorizeCredentialRecordMock.mockResolvedValue(true);
});

describe('huduCredentialSource — create', () => {
  it('sends a value-bearing payload to the Hudu API and returns a value-stripped summary', async () => {
    const clientMock = { createAssetPassword: vi.fn(async () => huduRecord()) };
    createHuduClientMock.mockResolvedValue(clientMock);

    const summary = await huduCredentialSource.create(ctx, {
      clientId: CLIENT_ID,
      name: 'Domain Admin',
      username: 'admin@example.com',
      password: 'S3cr3t-Hudu-Value',
      url: 'https://portal.example.com',
      description: 'Notes',
    });

    expect(clientMock.createAssetPassword).toHaveBeenCalledTimes(1);
    const payload = clientMock.createAssetPassword.mock.calls[0][0];
    expect(payload).toMatchObject({
      company_id: Number(COMPANY_ID),
      name: 'Domain Admin',
      username: 'admin@example.com',
      password: 'S3cr3t-Hudu-Value',
      url: 'https://portal.example.com',
    });

    // The summary is value-stripped: no password in the returned projection.
    expect(summary).toMatchObject({
      id: 'hudu:101:42',
      source: 'hudu',
      clientId: CLIENT_ID,
      name: 'Domain Admin',
      username: 'admin@example.com',
      isRestricted: false,
    });
    expect(JSON.stringify(summary)).not.toContain('S3cr3t-Hudu-Value');

    // Write invalidates the cached list for that company.
    expect(clearCachedHuduListMock).toHaveBeenCalledWith(TENANT, COMPANY_ID, 'asset_passwords');
    // Create audits (no value in details).
    expect(writeCredentialAuditMock).toHaveBeenCalled();
    const auditArgs = writeCredentialAuditMock.mock.calls[0][3];
    expect(JSON.stringify(auditArgs)).not.toContain('S3cr3t-Hudu-Value');
  });

  it('throws a clear error when the client is not mapped to a Hudu company', async () => {
    resolveHuduCompanyIdForClientMock.mockResolvedValue(null);

    await expect(
      huduCredentialSource.create(ctx, { clientId: CLIENT_ID, name: 'X' })
    ).rejects.toThrow(/not mapped/);
    expect(createHuduClientMock).not.toHaveBeenCalled();
  });
});

describe('huduCredentialSource — update', () => {
  it('sends a partial payload to the Hudu API and invalidates the cache', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord()),
      updateAssetPassword: vi.fn(async () => huduRecord({ name: 'Renamed' })),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const summary = await huduCredentialSource.update(ctx, 'hudu:101:42', {
      clientId: CLIENT_ID,
      name: 'Renamed',
      password: 'new-password',
    });

    // The numeric password id is verified against the claimed company first.
    expect(clientMock.getAssetPassword).toHaveBeenCalledWith(42);
    expect(clientMock.updateAssetPassword).toHaveBeenCalledTimes(1);
    const [id, payload] = clientMock.updateAssetPassword.mock.calls[0];
    expect(id).toBe(42);
    expect(payload).toMatchObject({ name: 'Renamed', password: 'new-password' });
    expect(summary.name).toBe('Renamed');
    expect(JSON.stringify(summary)).not.toContain('new-password');
    expect(clearCachedHuduListMock).toHaveBeenCalledWith(TENANT, COMPANY_ID, 'asset_passwords');

    // The update audit carries the changed FIELD NAMES only — never values.
    const updateCall = writeCredentialAuditMock.mock.calls.find((call) => call[2] === 'credential_updated');
    expect(updateCall).toBeDefined();
    const updateDetails = updateCall?.[4] as Record<string, unknown>;
    expect(updateDetails?.changed_fields).toEqual(['name', 'password']);
    expect(JSON.stringify(updateDetails)).not.toContain('new-password');
    expect(JSON.stringify(updateDetails)).not.toContain('S3cr3t-Hudu-Value');
  });

  it('rejects an update when the caller claims a clientId that is not the row owner', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord()),
      updateAssetPassword: vi.fn(async () => huduRecord()),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    await expect(
      huduCredentialSource.update(ctx, 'hudu:101:42', { clientId: 'other-client' })
    ).rejects.toMatchObject({ code: 'HUDU_UNMAPPED' });
    expect(clientMock.updateAssetPassword).not.toHaveBeenCalled();
  });

  it('rejects an update when the numeric password id belongs to a different company', async () => {
    // The client is mapped to company 101, but the password record at id 42
    // lives under company 999 — the claimed row does not exist in the claimed
    // company, so the update must fail before any PUT.
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord({ company_id: 999 })),
      updateAssetPassword: vi.fn(async () => huduRecord()),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    await expect(
      huduCredentialSource.update(ctx, 'hudu:101:42', { clientId: CLIENT_ID })
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    expect(clientMock.updateAssetPassword).not.toHaveBeenCalled();
  });

  it('rejects an update when the id company has no client mapping (unknown row)', async () => {
    resolveClientIdForHuduCompanyMock.mockResolvedValue(null);

    await expect(
      huduCredentialSource.update(ctx, 'hudu:101:42', { clientId: CLIENT_ID })
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    expect(createHuduClientMock).not.toHaveBeenCalled();
  });
});

describe('huduCredentialSource — remove', () => {
  it('verifies company ownership then deletes through the Hudu API and invalidates the cache', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord()),
      deleteAssetPassword: vi.fn(async () => undefined),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    await huduCredentialSource.remove(ctx, 'hudu:101:42');

    // Ownership confirmation before DELETE.
    expect(clientMock.getAssetPassword).toHaveBeenCalledWith(42);
    expect(clientMock.deleteAssetPassword).toHaveBeenCalledWith(42);
    expect(clearCachedHuduListMock).toHaveBeenCalledWith(TENANT, COMPANY_ID, 'asset_passwords');
    expect(writeCredentialAuditMock).toHaveBeenCalled();
  });

  it('rejects a CROSS-company delete: numeric id belongs to a different company', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord({ company_id: 999 })),
      deleteAssetPassword: vi.fn(async () => undefined),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    await expect(huduCredentialSource.remove(ctx, 'hudu:101:42')).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
    // The delete MUST NOT reach the Hudu API for the wrong company's record.
    expect(clientMock.deleteAssetPassword).not.toHaveBeenCalled();
    expect(writeCredentialAuditMock).not.toHaveBeenCalled();
  });

  it('rejects a delete for a company with no client mapping', async () => {
    resolveClientIdForHuduCompanyMock.mockResolvedValue(null);

    await expect(huduCredentialSource.remove(ctx, 'hudu:101:42')).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
    expect(createHuduClientMock).not.toHaveBeenCalled();
  });
});

describe('huduCredentialSource — bundle-scoped reveal (confused-deputy guard)', () => {
  it('denies reveal even with a direct id when the bundle scope excludes the owning client', async () => {
    // The mapping resolves to the client, but the authorization kernel denies
    // the record (e.g. a `selected_clients` bundle that excludes it).
    authorizeCredentialRecordMock.mockResolvedValue(false);

    const result = await huduCredentialSource.reveal(ctx, 'hudu:101:42');

    expect(result.state).toBe('not_found');
    expect(result.password).toBeUndefined();
    // No Hudu traffic and no audit for an out-of-scope reveal.
    expect(createHuduClientMock).not.toHaveBeenCalled();
    expect(writeHuduPasswordRevealAuditMock).not.toHaveBeenCalled();
  });

  it('denies OTP-seed reveal the same way when bundle scope excludes the client', async () => {
    authorizeCredentialRecordMock.mockResolvedValue(false);

    const result = await huduCredentialSource.revealOtpSeed(ctx, 'hudu:101:42');

    expect(result.state).toBe('not_found');
    expect(result.password).toBeUndefined();
    expect(createHuduClientMock).not.toHaveBeenCalled();
    expect(writeCredentialAuditMock).not.toHaveBeenCalled();
  });

  it('denies remove when the bundle scope excludes the owning client', async () => {
    authorizeCredentialRecordMock.mockResolvedValue(false);

    await expect(huduCredentialSource.remove(ctx, 'hudu:101:42')).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
    expect(createHuduClientMock).not.toHaveBeenCalled();
  });

  it('still reveals when the bundle scope allows the owning client', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord({ password: 'in-scope-value' })),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const result = await huduCredentialSource.reveal(ctx, 'hudu:101:42');

    expect(result.state).toBe('ok');
    expect(result.password).toBe('in-scope-value');
    expect(authorizeCredentialRecordMock).toHaveBeenCalledTimes(1);
    expect(writeHuduPasswordRevealAuditMock).toHaveBeenCalledTimes(1);
  });
});

describe('huduCredentialSource — reveal error mapping', () => {
  it('maps no_password_access to state no_access', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => {
        throw new HuduRequestErrorStub('no_password_access', 403);
      }),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const result = await huduCredentialSource.reveal(ctx, 'hudu:101:42');
    expect(result.state).toBe('no_access');
    expect(result.password).toBeUndefined();
    expect(writeHuduPasswordRevealAuditMock).not.toHaveBeenCalled();
  });

  it('maps not_found to state not_found', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => {
        throw new HuduRequestErrorStub('not_found', 404);
      }),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const result = await huduCredentialSource.reveal(ctx, 'hudu:101:42');
    expect(result.state).toBe('not_found');
  });

  it('reveals a value with a fail-closed audit and a TOTP code from the seed', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () =>
        huduRecord({ password: 'plain-value', otp_secret: 'JBSWY3DPEHPK3PXP' })
      ),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const result = await huduCredentialSource.reveal(ctx, 'hudu:101:42');

    expect(result.state).toBe('ok');
    expect(result.password).toBe('plain-value');
    expect(result.otpCode?.code).toMatch(/^\d{6}$/);
    expect(writeHuduPasswordRevealAuditMock).toHaveBeenCalledTimes(1);
    const auditArgs = writeHuduPasswordRevealAuditMock.mock.calls[0][2];
    expect(JSON.stringify(auditArgs)).not.toContain('plain-value');
    expect(JSON.stringify(auditArgs)).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('returns state error with the error kind for unexpected failures', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => {
        throw new HuduRequestErrorStub('server_error', 503);
      }),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const result = await huduCredentialSource.reveal(ctx, 'hudu:101:42');
    expect(result.state).toBe('error');
    expect(result.errorKind).toBe('server_error');
    expect(result.password).toBeUndefined();
  });

  it('never returns a value when the mapped client lookup fails (not_found)', async () => {
    resolveClientIdForHuduCompanyMock.mockResolvedValue(null);
    createHuduClientMock.mockResolvedValue({ getAssetPassword: vi.fn() });

    const result = await huduCredentialSource.reveal(ctx, 'hudu:101:42');
    expect(result.state).toBe('not_found');
  });
});

describe('huduCredentialSource — resolveByIds (association-driven entity lists)', () => {
  it('resolves refs LIVE against Hudu under bundle scope and returns summaries', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord()),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const results = await huduCredentialSource.resolveByIds(ctx, ['hudu:101:42']);

    expect(results).toHaveLength(1);
    expect(results[0].prune).toBe(false);
    expect(results[0].summary).toMatchObject({
      id: 'hudu:101:42',
      source: 'hudu',
      clientId: CLIENT_ID,
      name: 'Domain Admin',
    });
    // Live per-ref fetch — never served from the cached list.
    expect(clientMock.getAssetPassword).toHaveBeenCalledWith(42);
  });

  it('returns prune=true for a ref Hudu CONFIRMED gone (404 not_found)', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => {
        throw new HuduRequestErrorStub('not_found', 404);
      }),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const results = await huduCredentialSource.resolveByIds(ctx, ['hudu:101:42']);

    expect(results[0]).toEqual({ ref: 'hudu:101:42', summary: null, prune: true });
  });

  it('returns prune=false (never prunes) on transport/API errors', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => {
        throw new HuduRequestErrorStub('server_error', 503);
      }),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const results = await huduCredentialSource.resolveByIds(ctx, ['hudu:101:42']);

    expect(results[0]).toEqual({ ref: 'hudu:101:42', summary: null, prune: false });
  });

  it('returns prune=false for no_password_access (a permission error is not a deletion)', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => {
        throw new HuduRequestErrorStub('no_password_access', 403);
      }),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const results = await huduCredentialSource.resolveByIds(ctx, ['hudu:101:42']);

    expect(results[0]).toEqual({ ref: 'hudu:101:42', summary: null, prune: false });
  });

  it('omits (never prunes) a ref whose owning client is outside the bundle scope', async () => {
    authorizeCredentialRecordMock.mockResolvedValue(false);
    const clientMock = { getAssetPassword: vi.fn() };
    createHuduClientMock.mockResolvedValue(clientMock);

    const results = await huduCredentialSource.resolveByIds(ctx, ['hudu:101:42']);

    expect(results[0]).toEqual({ ref: 'hudu:101:42', summary: null, prune: false });
    expect(clientMock.getAssetPassword).not.toHaveBeenCalled();
  });

  it('omits (never prunes) a ref whose company is unmapped', async () => {
    resolveClientIdForHuduCompanyMock.mockResolvedValue(null);
    const clientMock = { getAssetPassword: vi.fn() };
    createHuduClientMock.mockResolvedValue(clientMock);

    const results = await huduCredentialSource.resolveByIds(ctx, ['hudu:101:42']);

    expect(results[0]).toEqual({ ref: 'hudu:101:42', summary: null, prune: false });
    expect(clientMock.getAssetPassword).not.toHaveBeenCalled();
  });

  it('omits (never prunes) a ref whose numeric password id belongs to a different company', async () => {
    const clientMock = {
      getAssetPassword: vi.fn(async () => huduRecord({ company_id: 999 })),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const results = await huduCredentialSource.resolveByIds(ctx, ['hudu:101:42']);

    expect(results[0]).toEqual({ ref: 'hudu:101:42', summary: null, prune: false });
  });
});
