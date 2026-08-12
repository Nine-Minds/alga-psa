/**
 * Tier gate + fail-closed reveal audit contracts for the credentials vault:
 *  - server actions reject below Pro via assertTierAccess(TIER_FEATURES.CREDENTIALS)
 *  - reveal is fail-closed: if the audit insert fails, the action throws and no
 *    value is returned (no audit row ⇒ no value).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  hasPermissionMock,
  assertTierAccessMock,
  TierAccessErrorMock,
  auditLogMock,
} = vi.hoisted(() => {
  class TierAccessErrorMock extends Error {
    readonly statusCode = 403;
    readonly code = 'TIER_ACCESS_DENIED';
  }
  return {
    hasPermissionMock: vi.fn(),
    assertTierAccessMock: vi.fn(),
    TierAccessErrorMock,
    auditLogMock: vi.fn(),
  };
});

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: unknown[]) => Promise<unknown>) => (...args: unknown[]) =>
    handler(internalUser, { tenant: 'tenant-1' }, ...args),
  hasPermission: hasPermissionMock,
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: assertTierAccessMock,
  TierAccessError: TierAccessErrorMock,
}));

vi.mock('@alga-psa/types', () => {
  const TIER_FEATURES = { CREDENTIALS: 'CREDENTIALS' };
  return { TIER_FEATURES };
});

vi.mock('server/src/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
}));

vi.mock('server/src/lib/logging/auditLog', () => ({
  auditLog: auditLogMock,
}));

vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({
  getHuduIntegration: vi.fn(async () => null),
}));

const internalUser = {
  user_id: 'user-1',
  tenant: 'tenant-1',
  user_type: 'internal',
  roles: [],
};

async function importActions() {
  return import('@ee/lib/actions/credentials/credentialActions');
}

beforeEach(() => {
  vi.resetModules();
  hasPermissionMock.mockReset();
  assertTierAccessMock.mockReset();
  hasPermissionMock.mockResolvedValue(true);
  assertTierAccessMock.mockResolvedValue(undefined);
  auditLogMock.mockReset();
  auditLogMock.mockResolvedValue(undefined);
});

describe('credentials actions — tier gate', () => {
  it('rejects the action when the tenant tier is below Pro (assertTierAccess throws)', async () => {
    assertTierAccessMock.mockRejectedValue(new TierAccessErrorMock());
    const { listCredentials } = await importActions();

    await expect(listCredentials({})).rejects.toBeInstanceOf(TierAccessErrorMock);
    expect(assertTierAccessMock).toHaveBeenCalledWith('CREDENTIALS');
  });

  it('passes when the Pro tier is granted', async () => {
    const { getCredentialsContext } = await importActions();
    const result = await getCredentialsContext();

    expect(assertTierAccessMock).toHaveBeenCalledWith('CREDENTIALS');
    expect(result.tierOk).toBe(true);
  });

  it('rejects users without the credential:read permission', async () => {
    hasPermissionMock.mockResolvedValue(false);
    const { listCredentials } = await importActions();

    await expect(listCredentials({})).rejects.toThrow(/Forbidden/);
  });
});

describe('fail-closed reveal audit (writeCredentialAudit)', () => {
  it('propagates an audit-insert failure so the caller never gets a value', async () => {
    const { writeCredentialAudit } = await import('@ee/lib/credentials/audit');

    // The transaction runner is the audit module's own knex wrapper; simulate a
    // failed insert inside the audit sink by making the underlying auditLog throw.
    auditLogMock.mockRejectedValue(new Error('audit insert failed'));

    await expect(
      writeCredentialAudit(
        { transaction: async (cb: (trx: unknown) => Promise<void>) => {
          await cb({ raw: async () => undefined });
        } } as never,
        'tenant-1',
        'credential_reveal',
        { userId: 'user-1', credentialId: 'cred-1', clientId: 'client-1' }
      )
    ).rejects.toThrow('audit insert failed');
  });
});
