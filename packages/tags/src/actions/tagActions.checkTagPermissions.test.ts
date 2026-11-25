import { beforeEach, describe, expect, it, vi } from 'vitest';

const governed = vi.hoisted(() => ({ restricted: false, asked: [] as Array<{ tenant: string; userId: string }> }));
const permissions = vi.hoisted(() => ({ granted: new Set<string>() }));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
  withOptionalAuth: (fn: any) => fn,
}));
vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: vi.fn(async (_user: unknown, resource: string, action: string) => permissions.granted.has(`${resource}:${action}`)),
  throwPermissionErrorAsync: vi.fn(),
}));
vi.mock('../lib/uiHelpers', () => ({ generateEntityColorAsync: vi.fn() }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  registerAfterCommit: vi.fn(),
  tenantDb: vi.fn(),
  withTransaction: async (_db: unknown, callback: (trx: object) => Promise<unknown>) => callback({}),
}));
// The seat authority's answer, as the kernel gives it: false for a seat technician, true for everyone else.
vi.mock('@alga-psa/authorization/recordCreateAuthorization', () => ({
  isResolverGovernedCreateAllowed: vi.fn(async (_db: unknown, input: { tenant: string; user: { user_id: string }; resourceType: string }) => {
    governed.asked.push({ tenant: input.tenant, userId: input.user.user_id });
    expect(input.resourceType).toBe('tag');
    return !governed.restricted;
  }),
  // The closed baseline grants a seat tag:read only: every other tag action is closed to it.
  isResolverGovernedActionAllowed: vi.fn(async (_db: unknown, input: { resourceType: string }) => {
    expect(input.resourceType).toBe('tag');
    return !governed.restricted;
  }),
}));

import { checkTagPermissions } from './tagActions';

const user = { user_id: 'user-1', tenant: 'tenant-1', user_type: 'internal' };
const check = (taggedType: string) => (checkTagPermissions as any)(user, null, taggedType);

describe('checkTagPermissions for a seat technician', () => {
  beforeEach(() => {
    governed.restricted = false;
    governed.asked = [];
    // What the seat role grants: update the ticket and create tags (for its existing-tag picker).
    permissions.granted = new Set(['ticket:update', 'tag:create', 'tag:update', 'tag:delete']);
  });

  it('can add existing tags but is not offered "create", although the role grants tag:create', async () => {
    governed.restricted = true;
    expect(await check('ticket')).toMatchObject({ canAddExisting: true, canCreateNew: false });
    expect(governed.asked).toEqual([{ tenant: 'tenant-1', userId: 'user-1' }]);
  });

  it('applies and removes tags on a record it may update, but manages no definition', async () => {
    governed.restricted = true;
    expect(await check('project_task')).toEqual({
      canAddExisting: false, canCreateNew: false, canEditColors: false, canEditText: false, canDelete: false,
      canDeleteAll: false, canDeleteDefinition: false,
    });
    permissions.granted = new Set(['project_task:update', 'tag:create', 'tag:update', 'tag:delete']);
    expect(await check('project_task')).toEqual({
      canAddExisting: true, canCreateNew: false, canEditColors: false, canEditText: false, canDelete: true,
      canDeleteAll: false, canDeleteDefinition: false,
    });
  });

  it('leaves everyone else exactly as before: create is offered when the role grants it', async () => {
    expect(await check('ticket')).toEqual({
      canAddExisting: true, canCreateNew: true, canEditColors: true, canEditText: true, canDelete: true, canDeleteAll: true,
      canDeleteDefinition: true,
    });
  });

  it('asks the seat authority only of a caller who would otherwise be offered "create"', async () => {
    permissions.granted.delete('tag:create');
    expect(await check('ticket')).toMatchObject({ canAddExisting: true, canCreateNew: false });
    permissions.granted.clear();
    expect(await check('ticket')).toMatchObject({ canAddExisting: false, canCreateNew: false });
    expect(governed.asked).toEqual([]);
  });
});
