import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ select: async () => [] }) }) }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: vi.fn() }));
vi.mock('../models/project', () => ({ default: {} }));

import { createProjectReadAuthorizer, createProjectReadDecider } from './projectReadAuthorization';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

const user = { user_id: 'u1', user_type: 'internal', roles: [{ role_id: 'r1' }] } as never;
const conn = {} as never;

beforeEach(() => {
  vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockReset().mockResolvedValue([]);
});

describe('project read authorization', () => {
  it('the decider carries the kernel redaction set with the verdict', async () => {
    vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockResolvedValue([
      { id: 'redaction', resource: 'project', action: 'read', redactedFields: ['description', 'project_tasks.task_name'] },
    ]);
    const decide = await createProjectReadDecider(conn, 't1', user);
    await expect(decide({ project_id: 'p1', client_id: 'c1', assigned_to: null })).resolves.toEqual({
      allowed: true,
      redactedFields: ['description', 'project_tasks.task_name'],
    });
    expect(resolveBundleNarrowingRulesForEvaluation).toHaveBeenCalledWith(conn, expect.objectContaining({ resource: { type: 'project', action: 'read', id: 'p1' } }));
  });

  it('the decider denies a row without a project id and carries no redactions for it', async () => {
    const decide = await createProjectReadDecider(conn, 't1', user);
    await expect(decide({})).resolves.toEqual({ allowed: false, redactedFields: [] });
    expect(resolveBundleNarrowingRulesForEvaluation).not.toHaveBeenCalled();
  });

  it('the boolean authorizer still returns only the verdict', async () => {
    const authorize = await createProjectReadAuthorizer(conn, 't1', user);
    vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockResolvedValueOnce([
      { id: 'redaction', resource: 'project', action: 'read', redactedFields: ['description'] },
    ]);
    await expect(authorize({ project_id: 'p1' })).resolves.toBe(true);
    vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockResolvedValueOnce([
      { id: 'only-other-client', resource: 'project', action: 'read', templateKey: 'selected_clients', selectedClientIds: ['c2'] },
    ]);
    await expect(authorize({ project_id: 'p2' })).resolves.toBe(false);
    await expect(authorize({})).resolves.toBe(false);
    expect(resolveBundleNarrowingRulesForEvaluation).toHaveBeenCalledTimes(2);
  });

  it('forwards the requested action to the kernel', async () => {
    vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockResolvedValue([]);
    const authorize = await createProjectReadAuthorizer(conn, 't1', user, 'update');
    await authorize({ project_id: 'p1' });
    expect(resolveBundleNarrowingRulesForEvaluation).toHaveBeenCalledWith(conn, expect.objectContaining({ resource: { type: 'project', action: 'update', id: 'p1' } }));
  });

  it('propagates bundle-resolution failures instead of treating them as an unrestricted rule set', async () => {
    vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockRejectedValue(new Error('bundle store unavailable'));
    const decide = await createProjectReadDecider(conn, 't1', user);

    await expect(decide({ project_id: 'p1', client_id: 'c1' })).rejects.toThrow('bundle store unavailable');
  });

  it('preserves a successfully resolved empty rule set as unrestricted', async () => {
    vi.mocked(resolveBundleNarrowingRulesForEvaluation).mockResolvedValue([]);
    const decide = await createProjectReadDecider(conn, 't1', user);

    await expect(decide({ project_id: 'p1', client_id: 'c1' })).resolves.toMatchObject({ allowed: true, redactedFields: [] });
  });
});
