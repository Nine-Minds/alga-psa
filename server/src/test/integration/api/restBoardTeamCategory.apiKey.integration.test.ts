import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';

const connection = vi.hoisted(() => ({ db: undefined as Knex | undefined, tenant: undefined as string | undefined }));

vi.mock('@alga-psa/db', async (original) => ({
  ...await original<typeof import('@alga-psa/db')>(),
  getConnection: async () => connection.db!,
  getAdminConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? connection.tenant ?? null }),
}));
// Services import the tenant factory directly inside @alga-psa/db; route the
// in-process API call to the same rollback transaction as authentication.
vi.mock('../../../../../packages/db/src/lib/tenant', async (original) => ({
  ...await original<typeof import('../../../../../packages/db/src/lib/tenant')>(),
  getConnection: async () => connection.db!,
  createTenantKnex: async (tenant?: string) => ({ knex: connection.db!, tenant: tenant ?? connection.tenant ?? null }),
}));
vi.mock('@alga-psa/auth', async (original) => {
  const auth = await original<typeof import('@alga-psa/auth')>();
  const { ApiKeyService, shouldTouchApiKeyLastUsed } = await import('../../../../../packages/auth/src/services/apiKeyService');
  return { ...auth, ApiKeyService, shouldTouchApiKeyLastUsed };
});
vi.mock('@alga-psa/users/actions', async () => ({
  findUserByIdForApi: (await import('../../../../../packages/users/src/actions/user-actions/findUserByIdForApi')).findUserByIdForApi,
}));
vi.mock('@alga-psa/user-composition/lib/avatarUtils', () => ({ getUserAvatarUrl: async () => null }));
vi.mock('../../../lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: async () => null }));
vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: async () => undefined }));
vi.mock('next/server', async () => ({
  ...await import('next/dist/server/web/spec-extension/request'),
  ...await import('next/dist/server/web/spec-extension/response'),
}));

import { PUT as updateBoard } from '../../../app/api/v1/boards/[id]/route';
import { POST as createTeam } from '../../../app/api/v1/teams/route';
import { GET as unscopedCategoryTree } from '../../../app/api/v1/categories/ticket/tree/route';
import { GET as boardCategoryTree } from '../../../app/api/v1/categories/ticket/tree/[boardId]/route';

let db: Knex;
let tenant: string;
let userId: string;
let apiKey: Awaited<ReturnType<typeof createTestApiKey>>;

beforeAll(async () => {
    db = await createTestDbConnection({ recreate: false });
  tenant = (await db('tenants').first<{ tenant: string }>('tenant'))!.tenant;
}, 300_000);

beforeEach(async () => {
  connection.tenant = tenant;
  connection.db = await db.transaction();
  userId = randomUUID();
  await connection.db('users').insert({
    tenant, user_id: userId, username: `rest-${userId}`, email: `${userId}@example.test`,
    first_name: 'REST', last_name: 'Integration', hashed_password: 'test-only',
    user_type: 'internal', is_inactive: false,
  });
  apiKey = await createTestApiKey(connection.db, userId, tenant);
});

afterEach(async () => { await (connection.db as Knex.Transaction)?.rollback(); });
afterAll(async () => { await db?.destroy(); });

async function grantPermissions(permissions: Array<[string, string]>) {
  const trx = connection.db!;
  const roleId = randomUUID();
  await trx('roles').insert({ tenant, role_id: roleId, role_name: `REST test ${roleId}`, description: 'API key integration fixture' });
  for (const [resource, action] of permissions) {
    const permission = await trx('permissions').where({ tenant, resource, action, msp: true, client: false }).first<{ permission_id: string }>();
    if (!permission) throw new Error(`Missing integration permission ${resource}:${action}`);
    await trx('role_permissions').insert({ tenant, role_id: roleId, permission_id: permission.permission_id });
  }
  await trx('user_roles').insert({ tenant, role_id: roleId, user_id: userId });
}

async function assignAdminRole() {
  const admin = await connection.db!('roles').where({ tenant, role_name: 'Admin', msp: true, client: false }).first<{ role_id: string }>();
  if (!admin) throw new Error('The integration database has no MSP Admin role fixture');
  await connection.db!('user_roles').insert({ tenant, role_id: admin.role_id, user_id: userId });
}

function request(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'x-api-key': apiKey.api_key, 'x-tenant-id': tenant, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('REST routes with real API-key authentication and authorization', () => {
  it('restores team:create for an existing tenant idempotently without changing custom-role assignments', async () => {
    const migration = await import('../../../../migrations/20261101120000_backfill_rest_api_permissions.cjs');
    const trx = connection.db!;
    const existingCreate = await trx('permissions').where({ tenant, resource: 'team', action: 'create', msp: true, client: false }).first<{ permission_id: string }>();
    if (existingCreate) {
      await trx('role_permissions').where({ tenant, permission_id: existingCreate.permission_id }).delete();
      await trx('permissions').where({ tenant, permission_id: existingCreate.permission_id }).delete();
    }

    const retainedPermission = await trx('permissions').where({ tenant, resource: 'team', action: 'read', msp: true, client: false }).first<{ permission_id: string }>();
    if (!retainedPermission) throw new Error('The integration database has no team:read permission fixture');
    const customRoleId = randomUUID();
    await trx('roles').insert({ tenant, role_id: customRoleId, role_name: `Custom fixture ${customRoleId}`, description: 'Migration preservation fixture', msp: true, client: false });
    await trx('role_permissions').insert({ tenant, role_id: customRoleId, permission_id: retainedPermission.permission_id });

    await migration.up(trx);
    await migration.up(trx);

    const permissions = await trx('permissions').where({ tenant, resource: 'team', action: 'create', msp: true, client: false });
    expect(permissions).toHaveLength(1);
    const permission = permissions[0];
    const grants = await trx('role_permissions')
      .select('roles.role_name', 'roles.msp', 'roles.client', 'roles.role_id')
      .join('roles', function joinTenantRole() {
        this.on('roles.tenant', '=', 'role_permissions.tenant').andOn('roles.role_id', '=', 'role_permissions.role_id');
      })
      .where({ 'role_permissions.tenant': tenant, permission_id: permission.permission_id });
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.every((grant: any) => grant.role_name === 'Admin' && grant.msp && !grant.client)).toBe(true);
    expect(await trx('role_permissions').where({ tenant, role_id: customRoleId, permission_id: retainedPermission.permission_id }).first())
      .toBeDefined();
    expect(await trx('role_permissions').where({ tenant, role_id: customRoleId, permission_id: permission.permission_id }).first())
      .toBeUndefined();

    const catalog = await import('../../../../migrations/utils/permissions/catalog.cjs');
    expect(catalog.ACTIVE_PERMISSIONS.find((entry: any) => entry.resource === 'team' && entry.action === 'create')?.defaultGrants.psa)
      .toEqual(['msp:Admin']);
  });

  it('creates a team for a full-permission API-key principal and persists supported board update fields', async () => {
    const migration = await import('../../../../migrations/20261101120000_backfill_rest_api_permissions.cjs');
    await migration.up(connection.db!);
    await assignAdminRole();

    const createResponse = await createTeam(request('/api/v1/teams', 'POST', {
      team_name: `REST API ${randomUUID()}`,
      description: 'Created through an authenticated API key',
      manager_id: userId,
    }));
    const createPayload = await createResponse.json();
    expect(createResponse.status).toBe(201);
    const teamId = createPayload.data.team_id as string;
    expect(await connection.db!('teams').where({ tenant, team_id: teamId }).first()).toMatchObject({ manager_id: userId });

    const board = await connection.db!('boards').where({ tenant }).first<{ board_id: string }>('board_id');
    if (!board) throw new Error('The integration database has no board fixture');
    const boardName = `REST updated ${randomUUID()}`;
    const updateResponse = await updateBoard(request(`/api/v1/boards/${board.board_id}`, 'PUT', {
      board_name: boardName,
      default_assigned_team_id: teamId,
    }));
    expect(updateResponse.status).toBe(200);
    expect(await connection.db!('boards').where({ tenant, board_id: board.board_id }).first())
      .toMatchObject({ board_name: boardName, default_assigned_team_id: teamId });
  });

  it('continues to deny team creation when the API-key principal has no team:create grant', async () => {
    await grantPermissions([['team', 'read']]);
    const response = await createTeam(request('/api/v1/teams', 'POST', { team_name: 'Must remain denied' }));
    expect(response.status).toBe(403);
  });

  it('returns the hierarchy for unscoped and board-scoped category trees', async () => {
    await grantPermissions([['ticket_settings', 'read']]);
    const trx = connection.db!;
    const board = await trx('boards').where({ tenant }).first<{ board_id: string }>('board_id');
    if (!board) throw new Error('The integration database has no board fixture');

    const unscopedRoot = randomUUID();
    const boardRoot = randomUUID();
    const boardChild = randomUUID();
    await trx('categories').insert([
      { tenant, category_id: unscopedRoot, category_name: 'REST global root', parent_category: null, board_id: null, created_by: userId, display_order: 1 },
      { tenant, category_id: boardRoot, category_name: 'REST board root', parent_category: null, board_id: board.board_id, created_by: userId, display_order: 1 },
      { tenant, category_id: boardChild, category_name: 'REST board child', parent_category: boardRoot, board_id: board.board_id, created_by: userId, display_order: 2 },
    ]);

    const globalResponse = await unscopedCategoryTree(request('/api/v1/categories/ticket/tree', 'GET'));
    expect(globalResponse.status).toBe(200);
    const globalTree = await globalResponse.json();
    expect(globalTree.data.tree).toEqual(expect.arrayContaining([
      expect.objectContaining({ category_id: unscopedRoot }),
    ]));
    expect(globalTree.data.tree).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ category_id: boardRoot }),
    ]));

    const scopedResponse = await boardCategoryTree(request(`/api/v1/categories/ticket/tree/${board.board_id}`, 'GET'), {
      params: Promise.resolve({ boardId: board.board_id }),
    });
    expect(scopedResponse.status).toBe(200);
    const scopedTree = await scopedResponse.json();
    expect(scopedTree.data.tree).toEqual(expect.arrayContaining([
      expect.objectContaining({ category_id: boardRoot, children: expect.arrayContaining([expect.objectContaining({ category_id: boardChild })]) }),
    ]));
    expect(scopedTree.data.tree).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ category_id: unscopedRoot }),
    ]));
  });
});
