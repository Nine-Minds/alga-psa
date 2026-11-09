import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nf = vi.hoisted(() => vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }));
vi.mock('next/navigation', () => ({ notFound: nf }));
const sql = vi.hoisted(() => ({ createTenantKnex: vi.fn(), getAdminConnection: vi.fn(), tenantDb: vi.fn() }));
vi.mock('@alga-psa/db', () => sql);
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: sql.getAdminConnection }));
const logInfo = vi.hoisted(() => vi.fn());
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerFeatureFlagChecker } from '@alga-psa/core/features';
import {
  activityServesCapability,
  filterCapabilityServed,
  invalidateCapability,
  isCapabilityServed,
  registerCapabilityEligibility,
  registerCapabilityParticipation,
  CAPABILITY_KEYS,
  type CapabilityKey,
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

/**
 * Open or close one capability. co-managed's eligibility is a registered resolver; ticket-conversations'
 * eligibility is seeded (every tenant), so its admission follows the flag and the registered participation
 * resolver stands in for L1's.
 */
function open(capability: CapabilityKey, on: boolean) {
  if (capability === 'co-managed') {
    registerCapabilityEligibility(capability, async () => on);
  } else {
    registerFeatureFlagChecker(async () => on);
  }
  registerCapabilityParticipation(capability, async ({ tenantIds }) => (on ? [...tenantIds] : []));
  clearCapabilityCache();
}

describe.each(CAPABILITY_KEYS)('capability adapters: %s', (capability) => {
  afterEach(() => {
    // The gate registry is process-global; leave no resolvers for the next file.
    resetCapabilityRegistry();
    delete (globalThis as Record<symbol, unknown>)[Symbol.for('alga.core.featureFlagChecker')];
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv('FORCE_CAPABILITIES', '');
    vi.stubEnv('FEATURE_FLAG_TENANTS__RELEASE_V2_0_FEATURE', undefined);
    vi.stubEnv('NEXT_PUBLIC_DISABLE_FEATURE_FLAGS', 'false');
    vi.stubEnv('DISABLE_FEATURE_FLAGS', 'false');
    vi.clearAllMocks();
    registerFeatureFlagChecker(async () => true);
    open(capability, false);
  });

  it('server action: closed throws CapabilityUnavailableError, open resolves', async () => {
    await expect(requireCapabilityForAction(capability, 't1')).rejects.toBeInstanceOf(CapabilityUnavailableError);
    open(capability, true);
    await expect(requireCapabilityForAction(capability, 't1')).resolves.toBeUndefined();
  });

  it('REST: closed body is byte-identical to handleApiError(NotFoundError)', async () => {
    const res = await capabilityRouteGuard(capability, 't1');
    const existing = await handleApiError(new NotFoundError());
    expect(res!.status).toBe(404);
    expect(res!.status).toBe(existing.status);
    expect(await res!.json()).toEqual(await existing.json());
    open(capability, true);
    expect(await capabilityRouteGuard(capability, 't1')).toBeNull();
  });

  it('RSC: closed calls notFound(), open does not', async () => {
    await expect(requireCapabilityForPage(capability, 't1')).rejects.toThrow('NEXT_NOT_FOUND');
    open(capability, true);
    nf.mockClear();
    await requireCapabilityForPage(capability, 't1');
    expect(nf).not.toHaveBeenCalled();
  });

  it('job: closed logs job_skipped_capability_closed and never runs the handler', async () => {
    const handler = vi.fn();
    await withCapabilityJob(capability, handler)('job-1', { tenantId: 't1' } as any);
    expect(handler).not.toHaveBeenCalled();
    expect(sql.createTenantKnex).not.toHaveBeenCalled();
    expect(sql.getAdminConnection).not.toHaveBeenCalled();
    expect(sql.tenantDb).not.toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'job_skipped_capability_closed', tenantId: 't1', jobId: 'job-1' }),
    );
    open(capability, true);
    await withCapabilityJob(capability, handler)('job-2', { tenantId: 't1' } as any);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('job: system-scope (no tenantId) runs unchanged', async () => {
    const handler = vi.fn();
    await withCapabilityJob(capability, handler)('job-3', {} as any);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('subscriber: native fall-through (false / filtered list)', async () => {
    expect(await isCapabilityServed(capability, 't1')).toBe(false);
    expect(await filterCapabilityServed(capability, ['a', 'b'])).toEqual([]);
    open(capability, true);
    expect(await filterCapabilityServed(capability, ['a', 'b'])).toEqual(['a', 'b']);
  });

  it('temporal: closed returns the CapabilitySkip sentinel, open returns null', async () => {
    expect(await activityServesCapability(capability, 't1')).toEqual({ skipped: true, capability });
    expect(sql.createTenantKnex).not.toHaveBeenCalled();
    expect(sql.getAdminConnection).not.toHaveBeenCalled();
    open(capability, true);
    invalidateCapability(capability);
    expect(await activityServesCapability(capability, 't1')).toBeNull();
  });
});
