import { beforeEach, describe, expect, it, vi } from 'vitest';

const findUsersMock = vi.fn();
const getTenantIdBySlugMock = vi.fn();
const resolveTenantFromPortalDomainMock = vi.fn();

vi.mock('@alga-psa/db/models/user', () => ({
  default: { findUsersByEmailAndType: (...a: unknown[]) => findUsersMock(...a) },
}));
vi.mock('@alga-psa/db', () => ({ getTenantIdBySlug: (...a: unknown[]) => getTenantIdBySlugMock(...a) }));
vi.mock('../portalDomainTenant', () => ({
  resolveTenantFromPortalDomain: (...a: unknown[]) => resolveTenantFromPortalDomainMock(...a),
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), system: vi.fn() },
}));

import { resolveResetSubjects } from './resolveResetSubjects';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function user(tenant: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    user_id: id,
    tenant,
    email: 'dual@example.com',
    user_type: 'client',
    username: id,
    is_inactive: false,
    created_at: new Date('2024-01-01'),
    ...extra,
  };
}

describe('resolveResetSubjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTenantIdBySlugMock.mockResolvedValue(null);
    resolveTenantFromPortalDomainMock.mockResolvedValue(null);
  });

  it('with no hint and one match, that user is the subject', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_A, 'u-a')]);
    const result = await resolveResetSubjects('Dual@Example.com', 'client', {});
    expect(findUsersMock).toHaveBeenCalledWith('dual@example.com', 'client');
    expect(result.map((r) => r.subject)).toEqual([
      { tenant: TENANT_A, user_id: 'u-a', email: 'dual@example.com', user_type: 'client' },
    ]);
  });

  it('with no hint and several tenants, yields one subject per tenant regardless of row order', async () => {
    const rows = [user(TENANT_B, 'u-b'), user(TENANT_A, 'u-a')];
    findUsersMock.mockResolvedValue(rows);
    const forward = await resolveResetSubjects('dual@example.com', 'client', {});
    findUsersMock.mockResolvedValue([...rows].reverse());
    const reversed = await resolveResetSubjects('dual@example.com', 'client', {});
    expect(forward.map((r) => r.subject.user_id).sort()).toEqual(['u-a', 'u-b']);
    expect(reversed.map((r) => r.subject.user_id)).toEqual(forward.map((r) => r.subject.user_id));
  });

  it('a portalDomain hint that resolves to a tenant keeps only that tenant', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_B, 'u-b'), user(TENANT_A, 'u-a')]);
    resolveTenantFromPortalDomainMock.mockResolvedValue(TENANT_A);
    const result = await resolveResetSubjects('dual@example.com', 'client', { portalDomain: 'a.example.test' });
    expect(result.map((r) => r.subject.user_id)).toEqual(['u-a']);
  });

  it('a tenantSlug hint that resolves to a tenant keeps only that tenant', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_A, 'u-a', { user_type: 'internal' }), user(TENANT_B, 'u-b', { user_type: 'internal' })]);
    getTenantIdBySlugMock.mockResolvedValue(TENANT_B);
    const result = await resolveResetSubjects('dual@example.com', 'internal', { tenantSlug: 'BBBBBBBBBBBB' });
    expect(getTenantIdBySlugMock).toHaveBeenCalledWith('bbbbbbbbbbbb');
    expect(result.map((r) => r.subject.user_id)).toEqual(['u-b']);
  });

  it('a hint that resolves to a tenant with no user yields nobody and never falls through', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_B, 'u-b')]);
    resolveTenantFromPortalDomainMock.mockResolvedValue(TENANT_A);
    expect(await resolveResetSubjects('dual@example.com', 'client', { portalDomain: 'a.example.test' })).toEqual([]);
  });

  it('a hinted tenant whose only user is inactive yields nobody, even if another tenant is active', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_A, 'u-a', { is_inactive: true }), user(TENANT_B, 'u-b')]);
    resolveTenantFromPortalDomainMock.mockResolvedValue(TENANT_A);
    expect(await resolveResetSubjects('dual@example.com', 'client', { portalDomain: 'a.example.test' })).toEqual([]);
  });

  it('an unresolvable host or malformed slug counts as no hint', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_A, 'u-a'), user(TENANT_B, 'u-b')]);
    const result = await resolveResetSubjects('dual@example.com', 'client', {
      portalDomain: 'unknown.example.test',
      tenantSlug: 'not-a-slug',
    });
    expect(result).toHaveLength(2);
  });

  it('hints naming different tenants contradict each other and yield nobody', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_A, 'u-a'), user(TENANT_B, 'u-b')]);
    getTenantIdBySlugMock.mockResolvedValue(TENANT_A);
    resolveTenantFromPortalDomainMock.mockResolvedValue(TENANT_B);
    expect(await resolveResetSubjects('dual@example.com', 'client', { tenantSlug: 'aaaaaaaaaaaa', portalDomain: 'b.test' })).toEqual([]);
  });

  it('inactive users never become subjects', async () => {
    findUsersMock.mockResolvedValue([user(TENANT_A, 'u-a', { is_inactive: true }), user(TENANT_B, 'u-b')]);
    const result = await resolveResetSubjects('dual@example.com', 'client', {});
    expect(result.map((r) => r.subject.user_id)).toEqual(['u-b']);
  });
});
