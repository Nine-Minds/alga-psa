/**
 * Shared fixture for the service-principal DB integration tests (T014, T017-T020,
 * T023, T040): one disposable CE+EE migrated, dev-seeded database per test file,
 * a seeded tenant, humans and principals created through the real EE service, and
 * API contexts built through the real middleware -> EE boundary seam.
 *
 * Test files mock `@alga-psa/db` getConnection (and the server's db module) to
 * `harness().db` with {@link mockDbModuleFactory}; nothing else is mocked except
 * event publishing and rate limiting.
 */
import type { Knex } from 'knex';
import crypto from 'node:crypto';
import { rmSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../../../../server/test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../../../../server/test-utils/eeMigrations';

export interface Harness {
  db: Knex;
  tenant: string;
  adminRoleId: string;
  emptyRoleId: string;
  ticket: { clientId: string; boardId: string; statusId: string; priorityId: string };
  mergedDir: string;
}

let current: Harness | null = null;

export function harness(): Harness {
  if (!current) throw new Error('spHarness: boot() has not completed');
  return current;
}

/** For `vi.mock('@alga-psa/db', ...)`: replaces only the connection getters / tenant-knex resolver. */
export async function mockDbModuleFactory<T extends object>(importOriginal: () => Promise<T>) {
  const original = await importOriginal();
  const get = async () => harness().db;
  const tenantKnex = async () => ({ knex: harness().db, tenant: harness().tenant });
  return { ...original, getConnection: get, getAdminConnection: get, createTenantKnex: tenantKnex };
}

export async function boot(databaseName: string): Promise<Harness> {
  const mergedDir = buildMergedEeMigrationsDir();
  const db = await createTestDbConnection({ databaseName, migrationsDir: mergedDir });

  const discovery = tenantDb(db, '__test_discovery__');
  const q = discovery.unscoped('tickets as t', 'service-principal harness: discover seeded tenant context');
  const ctx = await q.select('t.tenant', 't.client_id', 't.board_id', 't.status_id', 't.priority_id').first();
  const tenant: string = ctx.tenant;

  const scoped = tenantDb(db, tenant);
  const admin = await scoped.table('roles').where({ role_name: 'Admin', msp: true }).first('role_id');
  const emptyRoleId = uuidv4();
  await scoped.table('roles').insert({ tenant, role_id: emptyRoleId, role_name: `NoPerms-${emptyRoleId.slice(0, 6)}`, description: 'no permissions', msp: true, client: false });
  const priority = ctx.priority_id ?? (await scoped.table('priorities').first('priority_id'))?.priority_id;

  current = {
    db,
    tenant,
    adminRoleId: admin.role_id,
    emptyRoleId,
    ticket: { clientId: ctx.client_id, boardId: ctx.board_id, statusId: ctx.status_id, priorityId: priority },
    mergedDir,
  };
  return current;
}

export async function teardown(): Promise<void> {
  if (!current) return;
  await current.db.destroy();
  rmSync(current.mergedDir, { recursive: true, force: true });
  current = null;
}

export async function createHuman(roleId: string = harness().adminRoleId, type: 'internal' | 'client' = 'internal'): Promise<string> {
  const { db, tenant } = harness();
  const user_id = uuidv4();
  await tenantDb(db, tenant).table('users').insert({
    tenant,
    user_id,
    username: `h-${user_id.slice(0, 8)}`,
    email: `h-${user_id.slice(0, 8)}@example.com`,
    first_name: 'Human',
    last_name: user_id.slice(0, 4),
    hashed_password: 'x',
    user_type: type,
    is_inactive: false,
  });
  if (type === 'internal') {
    await tenantDb(db, tenant).table('user_roles').insert({ tenant, user_id, role_id: roleId });
  }
  return user_id;
}

export interface PrincipalFixture {
  userId: string;
  apiKey: string;
  apiKeyId: string;
  keyRecord: { user_id: string; tenant: string; api_key_id: string };
}

/** A service principal (EE service, real key) holding `roleId`. */
export async function createPrincipal(opts: { allowActAs?: boolean; roleId?: string } = {}): Promise<PrincipalFixture> {
  const { db, tenant } = harness();
  const { createServicePrincipal, issueServicePrincipalKey } = await import('../../../lib/service-principals/service');
  const sp = await createServicePrincipal(db, tenant, {
    kind: 'api',
    name: `harness-${uuidv4().slice(0, 8)}`,
    allowActAs: opts.allowActAs ?? false,
    roleIds: [opts.roleId ?? harness().adminRoleId],
  });
  const key = await issueServicePrincipalKey(db, tenant, sp.user_id);
  return {
    userId: sp.user_id,
    apiKey: key.api_key,
    apiKeyId: key.api_key_id,
    keyRecord: { user_id: sp.user_id, tenant, api_key_id: key.api_key_id },
  };
}

/** Context exactly as the API middleware builds it for a key (optionally with act-as). */
export async function contextFor(principal: PrincipalFixture, actAsUserId?: string) {
  const { buildAuthenticatedApiContext } = await import('server/src/lib/api/middleware/apiMiddleware');
  const headers: Record<string, string> = { 'x-api-key': principal.apiKey };
  if (actAsUserId) headers['x-alga-act-as'] = actAsUserId;
  return buildAuthenticatedApiContext(principal.keyRecord, new Request('http://localhost/api/v1/test', { headers }));
}

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

/** An existing service catalog row for the tenant, or a minimal one. */
export async function ensureService(): Promise<string> {
  const { db, tenant } = harness();
  const scoped = tenantDb(db, tenant);
  const existing = await scoped.table('service_catalog').first('service_id');
  if (existing) return existing.service_id;
  throw new Error('spHarness.ensureService: no service_catalog row in the seeded tenant');
}

/** The REST error a thrown value maps to, exactly as `handleApiError` renders it. */
export async function restErrorOf(error: unknown): Promise<{ status: number; code: string } | null> {
  if (!error) return null;
  const { handleApiError } = await import('server/src/lib/api/middleware/apiMiddleware');
  const response = handleApiError(error);
  return { status: response.status, code: (await response.json()).error.code };
}
