import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, closure, isForbiddenForWorkers } from './importGraph';

/**
 * Worker boot safety (plan 2.6, acceptance A6).
 *
 * Real boot harnesses (each mocks @alga-psa/core/capability so admits / serves /
 * filterServed throw, and proves the entry completes):
 *   services/workflow-worker/src/index.startup.test.ts      (startServices)
 *   services/email-service/src/index.capabilityBoot.test.ts (module start)
 *   ee/temporal-workflows/src/__tests__/worker.capabilityBoot.test.ts (module load)
 * This file guards that those harnesses keep existing and keep throwing, checks
 * the worker-reachable capability graph is Next-free, and proves the pure entry
 * itself fails closed rather than throwing when resolution is forced to fail.
 */
const HARNESSES = [
  'services/workflow-worker/src/index.startup.test.ts',
  'services/email-service/src/index.capabilityBoot.test.ts',
  'ee/temporal-workflows/src/__tests__/worker.capabilityBoot.test.ts',
];

describe('worker boot safety', () => {
  it.each(HARNESSES)('%s exists and forces the gate to throw', (h) => {
    expect(existsSync(join(REPO, h))).toBe(true);
    const src = readFileSync(join(REPO, h), 'utf8');
    expect(src).toContain("vi.mock('@alga-psa/core/capability'");
    for (const fn of ['admits', 'serves', 'filterServed']) expect(src).toMatch(new RegExp(`${fn}:`));
    expect(src).toContain('forced to fail');
  });

  it.each([
    'packages/core/src/lib/capability.ts',
    'packages/jobs/src/lib/jobs/capabilityJob.ts',
    'services/workflow-worker/src/index.ts',
    'services/email-service/src/index.ts',
  ])('%s reaches no Next/posthog module and never the Next-bound subpath', (entry) => {
    const c = closure(entry);
    expect([...c.bare].filter(isForbiddenForWorkers)).toEqual([]);
    expect([...c.files].filter((f) => /capability\/server\.ts$/.test(f))).toEqual([]);
  });

  it('the jobs adapter imports only the pure capability entry', () => {
    const src = readFileSync(join(REPO, 'packages/jobs/src/lib/jobs/capabilityJob.ts'), 'utf8');
    const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).filter((s) => s.includes('capability'));
    expect(specs).toEqual(['@alga-psa/core/capability']);
  });

  it('the pure entry loads and fails closed when flag evaluation and resolvers are forced to fail', async () => {
    vi.resetModules();
    const boom = vi.fn(async () => {
      throw new Error('boom');
    });
    vi.doMock('../../../../../packages/core/src/lib/features', () => ({ isFeatureFlagEnabled: boom }));
    const cap = await import('../../../../../packages/core/src/lib/capability');
    const testing = await import('../../../../../packages/core/src/capability/testing');
    cap.registerCapabilityEligibility('co-managed', async () => {
      throw new Error('db down');
    });
    cap.registerCapabilityParticipation('co-managed', async () => {
      throw new Error('db down');
    });
    testing.clearCapabilityCache();
    await expect(cap.serves('co-managed', 't1')).resolves.toMatchObject({ served: false });
    await expect(cap.admits('co-managed', 't1')).resolves.toMatchObject({ admitted: false });
    await expect(cap.filterServed('co-managed', ['t1'])).resolves.toEqual([]);
    await expect(cap.activityServesCapability('co-managed', 't1')).resolves.toEqual({
      skipped: true,
      capability: 'co-managed',
    });
    // The gate registry is process-global; leave no throwing resolvers behind.
    testing.resetCapabilityRegistry();
    vi.doUnmock('../../../../../packages/core/src/lib/features');
  });
});
