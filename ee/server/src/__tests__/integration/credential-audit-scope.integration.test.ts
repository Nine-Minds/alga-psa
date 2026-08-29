/**
 * Credential audit reader integration tests against the REAL dev DB.
 *
 * Security core of the audit screen: the vault-wide read-scope is the
 * credential read-scope, never weaker. A restricted credential's activity is
 * visible only to its owner/grantees (not to other `credential:audit`
 * holders), Hudu activity is visible only to viewers whose bundle scope
 * admits the owning client, and a user without `credential:audit` is refused
 * outright. Also covers keyset pagination, per-credential history ordering,
 * filters, actor/name resolution, and the value-free enrichment deltas.
 *
 * The action's withAuth/tier wrappers are shimmed (real `hasPermission` runs
 * against the DB); every other dependency is real.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { config as loadDotEnv } from 'dotenv';
import type { IUserWithRoles } from '@alga-psa/types';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..', '..');

loadDotEnv({ path: path.join(repoRoot, 'server', '.env.local'), override: true });

const priorCredentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Shim withAuth so the action can be driven with an explicit user; keep the
// real hasPermission (DB-backed). Tier gating is unit-tested elsewhere.
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  withAuth: (handler: (user: unknown, context: unknown, ...args: unknown[]) => Promise<unknown>) =>
    (user: unknown, context: unknown, ...args: unknown[]) => handler(user, context, ...args),
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: vi.fn(async () => undefined),
  TierAccessError: class extends Error {},
}));

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { getCredentialAuditEvents } from '@ee/lib/actions/credentials/credentialAuditActions';
import type { CredentialAuditFilter, CredentialAuditPage } from '@ee/lib/actions/credentials/credentialAuditActions';
import { writeCredentialAudit } from '@ee/lib/credentials/audit';
import { writeHuduPasswordRevealAudit } from '@ee/lib/integrations/hudu/revealAudit';
import { auditLog } from 'server/src/lib/logging/auditLog';
import { NativeCredentialSource } from '@ee/lib/credentials/nativeSource';

// The real withAuth wrapper exposes a 1-arg client signature; the test drives
// the action with an explicit user/context, so cast to the internal shape.
const callAudit = getCredentialAuditEvents as unknown as (
  user: IUserWithRoles,
  context: { tenant: string },
  input?: CredentialAuditFilter
) => Promise<CredentialAuditPage>;

function readPostgresPassword(): string {
  try {
    return fs.readFileSync(path.join(repoRoot, 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

async function createDevDb(): Promise<Knex> {
  return knexFactory({
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER_ADMIN || 'postgres',
      password: readPostgresPassword(),
      database: process.env.DB_NAME_SERVER || 'server',
    },
    pool: { min: 1, max: 1 },
  });
}

const CLEANUP_TABLES = [
  'authorization_bundle_assignments',
  'authorization_bundle_rules',
  'authorization_bundle_revisions',
  'authorization_bundles',
  'credential_access_grants',
  'credential_associations',
  'credentials',
  'role_permissions',
  'user_roles',
  'permissions',
  'audit_logs',
];

let db: Knex;
let tenantId: string;
let clientX: string;
let clientY: string;
let userA: string;
let userB: string;
let strangerId: string;
let roleId: string;
let permAuditId: string;
let permReadId: string;

function userFor(userId: string): IUserWithRoles {
  return {
    user_id: userId,
    tenant: tenantId,
    username: userId,
    email: `${userId}@example.test`,
    is_inactive: false,
    user_type: 'internal',
    roles: [],
  };
}

async function seedUser(username: string): Promise<string> {
  const userId = randomUUID();
  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username,
    email: `${username}@example.test`,
    hashed_password: 'hashed_password_here',
    is_inactive: false,
    user_type: 'internal',
  });
  return userId;
}

/** Grant credential:read + credential:audit to a user through one MSP role. */
async function grantCredentialAudit(userId: string): Promise<void> {
  await db('user_roles').insert({ tenant: tenantId, role_id: roleId, user_id: userId });
}

/** (Re)create the permission + role_permission fixtures (wiped per test). */
async function provisionPermissionFixtures(): Promise<void> {
  await db('permissions')
    .where({ tenant: tenantId, resource: 'credential' })
    .whereIn('action', ['audit', 'read'])
    .del();
  await db('role_permissions').where({ tenant: tenantId, role_id: roleId }).del();
  const [permAudit] = await db('permissions')
    .insert({
      tenant: tenantId,
      resource: 'credential',
      action: 'audit',
      msp: true,
      client: false,
      description: 'test audit',
    })
    .returning('permission_id');
  const [permRead] = await db('permissions')
    .insert({
      tenant: tenantId,
      resource: 'credential',
      action: 'read',
      msp: true,
      client: false,
      description: 'test read',
    })
    .returning('permission_id');
  permAuditId = permAudit.permission_id;
  permReadId = permRead.permission_id;
  await db('role_permissions').insert([
    { tenant: tenantId, role_id: roleId, permission_id: permAuditId },
    { tenant: tenantId, role_id: roleId, permission_id: permReadId },
  ]);
}

/**
 * (Re)create the authorization bundle narrowing user B's `credential:read` to
 * client Y only. The bundle↔published-revision FK is circular, so the bundle
 * is created with no revision, then pointed at the published revision.
 */
async function provisionBundleFixtures(): Promise<void> {
  const bundleId = randomUUID();
  const revisionId = randomUUID();
  await db('authorization_bundles').insert({
    tenant: tenantId,
    bundle_id: bundleId,
    bundle_key: `audit-test-${bundleId}`,
    name: `Audit Test Bundle ${bundleId}`,
    status: 'active',
    published_revision_id: null,
  });
  await db('authorization_bundle_revisions').insert({
    tenant: tenantId,
    revision_id: revisionId,
    bundle_id: bundleId,
    revision_number: 1,
    lifecycle_state: 'published',
    published_at: new Date(),
  });
  await db('authorization_bundles')
    .where({ tenant: tenantId, bundle_id: bundleId })
    .update({ published_revision_id: revisionId });
  await db('authorization_bundle_rules').insert({
    tenant: tenantId,
    rule_id: randomUUID(),
    bundle_id: bundleId,
    revision_id: revisionId,
    resource_type: 'credential',
    action: 'read',
    template_key: 'selected_clients',
    effect: 'narrow',
    config: { selectedClientIds: [clientY] },
  });
  await db('authorization_bundle_assignments').insert({
    tenant: tenantId,
    assignment_id: randomUUID(),
    bundle_id: bundleId,
    target_type: 'user',
    target_id: userB,
    status: 'active',
  });
}

async function clearPerTestFixtures(): Promise<void> {
  // The bundle↔published-revision FK is circular; detach it before deleting.
  await db('authorization_bundles')
    .where({ tenant: tenantId })
    .update({ published_revision_id: null })
    .catch(() => undefined);
  for (const table of CLEANUP_TABLES) {
    await db(table).where({ tenant: tenantId }).del();
  }
  await provisionPermissionFixtures();
  await provisionBundleFixtures();
  // Re-grant the roles after the cleanup wipes user_roles.
  await grantCredentialAudit(userA);
  await grantCredentialAudit(userB);
}

async function removeTestTenantFixtures(targetTenant: string): Promise<void> {
  // The bundle↔published-revision FK is circular; detach it before deleting.
  await db('authorization_bundles')
    .where({ tenant: targetTenant })
    .update({ published_revision_id: null })
    .catch(() => undefined);
  for (const table of CLEANUP_TABLES) {
    await db(table).where({ tenant: targetTenant }).del();
  }
  await db('roles').where({ tenant: targetTenant }).del();
  await db('users').where({ tenant: targetTenant }).del();
  await db('clients').where({ tenant: targetTenant }).del();
  await db('tenants').where({ tenant: targetTenant }).del();
}

describe('credential audit reader — scope + paging + enrichment', () => {
  const HOOK_TIMEOUT = 120_000;

  beforeAll(async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = priorCredentialEncryptionKey ?? 'audit-scope-integration-key';
    db = await createDevDb();
    await db.raw('select 1');

    tenantId = randomUUID();
    await db('tenants').insert({
      tenant: tenantId,
      client_name: 'Audit Scope Integration Tenant',
      email: `audit-it-${tenantId}@example.test`,
    });
    const [x] = await db('clients').insert({ tenant: tenantId, client_name: 'Client X' }).returning('client_id');
    const [y] = await db('clients').insert({ tenant: tenantId, client_name: 'Client Y' }).returning('client_id');
    clientX = x.client_id;
    clientY = y.client_id;

    userA = await seedUser('audit-user-a');
    userB = await seedUser('audit-user-b');
    strangerId = await seedUser('audit-stranger');

    const [role] = await db('roles')
      .insert({
        tenant: tenantId,
        role_name: `Audit Test ${randomUUID().slice(0, 8)}`,
        description: 'test role',
        msp: true,
        client: false,
      })
      .returning('role_id');
    roleId = role.role_id;
    await provisionPermissionFixtures();
    await provisionBundleFixtures();

    await grantCredentialAudit(userA);
    await grantCredentialAudit(userB);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      if (db && tenantId) {
        await removeTestTenantFixtures(tenantId);
      }
    } finally {
      if (priorCredentialEncryptionKey === undefined) {
        delete process.env.CREDENTIAL_ENCRYPTION_KEY;
      } else {
        process.env.CREDENTIAL_ENCRYPTION_KEY = priorCredentialEncryptionKey;
      }
      await db?.destroy();
    }
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearPerTestFixtures();
  });

  async function fixtureCredentials(): Promise<{
    restrictedId: string;
    openId: string;
    huduRef: string;
  }> {
    const source = new NativeCredentialSource();
    const ctxA = { tenant: tenantId, userId: userA, user: userFor(userA) };

    const restricted = await source.create(ctxA, {
      clientId: clientX,
      name: 'Restricted Router',
      password: 'restricted-secret',
    });
    await source.setRestriction(ctxA, restricted.id, {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: userA }],
    });

    const open = await source.create(ctxA, {
      clientId: clientY,
      name: 'Open Printer',
      password: 'open-secret',
    });

    // Reveals produce the credential_reveal audit rows the filters exercise.
    await source.reveal(ctxA, restricted.id);
    await source.reveal(ctxA, open.id);

    const huduRef = 'hudu:101:42';
    await writeCredentialAudit(db, tenantId, 'credential_created', {
      userId: userA,
      credentialId: huduRef,
      clientId: clientX,
    });
    await writeHuduPasswordRevealAudit(db, tenantId, {
      userId: userA,
      clientId: clientX,
      huduPasswordId: 42,
      huduCompanyId: 101,
    });

    return { restrictedId: restricted.id, openId: open.id, huduRef };
  }

  it('refuses a caller without credential:audit outright', async () => {
    await fixtureCredentials();
    await expect(
      callAudit(userFor(strangerId), { tenant: tenantId }, {})
    ).rejects.toThrow(/insufficient permissions/);
  });

  it('scopes the vault-wide log to the credential read-scope (native restricted + Hudu client scope)', async () => {
    const { restrictedId, openId } = await fixtureCredentials();

    // User A (owner/grantee, no bundle) sees everything.
    const aPage = await callAudit(userFor(userA), { tenant: tenantId }, {});
    const aCredentialIds = aPage.events.map((event) => event.credentialId);
    expect(aCredentialIds).toContain(restrictedId);
    expect(aCredentialIds).toContain(openId);
    expect(aCredentialIds).toContain('hudu:101:42');
    const huduReveal = aPage.events.find((event) => event.operation === 'hudu_password_reveal');
    expect(huduReveal).toBeDefined();
    expect(huduReveal!.clientId).toBe(clientX);

    // User B (bundle narrows credential:read to client Y) sees the open row
    // but not the restricted credential's activity nor client X's Hudu rows.
    const bPage = await callAudit(userFor(userB), { tenant: tenantId }, {});
    const bCredentialIds = bPage.events.map((event) => event.credentialId);
    expect(bCredentialIds).toContain(openId);
    expect(bCredentialIds).not.toContain(restrictedId);
    expect(bCredentialIds).not.toContain('hudu:101:42');
    expect(bPage.events.find((event) => event.operation === 'hudu_password_reveal')).toBeUndefined();
  });

  it('includes hudu_password_reveal rows in a Hudu credential per-credential History', async () => {
    const { huduRef } = await fixtureCredentials();

    // User A (may read client X) sees the Hudu reveal in the credential's own
    // History, matched through the raw hudu_company_id/hudu_password_id
    // details rather than record_id (reveal rows store the client id there).
    const aHistory = await callAudit(userFor(userA), { tenant: tenantId }, { credentialId: huduRef });
    const aOperations = aHistory.events.map((event) => event.operation);
    expect(aOperations).toContain('credential_created');
    expect(aOperations).toContain('hudu_password_reveal');
    const reveal = aHistory.events.find((event) => event.operation === 'hudu_password_reveal');
    expect(reveal).toBeDefined();
    expect(reveal!.credentialId).toBe('hudu:101:42');
    expect(reveal!.clientId).toBe(clientX);

    // User B cannot read client X, so the Hudu credential's History is empty —
    // the per-credential match never bypasses the read scope.
    const bHistory = await callAudit(userFor(userB), { tenant: tenantId }, { credentialId: huduRef });
    expect(bHistory.events).toHaveLength(0);
  });

  it('filters by operation, actor, client, and date range; keyset pagination is stable', async () => {
    const { restrictedId } = await fixtureCredentials();

    const allA = await callAudit(userFor(userA), { tenant: tenantId }, {});

    // Operation filter.
    const reveals = await callAudit(
      userFor(userA),
      { tenant: tenantId },
      { operations: ['credential_reveal'] }
    );
    expect(reveals.events.length).toBeGreaterThan(0);
    expect(reveals.events.every((event) => event.operation === 'credential_reveal')).toBe(true);

    // Actor filter.
    const byA = await callAudit(
      userFor(userA),
      { tenant: tenantId },
      { actorUserId: userA }
    );
    expect(byA.events.length).toBeGreaterThan(0);
    expect(byA.events.every((event) => event.actor.userId === userA)).toBe(true);

    // Client filter (native rows via details->>client_id, Hudu reveals via record_id).
    const xClient = await callAudit(
      userFor(userA),
      { tenant: tenantId },
      { clientId: clientX }
    );
    expect(xClient.events.length).toBeGreaterThan(0);
    expect(xClient.events.every((event) => event.clientId === clientX)).toBe(true);

    // Per-credential history is newest-first and strictly-scoped.
    const history = await callAudit(
      userFor(userA),
      { tenant: tenantId },
      { credentialId: restrictedId }
    );
    expect(history.events.length).toBeGreaterThanOrEqual(1);
    expect(history.events.every((event) => event.credentialId === restrictedId)).toBe(true);
    const timestamps = history.events.map((event) => new Date(event.timestamp).getTime());
    expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);

    // Keyset pagination: page through with limit 2 and confirm a stable,
    // non-overlapping sequence that reconstructs the full set.
    const page1 = await callAudit(userFor(userA), { tenant: tenantId }, { limit: 2 });
    expect(page1.events).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await callAudit(
      userFor(userA),
      { tenant: tenantId },
      { limit: 2, cursor: page1.nextCursor }
    );
    expect(page2.events).toHaveLength(2);
    const page1Ids = page1.events.map((event) => event.auditId);
    const page2Ids = page2.events.map((event) => event.auditId);
    expect(page2Ids).not.toEqual(page1Ids);
    expect([...page1Ids, ...page2Ids]).toEqual([...new Set([...page1Ids, ...page2Ids])]);
    expect(allA.events.map((event) => event.auditId).slice(0, 4)).toEqual([...page1Ids, ...page2Ids]);
  });

  it('resolves actor names and enrichment deltas (changed fields + grant counts, never values)', async () => {
    const source = new NativeCredentialSource();
    const ctxA = { tenant: tenantId, userId: userA, user: userFor(userA) };

    // Give user A a display name so the actor resolution is exercised.
    await db('users').where({ tenant: tenantId, user_id: userA }).update({ first_name: 'Alice', last_name: 'Example' });

    const created = await source.create(ctxA, {
      clientId: clientY,
      name: 'Enrich Me',
      username: 'old@example.com',
      password: 'enrich-secret',
    });

    await source.update(ctxA, created.id, {
      name: 'Enrich Me',
      username: 'new@example.com',
      password: 'rotated-secret',
    });

    await source.setRestriction(ctxA, created.id, {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: userA }],
    });
    await source.setRestriction(ctxA, created.id, {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: userA }, { subjectType: 'user', subjectId: userB }],
    });
    await source.setRestriction(ctxA, created.id, {
      isRestricted: true,
      grants: [{ subjectType: 'user', subjectId: userB }],
    });

    const result = await callAudit(
      userFor(userA),
      { tenant: tenantId },
      { credentialId: created.id }
    );
    const events = result.events;

    const updated = events.find((event) => event.operation === 'credential_updated');
    expect(updated).toBeDefined();
    expect(updated!.changedFields).toEqual(['username', 'password']);

    const grantsEvents = events.filter((event) => event.operation === 'credential_grants_changed');
    // Newest-first: B-only replace (removed 1), A+B (added 1), A-only (added 1).
    expect(grantsEvents[0]!.grantsDelta).toEqual({ added: 0, removed: 1 });
    expect(grantsEvents[1]!.grantsDelta).toEqual({ added: 1, removed: 0 });
    expect(grantsEvents[2]!.grantsDelta).toEqual({ added: 1, removed: 0 });

    // Actor resolution: the events carry the resolved display name.
    expect(events.every((event) => event.actor.userId === userA)).toBe(true);
    expect(events.every((event) => event.actor.name === 'Alice Example')).toBe(true);

    // No value ever leaves the action.
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('enrich-secret');
    expect(serialized).not.toContain('rotated-secret');
  });

  it('system and removed actors resolve to the label sentinels (null name)', async () => {
    const source = new NativeCredentialSource();
    const ctxA = { tenant: tenantId, userId: userA, user: userFor(userA) };
    const open = await source.create(ctxA, { clientId: clientY, name: 'Actor Sentinel Row', password: 'x' });

    await writeCredentialAudit(db, tenantId, 'credential_created', {
      userId: randomUUID(), // removed user — no row in users
      credentialId: open.id,
      clientId: clientY,
    });
    // A system action (no user) through the shared auditLog helper, which is
    // how the writer produces a NULL user_id row (the trigger stamps tenant).
    await db.transaction(async (trx) => {
      await trx.raw('select set_config(?, ?, true)', ['app.current_tenant', tenantId]);
      await auditLog(trx, {
        userId: undefined,
        operation: 'credential_created',
        tableName: 'credentials',
        recordId: open.id,
        changedData: {},
        details: { integration: 'alga', tenant: tenantId, credential_id: open.id, client_id: clientY },
      });
    });

    const result = await callAudit(userFor(userA), { tenant: tenantId }, {});
    const events = result.events;
    const removed = events.find((event) => event.actor.userId !== null && event.actor.name === null);
    expect(removed).toBeDefined();
    const system = events.find((event) => event.actor.userId === null);
    expect(system).toBeDefined();
  });
});
