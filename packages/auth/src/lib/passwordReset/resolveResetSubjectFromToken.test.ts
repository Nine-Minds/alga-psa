import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUsersMock = vi.fn();
const getInfoFromTokenMock = vi.fn();
const tenantUserLookupMock = vi.fn();
const tenantDbMock = vi.fn();

vi.mock('@alga-psa/db/models/user', () => ({
  default: { findUsersByEmailAndType: (...a: unknown[]) => findUsersMock(...a) },
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => ({}) }));
vi.mock('@alga-psa/db', () => ({
  tenantDb: (...a: unknown[]) => tenantDbMock(...a),
}));
vi.mock('../tokenizer', () => ({ getInfoFromToken: (...a: unknown[]) => getInfoFromTokenMock(...a) }));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), system: vi.fn() },
}));

import { resolveResetSubjectFromToken } from './resolveResetSubjectFromToken';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const userA = (extra: Record<string, unknown> = {}) => ({
  user_id: 'u-a',
  tenant: TENANT_A,
  email: 'dual@example.com',
  user_type: 'client',
  username: 'a',
  is_inactive: false,
  ...extra,
});

function tokenFor(claims: Record<string, unknown>) {
  getInfoFromTokenMock.mockResolvedValue({
    errorType: null,
    userInfo: { username: '', email: 'dual@example.com', password: '', clientName: '', user_type: 'client', ...claims },
  });
}

describe('resolveResetSubjectFromToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tenantDbMock.mockImplementation((_db: unknown, tenant: string) => ({
      table: () => ({ where: (w: unknown) => ({ first: () => tenantUserLookupMock(tenant, w) }) }),
    }));
  });

  it('loads the bound user inside the bound tenant', async () => {
    tokenFor({ tenant: TENANT_A, user_id: 'u-a' });
    tenantUserLookupMock.mockResolvedValue(userA());
    const result = await resolveResetSubjectFromToken('t');
    expect(tenantDbMock).toHaveBeenCalledWith(expect.anything(), TENANT_A);
    expect(tenantUserLookupMock).toHaveBeenCalledWith(TENANT_A, { user_id: 'u-a' });
    expect(result?.subject).toEqual({ tenant: TENANT_A, user_id: 'u-a', email: 'dual@example.com', user_type: 'client' });
    expect(findUsersMock).not.toHaveBeenCalled();
  });

  it('refuses an invalid or expired token', async () => {
    getInfoFromTokenMock.mockResolvedValue({ errorType: 'Token Expired Error', userInfo: null });
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('refuses when the user was deactivated', async () => {
    tokenFor({ tenant: TENANT_A, user_id: 'u-a' });
    tenantUserLookupMock.mockResolvedValue(userA({ is_inactive: true }));
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('refuses when the email changed', async () => {
    tokenFor({ tenant: TENANT_A, user_id: 'u-a' });
    tenantUserLookupMock.mockResolvedValue(userA({ email: 'new@example.com' }));
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('refuses when the user type changed', async () => {
    tokenFor({ tenant: TENANT_A, user_id: 'u-a' });
    tenantUserLookupMock.mockResolvedValue(userA({ user_type: 'internal' }));
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('refuses when the tenant/user_id do not exist', async () => {
    tokenFor({ tenant: TENANT_B, user_id: 'ghost' });
    tenantUserLookupMock.mockResolvedValue(undefined);
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('refuses a user id that exists only in another tenant (scoped lookup misses)', async () => {
    tokenFor({ tenant: TENANT_B, user_id: 'u-a' });
    tenantUserLookupMock.mockImplementation(async (tenant: string) => (tenant === TENANT_A ? userA() : undefined));
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('refuses a token with only half of the binding', async () => {
    tokenFor({ tenant: TENANT_A });
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
    tokenFor({ user_id: 'u-a' });
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
    expect(findUsersMock).not.toHaveBeenCalled();
  });

  it('refuses a non-interactive token user_type', async () => {
    tokenFor({ tenant: TENANT_A, user_id: 'u-a', user_type: 'service' });
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('accepts a legacy token with exactly one cross-tenant match', async () => {
    tokenFor({});
    findUsersMock.mockResolvedValue([userA()]);
    const result = await resolveResetSubjectFromToken('t');
    expect(findUsersMock).toHaveBeenCalledWith('dual@example.com', 'client');
    expect(result?.subject.user_id).toBe('u-a');
  });

  it('refuses a legacy token with two matches', async () => {
    tokenFor({});
    findUsersMock.mockResolvedValue([userA(), userA({ user_id: 'u-b', tenant: TENANT_B })]);
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });

  it('refuses a legacy token whose single match is inactive', async () => {
    tokenFor({});
    findUsersMock.mockResolvedValue([userA({ is_inactive: true })]);
    expect(await resolveResetSubjectFromToken('t')).toBeNull();
  });
});
