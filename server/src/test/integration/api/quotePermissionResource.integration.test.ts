import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { getTenantContext, runWithTenant, runWithoutTenant, tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTestApiKey } from '../../e2e/utils/apiTestHelpers';

// The controller resolves its RBAC connection through getConnection(); point that
// at the bootstrapped test database so checkPermission runs against real rows.
let testDb: Knex;
vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/db')>();
  return {
    ...actual,
    getConnection: vi.fn(async () => testDb),
  };
});

const { ApiQuoteController } = await import('@/lib/api/controllers/ApiQuoteController');
const { ApiProjectController } = await import('@/lib/api/controllers/ApiProjectController');
const { ApiTicketController } = await import('@/lib/api/controllers/ApiTicketController');
const { ApiAssetController } = await import('@/lib/api/controllers/ApiAssetController');
const { hasPermission } = await import('@/lib/auth/rbac');
const User = (await import('@alga-psa/db/models/user')).default;

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows() {
  return tenantDb(db, '__test_tenant_fixture__')
    .unscoped('tenants', 'test fixture creates and removes tenant rows');
}

function schemaTable(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows');
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'user_roles').del();
  await tenantTable(tenantId, 'role_permissions').del();
  await tenantTable(tenantId, 'roles').del();
  await tenantTable(tenantId, 'permissions').del();
  await tenantTable(tenantId, 'users').del();
  await tenantRows().where({ tenant: tenantId }).del();
}

type Grant = { resource: string; action: string; msp?: boolean; client?: boolean };

type Fixture = {
  tenantId: string;
  userId: string;
  user: { user_id: string; user_type: string; tenant: string };
};

async function createFixture(grants: Grant[], userType: 'internal' | 'client' = 'internal'): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const roleId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await tenantRows().insert({
    tenant: tenantId,
    client_name: `Quote RBAC Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `quote-rbac-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'user_type') ? { user_type: userType } : {}),
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await tenantTable(tenantId, 'roles').insert({
    tenant: tenantId,
    role_id: roleId,
    role_name: `Quote RBAC Role ${tenantId.slice(0, 8)}`,
    msp: userType === 'internal',
    client: userType === 'client',
  });

  await tenantTable(tenantId, 'user_roles').insert({ tenant: tenantId, user_id: userId, role_id: roleId });

  for (const grant of grants) {
    const permissionId = uuidv4();
    await tenantTable(tenantId, 'permissions').insert({
      tenant: tenantId,
      permission_id: permissionId,
      resource: grant.resource,
      action: grant.action,
      msp: grant.msp ?? userType === 'internal',
      client: grant.client ?? userType === 'client',
    });
    await tenantTable(tenantId, 'role_permissions').insert({
      tenant: tenantId,
      role_id: roleId,
      permission_id: permissionId,
    });
  }

  return { tenantId, userId, user: { user_id: userId, user_type: userType, tenant: tenantId } };
}

function requestFor(fixture: Fixture): any {
  return {
    url: 'https://example.test/api/v1/quotes',
    context: {
      tenant: fixture.tenantId,
      userId: fixture.userId,
      user: fixture.user,
      apiKeyId: uuidv4(),
    },
  };
}

type ColdRoute = 'projects/export' | 'tickets' | 'assets/[id]';
type ColdProbeResult = {
  initialTenant: string | null;
  status: number;
  errorCode: string | null;
  finalTenant: string | null;
};

function runColdApiRequest(
  route: ColdRoute,
  url: string,
  apiKey: string,
  expectedStatus: number,
  assetId?: string,
): ColdProbeResult {
  const connection = db.client.config.connection as Record<string, unknown>;
  const scratch = mkdtempSync(join(tmpdir(), 'alga-cold-rbac-'));
  const resultPath = join(scratch, 'result.json');

  try {
    const child = spawnSync(process.execPath, [
      '../node_modules/vitest/vitest.mjs', 'run',
      '--config', 'vitest.cold-rbac.config.ts',
      'test-workers/coldRbacFreshProcess.test.ts',
    ], {
      cwd: process.cwd(),
      timeout: 90_000,
      stdio: 'ignore',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_HOST: String(connection.host),
        DB_PORT: String(connection.port),
        DB_NAME_SERVER: String(connection.database),
        DB_USER_SERVER: String(connection.user),
        DB_PASSWORD_SERVER: String(connection.password),
        COLD_RBAC_ROUTE_MODULE: `@/app/api/v1/${route}/route`,
        COLD_RBAC_URL: url,
        COLD_RBAC_API_KEY: apiKey,
        COLD_RBAC_EXPECTED_STATUS: String(expectedStatus),
        COLD_RBAC_ASSET_ID: assetId ?? '',
        COLD_RBAC_RESULT_FILE: resultPath,
      },
    });

    if (child.error || child.status !== 0) {
      throw new Error(`Cold API probe process failed (status=${child.status ?? 'none'}, signal=${child.signal ?? 'none'}, error=${child.error?.code ?? 'none'})`);
    }
    const result = readFileSync(resultPath, 'utf8');
    const parsed = JSON.parse(result) as ColdProbeResult;
    return parsed;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

describe('quote API permission resource integration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    testDb = db;
    tenantColumns = await schemaTable('tenants').columnInfo();
    userColumns = await schemaTable('users').columnInfo();
  });

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
    }
    tenantsToCleanup.clear();
  });

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  });

  // Regression: the controller declared resource 'quote', which does not exist in
  // the permissions table, so every quote endpoint 403'd for every role.
  it('has no "quote" resource to authorize against', async () => {
    const fixture = await createFixture([{ resource: 'billing', action: 'read' }]);

    await expect(hasPermission(fixture.user as any, 'quote', 'read', db)).resolves.toBe(false);
    await expect(hasPermission(fixture.user as any, 'billing', 'read', db)).resolves.toBe(true);
  });

  it('allows a billing:read grant to pass the quote list permission gate', async () => {
    const fixture = await createFixture([{ resource: 'billing', action: 'read' }]);
    const controller = new ApiQuoteController();

    await expect(
      (controller as any).checkPermission(requestFor(fixture), 'read'),
    ).resolves.toBeUndefined();
  });

  it('still denies a caller holding no billing permission', async () => {
    const fixture = await createFixture([{ resource: 'ticket', action: 'read' }]);
    const controller = new ApiQuoteController();

    await expect(
      (controller as any).checkPermission(requestFor(fixture), 'read'),
    ).rejects.toThrow(/Cannot read quote/);
  });

  it('authorizes first project, ticket, and asset reads from a clean tenant context and preserves denials', async () => {
    const authorized = await createFixture([
      { resource: 'project', action: 'read' },
      { resource: 'ticket', action: 'read' },
      { resource: 'asset', action: 'read' },
    ]);
    const unauthorized = await createFixture([{ resource: 'ticket', action: 'create' }]);
    const projectController = new ApiProjectController();
    const ticketController = new ApiTicketController();
    const assetController = new ApiAssetController();

    await runWithoutTenant(async () => {
      expect(getTenantContext()).toBeUndefined();
      await expect(
        (projectController as any).checkPermission(requestFor(authorized), 'read'),
      ).resolves.toBeUndefined();
      await expect(
        (ticketController as any).checkPermission(requestFor(authorized), 'read'),
      ).resolves.toBeUndefined();
      await expect(
        (assetController as any).requireReadPermissions(requestFor(authorized).context, ['asset']),
      ).resolves.toBeNull();
      await expect(
        (projectController as any).checkPermission(requestFor(unauthorized), 'read'),
      ).rejects.toThrow(/Cannot read project/);
      await expect(
        (ticketController as any).checkPermission(requestFor(unauthorized), 'read'),
      ).rejects.toThrow(/Cannot read ticket/);
      const deniedAssetResponse = await (assetController as any).requireReadPermissions(
        requestFor(unauthorized).context,
        ['asset'],
      );
      expect(deniedAssetResponse?.status).toBe(403);
      expect(getTenantContext()).toBeUndefined();
    });
    expect(getTenantContext()).toBeUndefined();
  });

  it('authorizes first API-key requests in fresh processes with a real connection, and denies valid keys without grants', async () => {
    const routeCases: Array<{ route: ColdRoute; url: string; resource: string; authorizedStatus: number; assetId?: string }> = [
      { route: 'projects/export', url: 'http://localhost/api/v1/projects/export?format=json', resource: 'project', authorizedStatus: 200 },
      { route: 'tickets', url: 'http://localhost/api/v1/tickets?search=Cold%20RBAC', resource: 'ticket', authorizedStatus: 200 },
      {
        route: 'assets/[id]',
        url: 'http://localhost/api/v1/assets/33333333-3333-3333-3333-333333333333',
        resource: 'asset',
        authorizedStatus: 404,
        assetId: '33333333-3333-3333-3333-333333333333',
      },
    ];
    const authorized = await createFixture(routeCases.map(({ resource }) => ({ resource, action: 'read' })));
    const unauthorized = await createFixture([{ resource: 'ticket', action: 'create' }]);
    const authorizedKey = await createTestApiKey(db, authorized.userId, authorized.tenantId, 'Cold RBAC authorized');
    const unauthorizedKey = await createTestApiKey(db, unauthorized.userId, unauthorized.tenantId, 'Cold RBAC unauthorized');

    const roles = await runWithTenant(authorized.tenantId, () => User.getUserRolesWithPermissions(db, authorized.userId));
    expect(roles).toHaveLength(1);
    expect(roles[0].msp).toBe(true);
    expect(roles[0].client).toBe(false);
    expect(roles[0].permissions.filter(({ action }) => action === 'read')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: 'project', msp: true }),
        expect.objectContaining({ resource: 'ticket', msp: true }),
        expect.objectContaining({ resource: 'asset', msp: true }),
      ]),
    );
    expect(roles[0].permissions.filter(({ action }) => action === 'read').every(({ client }) => !client)).toBe(true);

    for (const routeCase of routeCases) {
      const authorizedResult = runColdApiRequest(
        routeCase.route,
        routeCase.url,
        authorizedKey.api_key,
        routeCase.authorizedStatus,
        routeCase.assetId,
      );
      const unauthorizedResult = runColdApiRequest(
        routeCase.route,
        routeCase.url,
        unauthorizedKey.api_key,
        403,
        routeCase.assetId,
      );
      expect(authorizedResult.initialTenant).toBeNull();
      expect(authorizedResult.status).toBe(routeCase.authorizedStatus);
      expect(authorizedResult.finalTenant).toBeNull();
      expect(unauthorizedResult.initialTenant).toBeNull();
      expect(unauthorizedResult.status).toBe(403);
      expect(unauthorizedResult.errorCode).toBe('FORBIDDEN');
      expect(unauthorizedResult.finalTenant).toBeNull();
    }
  }, 180_000);

  it('gates approve on quotes:approve rather than billing', async () => {
    const billingOnly = await createFixture([{ resource: 'billing', action: 'read' }]);
    const controller = new ApiQuoteController();

    // billing has no approve action, so a billing-only caller must be refused.
    await expect(
      (controller as any).checkQuoteApprovePermission(requestFor(billingOnly)),
    ).rejects.toThrow(/Cannot approve quote/);

    const approver = await createFixture([
      { resource: 'billing', action: 'read' },
      { resource: 'quotes', action: 'approve' },
    ]);

    await expect(
      (controller as any).checkQuoteApprovePermission(requestFor(approver)),
    ).resolves.toBeUndefined();
  });

  // Parity with packages/billing/src/actions/quoteActions.ts, which already gates
  // every quote operation on billing:*. Client-portal roles hold billing:read, so
  // the API admits them exactly as the server actions do -- no more, no less.
  // Per-client narrowing is a bundle concern and is not asserted here.
  it('admits client-portal billing:read holders through the coarse gate', async () => {
    const portalUser = await createFixture(
      [{ resource: 'billing', action: 'read', msp: false, client: true }],
      'client',
    );
    const controller = new ApiQuoteController();

    await expect(
      (controller as any).checkPermission(requestFor(portalUser), 'read'),
    ).resolves.toBeUndefined();

    // ...but they must not inherit the approve capability.
    await expect(
      (controller as any).checkQuoteApprovePermission(requestFor(portalUser)),
    ).rejects.toThrow(/Cannot approve quote/);
  });
});
