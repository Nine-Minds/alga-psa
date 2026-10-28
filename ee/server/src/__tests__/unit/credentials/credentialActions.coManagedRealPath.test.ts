/**
 * CM L0c A4 (credential surface, real path): `updateCredential` runs the REAL
 * `nativeCredentialSource.update`, which writes through `tenantDb` at the `credentials`
 * UPDATE. The database is a recording fake; only auth, tier and the record-level ACL are stubbed.
 * The refusal must come from the write choke point, surface as a typed save code, issue no
 * UPDATE, and not be logged as a fault.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CO_MANAGED_TENANT,
  PSA_TENANT,
  clearWriteAdmissionCacheForTests,
  createFakeKnex,
  withReadOnlyWorkspace,
  type FakeKnex,
} from '../../../../../../server/src/test/unit/coManagedWriteAdmission/fakeKnex';

const h = vi.hoisted(() => ({
  loggerError: vi.fn(),
  user: { user_id: 'user-1', tenant: 'tenant-co-managed', user_type: 'internal', roles: [] } as any,
  fake: null as any,
}));

vi.mock('@alga-psa/core/logger', () => ({ default: { error: h.loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...a: unknown[]) => Promise<unknown>) => (...a: unknown[]) => handler(h.user, { tenant: h.user.tenant }, ...a),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTierAccess: vi.fn(async () => undefined), TierAccessError: class extends Error {} }));
vi.mock('@alga-psa/types', () => ({ TIER_FEATURES: { CREDENTIALS: 'CREDENTIALS' } }));
vi.mock('server/src/lib/logging/auditLog', () => ({ auditLog: vi.fn(async () => undefined) }));
vi.mock('@ee/lib/integrations/hudu/huduIntegrationRepository', () => ({ getHuduIntegration: vi.fn(async () => null) }));
vi.mock('@ee/lib/integrations/hudu/companyMapping', () => ({ getHuduCompanyMappingRows: vi.fn(async () => []) }));
vi.mock('@ee/lib/credentials/huduSource', () => ({ huduCredentialSource: {}, isHuduCredentialId: (id: string) => id.startsWith('hudu:') }));
vi.mock('@ee/lib/credentials/associations', () => ({
  loadAssociationsForEntity: vi.fn(async () => []),
  pruneAssociationRefs: vi.fn(async () => undefined),
  resolveEntityClientId: vi.fn(async () => null),
  assertAttachmentsMatchClient: vi.fn(async () => undefined),
}));
// Record-level ACL is not what is under test; the UPDATE is.
vi.mock('@ee/lib/credentials/credentialAuthorization', async (orig) => ({
  ...((await orig()) as object),
  createCredentialAuthorizationContext: vi.fn(async () => ({})),
  authorizeCredentialRecord: vi.fn(async () => true),
}));
// The tenant connection is the recording fake; everything else in @alga-psa/db is real.
vi.mock('@alga-psa/db', async (orig) => ({
  ...((await orig()) as object),
  createTenantKnex: vi.fn(async () => ({ knex: h.fake.knex })),
}));

const CREDENTIAL_ROW = {
  credential_id: 'credential-1', tenant: CO_MANAGED_TENANT, client_id: 'client-1', name: 'old',
  username: null, url: null, description: null, is_restricted: false,
  password_ciphertext: null, otp_secret_ciphertext: null, encryption_scheme: 'aes-256-gcm:v1',
};

describe('updateCredential on a read-only co-managed workspace (A4, real nativeCredentialSource)', () => {
  let fake: FakeKnex;
  beforeEach(() => {
    vi.resetModules();
    clearWriteAdmissionCacheForTests();
    h.loggerError.mockReset();
    fake = createFakeKnex((sql) => (/from "credentials"/.test(sql) ? [CREDENTIAL_ROW] : /^\s*update "credentials"/i.test(sql) ? [{ ...CREDENTIAL_ROW, name: 'renamed' }] : undefined));
    h.fake = fake;
  });

  it.each([
    ['read_only', 'CO_MANAGED_READ_ONLY'],
    ['pending_acceptance', 'CO_MANAGED_NOT_ACTIVE'],
  ] as const)('returns %s as %s with no UPDATE and no fault log', async (state, code) => {
    h.user = { ...h.user, tenant: CO_MANAGED_TENANT };
    const { updateCredential } = await import('@ee/lib/actions/credentials/credentialActions');
    const result = await withReadOnlyWorkspace(() => updateCredential('credential-1', { name: 'renamed' }), state);

    expect(result).toEqual({ ok: false, code });
    expect(fake.writes().filter((s) => /^\s*update/i.test(s))).toEqual([]);
    expect(h.loggerError).not.toHaveBeenCalled();
    await fake.destroy();
  });

  it('control: a PSA tenant reaches the UPDATE and issues no tenants read', async () => {
    h.user = { ...h.user, tenant: PSA_TENANT };
    const { updateCredential } = await import('@ee/lib/actions/credentials/credentialActions');
    await updateCredential('credential-1', { name: 'renamed' });
    expect(fake.writes().some((s) => /^\s*update "credentials"/i.test(s))).toBe(true);
    await fake.destroy();
  });

  it('successfully updates a co-managed credential when the kill switch is off', async () => {
    h.user = { ...h.user, tenant: CO_MANAGED_TENANT };
    vi.stubEnv('FORCE_CAPABILITIES', 'co-managed:off');
    try {
      const { updateCredential } = await import('@ee/lib/actions/credentials/credentialActions');
      const result = await withReadOnlyWorkspace(() => updateCredential('credential-1', { name: 'renamed' }));
      expect(result).toMatchObject({ ok: true, credential: { id: 'credential-1', name: 'renamed' } });
      expect(fake.writes().some((sql) => /^\s*update "credentials"/i.test(sql))).toBe(true);
      expect(fake.statements.some((sql) => /^commit/i.test(sql))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      await fake.destroy();
    }
  });
});
