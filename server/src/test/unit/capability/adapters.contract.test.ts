import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nf = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }));
vi.mock('next/navigation', () => ({ notFound: nf }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: vi.fn(async () => true) }));
const sql = vi.hoisted(() => ({ createTenantKnex: vi.fn(), getAdminConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/db', () => sql);
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: sql.getAdminConnection }));
const logInfo = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  activityServesCapability,
  filterCapabilityServed,
  invalidateCapability,
  isCapabilityServed,
  registerCapabilityEligibility,
  registerCapabilityParticipation,
} from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import {
  CapabilityUnavailableError,
  capabilityRouteGuard,
  requireCapabilityForAction,
  requireCapabilityForPage,
} from '@alga-psa/core/capability/server';
import { withCapabilityJob } from '../../../../../packages/jobs/src/lib/jobs/capabilityJob';
import { handleApiError, NotFoundError } from '../../../lib/api/middleware/apiMiddleware';

function open(on: boolean) {
  registerCapabilityEligibility('co-managed', async () => on);
  registerCapabilityParticipation('co-managed', async (ctx: any) => (on ? [...ctx.tenantIds] : []));
  clearCapabilityCache();
}

describe('capability adapters', () => {
  afterEach(() => {
    // The gate registry is process-global; leave no resolvers for the next file.
    resetCapabilityRegistry();
  });

  beforeEach(() => {
    delete process.env.FORCE_CAPABILITIES;
    vi.clearAllMocks();
    open(false);
  });

  it('server action: closed throws CapabilityUnavailableError, open resolves', async () => {
    await expect(requireCapabilityForAction('co-managed', 't1')).rejects.toBeInstanceOf(CapabilityUnavailableError);
    open(true);
    await expect(requireCapabilityForAction('co-managed', 't1')).resolves.toBeUndefined();
  });

  it('REST: closed body is byte-identical to handleApiError(NotFoundError)', async () => {
    const res = await capabilityRouteGuard('co-managed', 't1');
    const existing = await handleApiError(new NotFoundError());
    expect(res!.status).toBe(404);
    expect(res!.status).toBe(existing.status);
    expect(await res!.json()).toEqual(await existing.json());
    open(true);
    expect(await capabilityRouteGuard('co-managed', 't1')).toBeNull();
  });

  it('RSC: closed calls notFound(), open does not', async () => {
    await expect(requireCapabilityForPage('co-managed', 't1')).rejects.toThrow('NEXT_NOT_FOUND');
    open(true);
    nf.mockClear();
    await requireCapabilityForPage('co-managed', 't1');
    expect(nf).not.toHaveBeenCalled();
  });

  it('job: closed logs job_skipped_capability_closed and never runs the handler', async () => {
    const handler = vi.fn();
    await withCapabilityJob('co-managed', handler)('job-1', { tenantId: 't1' } as any);
    expect(handler).not.toHaveBeenCalled();
    expect(sql.createTenantKnex).not.toHaveBeenCalled();
    expect(sql.getAdminConnection).not.toHaveBeenCalled();
    expect(sql.tenantDb).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'job_skipped_capability_closed', tenantId: 't1', jobId: 'job-1' }),
    );
    open(true);
    await withCapabilityJob('co-managed', handler)('job-2', { tenantId: 't1' } as any);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('job: system-scope (no tenantId) runs unchanged', async () => {
    const handler = vi.fn();
    await withCapabilityJob('co-managed', handler)('job-3', {} as any);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('subscriber: native fall-through (false / filtered list)', async () => {
    expect(await isCapabilityServed('co-managed', 't1')).toBe(false);
    expect(await filterCapabilityServed('co-managed', ['a', 'b'])).toEqual([]);
    open(true);
    expect(await filterCapabilityServed('co-managed', ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('temporal: closed returns the CapabilitySkip sentinel, open returns null', async () => {
    expect(await activityServesCapability('co-managed', 't1')).toEqual({ skipped: true, capability: 'co-managed' });
    expect(sql.createTenantKnex).not.toHaveBeenCalled();
    expect(sql.getAdminConnection).not.toHaveBeenCalled();
    open(true);
    invalidateCapability('co-managed');
    expect(await activityServesCapability('co-managed', 't1')).toBeNull();
  });
});
