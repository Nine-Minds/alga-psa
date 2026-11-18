/**
 * ApiClientController billing profile handlers: malformed path ids are a 400 before any query runs,
 * and the permission check comes first so an unauthorised caller learns nothing about id shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const svc = vi.hoisted(() => ({
  listBillingProfiles: vi.fn(),
  getBillingProfile: vi.fn(),
}));

vi.mock('@/lib/api/services/ClientService', () => ({
  ClientService: class { listBillingProfiles = svc.listBillingProfiles; getBillingProfile = svc.getBillingProfile; },
}));
vi.mock('@/lib/api/services/ContactService', () => ({ ContactService: class {} }));
vi.mock('server/src/lib/db', () => ({ runWithTenant: (_t: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/db', () => ({ runWithTenant: (_t: string, fn: () => unknown) => fn() }));

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';
import { ForbiddenError } from '@/lib/api/middleware/apiMiddleware';

const A = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const url = (path: string) => new NextRequest(`http://localhost/api/v1/clients/${path}`);

let allow = true;
beforeEach(() => {
  allow = true;
  svc.listBillingProfiles.mockReset().mockResolvedValue([]);
  svc.getBillingProfile.mockReset().mockResolvedValue({ billing_profile_id: P });
  vi.spyOn(ApiClientController.prototype as any, 'authenticate')
    .mockImplementation(async (req: any) => Object.assign(req, { context: { tenant: 't1', userId: 'u1' } }));
  vi.spyOn(ApiClientController.prototype as any, 'checkPermission').mockImplementation(async () => {
    if (!allow) throw new ForbiddenError('Permission denied: Cannot read client');
  });
});

describe('billing profile handlers: path id validation', () => {
  it('400s a malformed client id on list without querying', async () => {
    const res = await new ApiClientController().listBillingProfiles()(url('not-a-uuid/billing-profiles'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toBe('Invalid client ID format');
    expect(svc.listBillingProfiles).not.toHaveBeenCalled();
  });

  it('400s a malformed profile id or client id on get without querying', async () => {
    const bad = await new ApiClientController().getBillingProfile()(url(`${A}/billing-profiles/not-a-uuid`));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toBe('Invalid billing profile ID format');
    const badClient = await new ApiClientController().getBillingProfile()(url(`nope/billing-profiles/${P}`));
    expect(badClient.status).toBe(400);
    expect(svc.getBillingProfile).not.toHaveBeenCalled();
  });

  it('checks permission before validating ids (403 wins over 400)', async () => {
    allow = false;
    const res = await new ApiClientController().getBillingProfile()(url(`${A}/billing-profiles/not-a-uuid`));
    expect(res.status).toBe(403);
  });

  it('passes well-formed ids through to the service', async () => {
    const res = await new ApiClientController().getBillingProfile()(url(`${A}/billing-profiles/${P}`));
    expect(res.status).toBe(200);
    expect(svc.getBillingProfile).toHaveBeenCalledWith(A, P, expect.anything());
    const list = await new ApiClientController().listBillingProfiles()(url(`${A}/billing-profiles`));
    expect(list.status).toBe(200);
    expect(svc.listBillingProfiles).toHaveBeenCalledWith(A, expect.anything());
  });
});
