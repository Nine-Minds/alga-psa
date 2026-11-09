import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getSharedWorkSummaryAction takes a caller-supplied resource of any kind and, unlike the handoff commands,
 * does NOT catch the read's errors: an opaque CoManagedSharedWorkError from a wholly hidden task must reach the
 * caller as a refusal, never as a (partial) summary. The process boundary (auth, capability, db, actor) is mocked;
 * the read itself is mocked to stand in for the two outcomes the library test (sharedWorkReadRedaction.test.ts)
 * proves for real: a hidden task throws, a readable task returns its summary. Regression for alga-2026-0003020.
 */
const session = vi.hoisted(() => ({ tenant: 'tenant-sponsor' }));
const summary = vi.hoisted(() => vi.fn());
const createTenantKnex = vi.hoisted(() => vi.fn());
const errors = vi.hoisted(() => { class SharedWorkError extends Error {} return { SharedWorkError }; });

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: session.tenant }, ...args),
}));
vi.mock('@alga-psa/core/capability/server', () => ({
  requireCapabilityForAction: vi.fn().mockResolvedValue(undefined),
  CapabilityUnavailableError: class CapabilityUnavailableError extends Error {},
}));
vi.mock('@alga-psa/db', () => ({ createTenantKnex, tenantDb: vi.fn(), withTransaction: vi.fn() }));
vi.mock('../../../lib/co-managed/browserActor', () => ({
  coManagedBrowserActor: async (_u: any, tenant: string) => ({ kind: 'session', tenant, userId: 'u', sessionId: 's' }),
}));
vi.mock('@alga-psa/co-managed', async () => new Proxy({
  getCoManagedSharedWorkSummary: summary,
  CoManagedSharedWorkError: errors.SharedWorkError,
  isCoManagedSharedWorkError: (e: unknown) => e instanceof errors.SharedWorkError,
}, { get: (t: any, name) => name === 'then' ? undefined : (t[name] ?? vi.fn()) }));

import { getSharedWorkSummaryAction } from '@/lib/actions/coManagedSharedWorkActions';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';

const task = { tenant: 'tenant-customer', relationshipId: 'r', kind: 'project_task', id: 't' } as any;

describe('getSharedWorkSummaryAction · project_task whole-resource redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.tenant = 'tenant-sponsor';
    createTenantKnex.mockResolvedValue({ knex: { id: 'knex' } });
  });

  it('refuses a wholly hidden task with the opaque error and returns no summary', async () => {
    summary.mockRejectedValue(new errors.SharedWorkError());
    const outcome = await (getSharedWorkSummaryAction as any)(task).then((v: any) => ({ returned: v }), (e: any) => ({ thrown: e }));
    expect(outcome.returned).toBeUndefined();
    expect(outcome.thrown).toBeInstanceOf(CoManagedSharedWorkError);
    // The refusal came from the admitted read of this exact resource, not from pre-empting it.
    expect(summary).toHaveBeenCalledWith({ id: 'knex' }, expect.objectContaining({ tenant: 'tenant-sponsor' }), task);
  });

  it('returns the summary unchanged when the task is readable', async () => {
    const result = { resource: task, revision: 1, fields: { task_name: 'Patch firewall', project: { kind: 'project', id: 'p', name: 'Network refresh' } } };
    summary.mockResolvedValue(result);
    const returned = await (getSharedWorkSummaryAction as any)(task);
    expect(returned).toBe(result);
    expect(returned.fields.task_name).toBe('Patch firewall');
    expect(returned.fields.project).toMatchObject({ name: 'Network refresh' });
  });
});
