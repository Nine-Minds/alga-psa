/**
 * alga-2026-0002940: the shared record decision carries the caller's action to the kernel.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ whereIn: () => ({ select: async () => [] }) }) }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

import { isAssetActionAllowed, isAssetReadAllowed } from './assetReadAuthorization';

function contextWith(authorizeResource: ReturnType<typeof vi.fn<(req: any) => Promise<{ allowed: boolean }>>>) {
  return { subject: {} as any, authorizationKernel: { authorizeResource } as any, requestCache: {} as any };
}

describe('isAssetActionAllowed', () => {
  it.each(['read', 'update', 'delete'] as const)('sends action %s to the kernel', async (action) => {
    const authorizeResource = vi.fn(async (_req: any) => ({ allowed: true }));
    const allowed = await isAssetActionAllowed({} as any, 't', contextWith(authorizeResource), { asset_id: 'a1', client_id: 'c1' }, action);
    expect(allowed).toBe(true);
    expect(authorizeResource.mock.calls[0][0].resource).toEqual({ type: 'asset', action, id: 'a1' });
  });

  it('returns the kernel denial for the requested action', async () => {
    const authorizeResource = vi.fn(async (req: any) => ({ allowed: req.resource.action !== 'update' }));
    const ctx = contextWith(authorizeResource);
    const asset = { asset_id: 'a1', client_id: 'c1' };
    expect(await isAssetReadAllowed({} as any, 't', ctx, asset)).toBe(true);
    expect(await isAssetActionAllowed({} as any, 't', ctx, asset, 'update')).toBe(false);
  });

  it('isAssetReadAllowed keeps sending action read', async () => {
    const authorizeResource = vi.fn(async (_req: any) => ({ allowed: true }));
    await isAssetReadAllowed({} as any, 't', contextWith(authorizeResource), { asset_id: 'a1' });
    expect(authorizeResource.mock.calls[0][0].resource.action).toBe('read');
  });
});
