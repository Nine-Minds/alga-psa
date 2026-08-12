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
    HuduRequestErrorStub,
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
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
}));

vi.mock('@ee/lib/integrations/hudu/revealAudit', () => ({
  writeHuduPasswordRevealAudit: writeHuduPasswordRevealAuditMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduDataCore', () => ({
  fetchCompanyList: vi.fn(async (_tenant: string, _clientId: string, _resource: string) => {
    return { state: 'unmapped' as const, items: [], count: 0 };
  }),
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('@ee/lib/credentials/audit', () => ({
  writeCredentialAudit: writeCredentialAuditMock,
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
      updateAssetPassword: vi.fn(async () => huduRecord({ name: 'Renamed' })),
    };
    createHuduClientMock.mockResolvedValue(clientMock);

    const summary = await huduCredentialSource.update(ctx, 'hudu:101:42', {
      clientId: CLIENT_ID,
      name: 'Renamed',
      password: 'new-password',
    });

    expect(clientMock.updateAssetPassword).toHaveBeenCalledTimes(1);
    const [id, payload] = clientMock.updateAssetPassword.mock.calls[0];
    expect(id).toBe(42);
    expect(payload).toMatchObject({ name: 'Renamed', password: 'new-password' });
    expect(summary.name).toBe('Renamed');
    expect(JSON.stringify(summary)).not.toContain('new-password');
    expect(clearCachedHuduListMock).toHaveBeenCalledWith(TENANT, COMPANY_ID, 'asset_passwords');
  });

  it('rejects an update when the mapped company does not match the row company', async () => {
    resolveHuduCompanyIdForClientMock.mockResolvedValue('999');

    await expect(
      huduCredentialSource.update(ctx, 'hudu:101:42', { clientId: CLIENT_ID })
    ).rejects.toThrow(/not mapped/);
    expect(createHuduClientMock).not.toHaveBeenCalled();
  });
});

describe('huduCredentialSource — remove', () => {
  it('deletes through the Hudu API and invalidates the cache', async () => {
    const clientMock = { deleteAssetPassword: vi.fn(async () => undefined) };
    createHuduClientMock.mockResolvedValue(clientMock);

    await huduCredentialSource.remove(ctx, 'hudu:101:42');

    expect(clientMock.deleteAssetPassword).toHaveBeenCalledWith(42);
    expect(clearCachedHuduListMock).toHaveBeenCalledWith(TENANT, COMPANY_ID, 'asset_passwords');
    expect(writeCredentialAuditMock).toHaveBeenCalled();
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
