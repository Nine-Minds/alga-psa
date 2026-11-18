import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ probe: vi.fn(), principal: vi.fn() }));
vi.mock('@alga-psa/authorization/subject/tenantScope', () => ({ probeTenantAuthorizationScope: (...a: unknown[]) => h.probe(...a) }));
vi.mock('@shared/services/productPrincipal', () => ({ loadProductPrincipal: (...a: unknown[]) => h.principal(...a) }));

import { resolveTimeEntryMode } from '../timeEntryMode';

const scope = (resolverSubjects: boolean) => ({ publishedAssignments: false, portfolios: false, resolverSubjects });
const resolve = () => resolveTimeEntryMode({} as any, 't', 'u', {} as any);

describe('resolveTimeEntryMode (hot path)', () => {
  beforeEach(() => { h.probe.mockReset(); h.principal.mockReset(); });

  it('a tenant with no resolver subjects is commercial and reads no principal', async () => {
    h.probe.mockResolvedValue(scope(false));
    expect(await resolve()).toBe('commercial');
    expect(h.principal).not.toHaveBeenCalled();
  });

  it('a tenant that may have seat technicians reads the principal: seat => operational', async () => {
    h.probe.mockResolvedValue(scope(true));
    h.principal.mockResolvedValue({ surfaceKind: 'co_managed_seat' });
    expect(await resolve()).toBe('operational');
  });

  it('a tenant that may have seat technicians reads the principal: ordinary user => commercial', async () => {
    h.probe.mockResolvedValue(scope(true));
    h.principal.mockResolvedValue({ surfaceKind: null });
    expect(await resolve()).toBe('commercial');
  });

  it('fails closed: a failed principal read fails the save instead of defaulting to commercial', async () => {
    h.probe.mockResolvedValue(scope(true));
    h.principal.mockRejectedValue(new Error('db down'));
    await expect(resolve()).rejects.toThrow('db down');
  });
});
