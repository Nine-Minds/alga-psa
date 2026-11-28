/** `getSharedWorkSummaryAction` hands a caller-supplied resource to the real summary reader: a whole-task redaction propagates as the opaque denial. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from '../../../../../packages/co-managed/src/__tests__/fakeCoManagedDb';

const policy = vi.hoisted(() => ({ redactedFields: [] as string[], db: undefined as any }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: 't' }, ...args) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: vi.fn().mockResolvedValue(undefined), CapabilityUnavailableError: class extends Error {} }));
vi.mock('@/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: vi.fn(async () => ({ kind: 'session', tenant: 't', userId: 'u', sessionId: 's' })) }));
vi.mock('@alga-psa/db', async () => {
  const { fakeTenantDb } = await import('../../../../../packages/co-managed/src/__tests__/fakeCoManagedDb');
  return { createTenantKnex: async () => ({ knex: policy.db }), tenantDb: (db: any, tenant: string) => ({ ...fakeTenantDb(db, tenant), tenantJoin: () => undefined }),
    withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/co-managed/sharedWork', async () => ({
  ...(await vi.importActual<any>('@alga-psa/co-managed/sharedWork')),
  withCoManagedSharedWork: (db: any, actor: any, resource: any, _action: string, work: any) => db.transaction((trx: any) =>
    work({ trx, actor, resource, revision: 4, redactedFields: policy.redactedFields, assertCurrent: async () => undefined })),
}));

import { getSharedWorkSummaryAction } from '@/lib/actions/coManagedSharedWorkActions';
import { CoManagedSharedWorkError } from '@alga-psa/co-managed';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const resource = { kind: 'project_task' as const, tenant: U(4), id: U(5), relationshipId: U(6) };
beforeEach(() => {
  policy.redactedFields = [];
  const fixture = createFake();
  fixture.store.seed('project_tasks', { tenant: resource.tenant, task_id: resource.id, task_name: 'Private task', wbs_code: '1.2' });
  policy.db = fixture.db;
});

describe('getSharedWorkSummaryAction whole-task redaction', () => {
  it.each(['tasks', 'project_tasks', '*'])('rejects a hidden task (%s) with the opaque denial', async redaction => {
    policy.redactedFields = [redaction];
    await expect((getSharedWorkSummaryAction as any)(resource)).rejects.toBeInstanceOf(CoManagedSharedWorkError);
  });

  it('returns a readable task summary unchanged', async () => {
    const summary = await (getSharedWorkSummaryAction as any)(resource);
    expect(summary).toMatchObject({ resource, revision: 4, fields: { task_name: 'Private task', wbs_code: '1.2' } });
  });
});
