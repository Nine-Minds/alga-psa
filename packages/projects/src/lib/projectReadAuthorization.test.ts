import { beforeEach, describe, expect, it, vi } from 'vitest';

const kernel = vi.hoisted(() => ({ authorizeResource: vi.fn() }));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ select: async () => [] }) }) }),
}));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: kernel.authorizeResource }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: vi.fn() }));
vi.mock('../models/project', () => ({ default: {} }));

import { createProjectReadAuthorizer, createProjectReadDecider } from './projectReadAuthorization';

const user = { user_id: 'u1', user_type: 'internal', roles: [{ role_id: 'r1' }] } as never;
const conn = {} as never;

beforeEach(() => {
  kernel.authorizeResource.mockReset();
});

describe('project read authorization', () => {
  it('the decider carries the kernel redaction set with the verdict', async () => {
    kernel.authorizeResource.mockResolvedValue({ allowed: true, redactedFields: ['description', 'project_tasks.task_name'] });
    const decide = await createProjectReadDecider(conn, 't1', user);
    await expect(decide({ project_id: 'p1', client_id: 'c1', assigned_to: null })).resolves.toEqual({
      allowed: true,
      redactedFields: ['description', 'project_tasks.task_name'],
    });
    expect(kernel.authorizeResource).toHaveBeenCalledWith(expect.objectContaining({ resource: { type: 'project', action: 'read', id: 'p1' } }));
  });

  it('the decider denies a row without a project id and carries no redactions for it', async () => {
    const decide = await createProjectReadDecider(conn, 't1', user);
    await expect(decide({})).resolves.toEqual({ allowed: false, redactedFields: [] });
    expect(kernel.authorizeResource).not.toHaveBeenCalled();
  });

  it('the boolean authorizer still returns only the verdict', async () => {
    const authorize = await createProjectReadAuthorizer(conn, 't1', user);
    kernel.authorizeResource.mockResolvedValueOnce({ allowed: true, redactedFields: ['description'] });
    await expect(authorize({ project_id: 'p1' })).resolves.toBe(true);
    kernel.authorizeResource.mockResolvedValueOnce({ allowed: false, redactedFields: [] });
    await expect(authorize({ project_id: 'p2' })).resolves.toBe(false);
    await expect(authorize({})).resolves.toBe(false);
    expect(kernel.authorizeResource).toHaveBeenCalledTimes(2);
  });

  it('forwards the requested action to the kernel', async () => {
    kernel.authorizeResource.mockResolvedValue({ allowed: true, redactedFields: [] });
    const authorize = await createProjectReadAuthorizer(conn, 't1', user, 'update');
    await authorize({ project_id: 'p1' });
    expect(kernel.authorizeResource).toHaveBeenCalledWith(expect.objectContaining({ resource: { type: 'project', action: 'update', id: 'p1' } }));
  });
});
