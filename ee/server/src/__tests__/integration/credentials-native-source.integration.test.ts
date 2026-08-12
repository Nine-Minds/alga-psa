/**
 * Native credentials store integration tests against the REAL dev DB:
 * CRUD round-trip, tenant isolation, restricted-row hiding in list for
 * non-granted users, reveal writes a fail-closed audit, and the permission
 * seed migration is idempotent. Follows the hudu-company-mappings direct-DB
 * pattern: random tenant + cleanup, admin connection (RLS enforced by the
 * scoped queries' tenant predicates).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { config as loadDotEnv } from 'dotenv';
import type { IUserWithRoles } from '@alga-psa/types';

import { createTenantKnex, resetTenantConnectionPool, tenantDb } from '@alga-psa/db';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..', '..');

// Load the wired-in dev DB connection (server/.env.local) into the test env.
loadDotEnv({ path: path.join(repoRoot, 'server', '.env.local'), override: true });

// The native store encrypts with AES-256-GCM unless Vault Transit is configured;
// supply a test key (never NEXTAUTH_SECRET — that fallback deliberately does
// not exist).
process.env.CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY || 'integration-test-credential-key';
delete process.env.ALGA_VAULT_ADDR;
delete process.env.VAULT_ADDR;

function readPostgresPassword(): string {
  try {
    return fs.readFileSync(path.join(repoRoot, 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

/** Connect to the dev DB the same way the other direct-DB integration tests do. */
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

vi.mock('@alga-psa/core/logger', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

let db: Knex;
let tenantId: string;
let clientId: string;
let ownerUser: string;
let grantedUser: string;
let strangerUser: string;

// Deletion order matters for FKs: child rows first, then users/clients, then
// the tenant itself. `permissions` / `role_permissions` are included because
// the permission-seed idempotency test writes them for the test tenant and a
// leftover `permissions` row would block the final `tenants` delete.
const CLEANUP_TABLES = [
  'credential_access_grants',
  'credential_associations',
  'credentials',
  'role_permissions',
  'permissions',
  'audit_logs',
];

async function seedUsers(tenant: string): Promise<void> {
  const insert = (username: string): Promise<string> => {
    const userId = randomUUID();
    return db('users')
      .insert({
        tenant,
        user_id: userId,
        username,
        email: `${username}@example.test`,
        hashed_password: 'hashed_password_here',
        is_inactive: false,
        user_type: 'internal',
      })
      .returning('user_id')
      .then((rows: Array<{ user_id: string }>) => rows[0].user_id);
  };
  ownerUser = await insert('owner-user');
  grantedUser = await insert('granted-user');
  strangerUser = await insert('stranger-user');
}

/**
 * Remove every fixture the test created for a tenant. Failures PROPAGATE: a
 * broken cleanup must fail the run loudly instead of leaving debris in the
 * shared dev DB (previous versions swallowed errors and left temp tenants).
 */
async function removeTestTenantFixtures(targetTenant: string): Promise<void> {
  for (const table of CLEANUP_TABLES) {
    await db(table).where({ tenant: targetTenant }).del();
  }
  await db('users').where({ tenant: targetTenant }).del();
  await db('clients').where({ tenant: targetTenant }).del();
  await db('tenants').where({ tenant: targetTenant }).del();
}

/**
 * Per-test cleanup: clear credential rows + the permission fixtures the
 * idempotency test writes, then re-seed fresh users. The client and tenant
 * created in beforeAll are preserved across tests.
 */
async function clearPerTestFixtures(): Promise<void> {
  for (const table of CLEANUP_TABLES) {
    await db(table).where({ tenant: tenantId }).del();
  }
  await seedUsers(tenantId);
}

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

import {
  NativeCredentialSource,
  nativeCredentialSource,
} from '../../lib/credentials/nativeSource';
import { resetCredentialAesKeyCache } from '../../lib/credentials/encryption';

describe('native credentials store — DB integration', () => {
  const HOOK_TIMEOUT = 120_000;

  beforeAll(async () => {
    db = await createDevDb();
    await db.raw('select 1');

    tenantId = randomUUID();
    await db('tenants').insert({
      tenant: tenantId,
      client_name: 'Credentials Integration Tenant',
      email: `credentials-it-${tenantId}@example.test`,
    });
    const [client] = await db('clients')
      .insert({ tenant: tenantId, client_name: 'Acme Corp' })
      .returning('client_id');
    clientId = client.client_id;
    await seedUsers(tenantId);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    try {
      if (db && tenantId) {
        await removeTestTenantFixtures(tenantId);
      }
    } finally {
      await db?.destroy();
    }
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await clearPerTestFixtures();
  });

  it('creates an encrypted row and lists only rows the user may see', async () => {
    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'Domain Admin', username: 'admin@example.com', password: 'P@ssw0rd!', url: 'https://portal.example.com' }
    );

    expect(summary).toMatchObject({
      source: 'alga',
      clientId,
      name: 'Domain Admin',
      username: 'admin@example.com',
      isRestricted: false,
    });
    // The summary never carries the plaintext.
    expect(JSON.stringify(summary)).not.toContain('P@ssw0rd!');

    const rows = await db('credentials').where({ tenant: tenantId, credential_id: summary.id });
    expect(rows).toHaveLength(1);
    // Ciphertext only — never plaintext in the DB.
    expect(String(rows[0].password_ciphertext)).not.toContain('P@ssw0rd!');
    expect(['vault-transit:v1', 'aes-256-gcm:v1']).toContain(rows[0].encryption_scheme);
  });

  it('hides restricted rows from non-granted users in list/search', async () => {
    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'Secret Router Admin', password: 'hunter2' }
    );

    // Restrict to the granted user.
    await source.setRestriction(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id,
      { isRestricted: true, grants: [{ subjectType: 'user', subjectId: grantedUser }] }
    );

    // Owner sees it.
    const ownerList = await source.list(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { search: 'Router' }
    );
    expect(ownerList.map((row) => row.id)).toContain(summary.id);

    // Granted user sees it.
    const grantedList = await source.list(
      { tenant: tenantId, userId: grantedUser, user: userFor(grantedUser) },
      { search: 'Router' }
    );
    expect(grantedList.map((row) => row.id)).toContain(summary.id);

    // Stranger sees nothing — hidden entirely, not shown-but-locked.
    const strangerList = await source.list(
      { tenant: tenantId, userId: strangerUser, user: userFor(strangerUser) },
      { search: 'Router' }
    );
    expect(strangerList).toHaveLength(0);

    // And an unrestricted credential is visible to everyone.
    const open = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'Public Printer Login', password: 'open' }
    );
    const openList = await source.list(
      { tenant: tenantId, userId: strangerUser, user: userFor(strangerUser) },
      { search: 'Printer' }
    );
    expect(openList.map((row) => row.id)).toContain(open.id);
  });

  it('reveals only to an authorized user and writes a fail-closed audit row', async () => {
    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'VPN Gateway', password: 'vpn-secret' }
    );

    // Owner reveal succeeds and writes an audit row.
    const reveal = await source.reveal(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id
    );
    expect(reveal.state).toBe('ok');
    expect(reveal.password).toBe('vpn-secret');

    const audits = await db('audit_logs')
      .where({ tenant: tenantId })
      .where('operation', 'credential_reveal');
    expect(audits.length).toBeGreaterThan(0);
    // Audit details never contain the value.
    for (const audit of audits) {
      expect(JSON.stringify(audit)).not.toContain('vpn-secret');
    }
  });

  it('rejects reveal to a user with no grant on a restricted row', async () => {
    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'Root Password', password: 'root-secret' }
    );
    await source.setRestriction(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id,
      { isRestricted: true, grants: [] }
    );

    const reveal = await source.reveal(
      { tenant: tenantId, userId: strangerUser, user: userFor(strangerUser) },
      summary.id
    );
    expect(reveal.state).toBe('no_access');
    expect(reveal.password).toBeUndefined();
  });

  it('getDetail hides restricted rows from non-granted users (no metadata or grant-list leak)', async () => {
    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      {
        clientId,
        name: 'Hidden Detail',
        username: 'root@hidden',
        url: 'https://hidden.local',
        description: 'classified notes',
        password: 'x',
      }
    );
    await source.setRestriction(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id,
      { isRestricted: true, grants: [{ subjectType: 'user', subjectId: grantedUser }] }
    );

    // Granted user sees metadata + the grant list.
    const grantedDetail = await source.getDetail(
      { tenant: tenantId, userId: grantedUser, user: userFor(grantedUser) },
      summary.id
    );
    expect(grantedDetail).not.toBeNull();
    expect(grantedDetail?.name).toBe('Hidden Detail');
    expect(grantedDetail?.grants).toEqual([{ subjectType: 'user', subjectId: grantedUser }]);

    // Stranger gets null — existence is never confirmed, no metadata/grant leak.
    const strangerDetail = await source.getDetail(
      { tenant: tenantId, userId: strangerUser, user: userFor(strangerUser) },
      summary.id
    );
    expect(strangerDetail).toBeNull();
  });

  it('restricted rows cannot be un-restricted or mutated by users without a grant', async () => {
    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'Escalation Target', password: 'root-secret' }
    );
    await source.setRestriction(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id,
      { isRestricted: true, grants: [] }
    );

    const stranger = { tenant: tenantId, userId: strangerUser, user: userFor(strangerUser) };

    // Un-restrict escalation attempt behaves as not_found (no existence leak).
    await expect(
      source.setRestriction(stranger, summary.id, { isRestricted: false, grants: [] })
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });

    // update / remove / setAssociations on a row the caller cannot see also fail.
    await expect(source.update(stranger, summary.id, { name: 'Renamed' })).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });
    await expect(
      source.setAssociations(stranger, summary.id, { assetIds: [] })
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' });
    await expect(source.remove(stranger, summary.id)).rejects.toMatchObject({
      code: 'CREDENTIAL_NOT_FOUND',
    });

    // The row is untouched and still restricted.
    const row = await db('credentials').where({ tenant: tenantId, credential_id: summary.id }).first();
    expect(row.is_restricted).toBe(true);
    expect(row.name).toBe('Escalation Target');
  });

  it('re-encrypts BOTH value fields under the new scheme on a single-field edit (scheme transition safe)', async () => {
    // Create under the AES scheme (no Vault Transit configured).
    delete process.env.ALGA_VAULT_ADDR;
    delete process.env.VAULT_ADDR;
    resetCredentialAesKeyCache();

    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'Scheme Transition Row', password: 'old-password', otpSecret: 'JBSWY3DPEHPK3PXP' }
    );

    let row = await db('credentials').where({ tenant: tenantId, credential_id: summary.id }).first();
    expect(row.encryption_scheme).toBe('aes-256-gcm:v1');

    // Switch the ambient write scheme to Vault Transit (mocked HTTP round-trip).
    process.env.ALGA_VAULT_ADDR = 'https://vault.example.test';
    process.env.ALGA_VAULT_TOKEN = 'vault-token';
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
      if (String(url).includes('/encrypt/')) {
        const plaintext = Buffer.from(body.plaintext as string, 'base64').toString('utf8');
        return new Response(
          JSON.stringify({
            data: { ciphertext: `vault:v1:${Buffer.from(plaintext, 'utf8').toString('base64')}` },
          }),
          { status: 200 }
        );
      }
      if (String(url).includes('/decrypt/')) {
        const plaintext = Buffer.from(String(body.ciphertext ?? '').replace(/^vault:v1:/, ''), 'base64').toString('utf8');
        return new Response(
          JSON.stringify({ data: { plaintext: Buffer.from(plaintext, 'utf8').toString('base64') } }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      // Edit ONLY the password; the OTP seed is left unchanged.
      await source.update(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        summary.id,
        { password: 'rotated-password' }
      );

      row = await db('credentials').where({ tenant: tenantId, credential_id: summary.id }).first();
      expect(row.encryption_scheme).toBe('vault-transit:v1');
      expect(String(row.password_ciphertext)).toMatch(/^vault:v1:/);
      // The unchanged OTP seed was re-encrypted under the NEW scheme too.
      expect(String(row.otp_secret_ciphertext)).toMatch(/^vault:v1:/);

      // Both fields still decrypt under the new scheme (no silent loss).
      const reveal = await source.reveal(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        summary.id
      );
      expect(reveal.state).toBe('ok');
      expect(reveal.password).toBe('rotated-password');
      expect(reveal.otpCode?.code).toMatch(/^\d{6}$/);
    } finally {
      delete process.env.ALGA_VAULT_ADDR;
      delete process.env.VAULT_ADDR;
      vi.unstubAllGlobals();
      resetCredentialAesKeyCache();
    }
  });

  it('update re-encrypts values and delete removes the row + audit trails', async () => {
    const source = new NativeCredentialSource();
    const summary = await source.create(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      { clientId, name: 'Backup Account', password: 'old-password' }
    );

    const updated = await source.update(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id,
      { password: 'new-password', name: 'Backup Account (rotated)' }
    );
    expect(updated.name).toBe('Backup Account (rotated)');

    const reveal = await source.reveal(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id
    );
    expect(reveal.password).toBe('new-password');

    await source.remove(
      { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
      summary.id
    );
    const rows = await db('credentials').where({ tenant: tenantId, credential_id: summary.id });
    expect(rows).toHaveLength(0);
  });

  it('isolates rows across tenants (no cross-tenant leakage)', async () => {
    const otherTenant = randomUUID();
    const otherClient = randomUUID();
    await db('tenants').insert({
      tenant: otherTenant,
      client_name: 'Other Tenant',
      email: `other-${otherTenant}@example.test`,
    });
    await db('clients').insert({ tenant: otherTenant, client_id: otherClient, client_name: 'Other Client' });
    const otherUserId = randomUUID();
    await db('users').insert({
      tenant: otherTenant,
      user_id: otherUserId,
      username: 'other-tenant-user',
      email: `other-user-${otherTenant}@example.test`,
      hashed_password: 'hashed_password_here',
      is_inactive: false,
      user_type: 'internal',
    });

    try {
      const otherSource = new NativeCredentialSource();
      const otherSummary = await otherSource.create(
        { tenant: otherTenant, userId: otherUserId, user: userFor(otherUserId) },
        { clientId: otherClient, name: 'Other Tenant Secret', password: 'other-secret' }
      );

      // Listing from the primary tenant never surfaces the other tenant's row.
      const primaryList = await nativeCredentialSource.list(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        {}
      );
      expect(primaryList.map((row) => row.id)).not.toContain(otherSummary.id);
    } finally {
      await removeTestTenantFixtures(otherTenant);
    }
  });

  it('the permission seed migration is idempotent', async () => {
    const migration = require(
      path.resolve(repoRoot, 'server', 'migrations', '20260811110000_add_credential_permissions.cjs')
    );
    await migration.up(db);
    await migration.up(db);

    const count = await db('permissions').where({ tenant: tenantId, resource: 'credential' }).count('* as c').first();
    expect(Number(count?.c)).toBe(5);
  });

  it('serves credential reads/writes on a NON-superuser pooled connection with no app.current_tenant GUC (prod parity)', async () => {
    // Regression for the RLS removal: the app connects as a non-superuser
    // through pooled connections where `app.current_tenant` may be unset. With
    // the old RLS policies this failed with "unrecognized configuration
    // parameter"; now the credential tables have no RLS and the tenantDb
    // facade carries the tenant predicate instead. This test drives the REAL
    // NativeCredentialSource over a dedicated non-superuser role connection
    // with the GUC never set, proving pooled prod connections work.
    const roleName = `credentials_it_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const rolePassword = `it-${randomUUID().replace(/-/g, '')}`;

    // Create a dedicated non-superuser role (LOGIN, no superuser, no RLS bypass).
    await db.raw(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await db.raw(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
    // Broad app-like privileges so the full source path (kernel bundle reads,
    // client names, grants, audit) can run — mirrors what app_user effectively
    // has in dev; the role is dropped at the end of the test.
    await db.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${roleName}"`);

    // Point the tenant pool at the non-superuser role and reset the cached pool
    // so createTenantKnex() inside the source connects as that role. The dev
    // stack routes the app pool through pgbouncer (port 6472) whose auth_file
    // only lists known roles, so the fresh role connects DIRECTLY to postgres
    // (port 5472) — still a real non-superuser application connection.
    const prevUser = process.env.DB_USER_SERVER;
    const prevPassword = process.env.DB_PASSWORD_SERVER;
    const prevPort = process.env.DB_PORT;
    try {
      process.env.DB_USER_SERVER = roleName;
      process.env.DB_PASSWORD_SERVER = rolePassword;
      process.env.DB_PORT = String(process.env.DB_PORT === '6472' ? '5472' : process.env.DB_PORT ?? '5432');
      await resetTenantConnectionPool();

      // Prove the pool is genuinely non-superuser and the GUC is unset.
      const probe = await createTenantKnex(tenantId);
      const who = await probe.knex.raw('select current_user as u, current_setting(\'app.current_tenant\', true) as guc');
      expect(String(who.rows[0].u)).toBe(roleName);
      expect(who.rows[0].guc).toBeNull();

      const source = new NativeCredentialSource();
      const summary = await source.create(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        { clientId, name: 'Non-Superuser Row', password: 'plain-prod-value' }
      );

      const list = await source.list(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        { search: 'Non-Superuser' }
      );
      expect(list.map((row) => row.id)).toContain(summary.id);

      const reveal = await source.reveal(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        summary.id
      );
      expect(reveal.state).toBe('ok');
      expect(reveal.password).toBe('plain-prod-value');

      await source.update(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        summary.id,
        { name: 'Non-Superuser Row (rotated)' }
      );
      await source.remove(
        { tenant: tenantId, userId: ownerUser, user: userFor(ownerUser) },
        summary.id
      );
      const gone = await db('credentials').where({ tenant: tenantId, credential_id: summary.id });
      expect(gone).toHaveLength(0);
    } finally {
      // Restore the app_user pool + env so other tests in this file and any
      // later file in the same worker keep using the normal connection.
      if (prevUser === undefined) delete process.env.DB_USER_SERVER;
      else process.env.DB_USER_SERVER = prevUser;
      if (prevPassword === undefined) delete process.env.DB_PASSWORD_SERVER;
      else process.env.DB_PASSWORD_SERVER = prevPassword;
      if (prevPort === undefined) delete process.env.DB_PORT;
      else process.env.DB_PORT = prevPort;
      await resetTenantConnectionPool();
      // Revoke the granted privileges first — a role with outstanding grants
      // cannot be dropped ("objects depend on it").
      await db.raw(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${roleName}"`).catch(() => undefined);
      await db.raw(`REVOKE ALL ON SCHEMA public FROM "${roleName}"`).catch(() => undefined);
      await db.raw(`DROP ROLE IF EXISTS "${roleName}"`);
    }
  });
});
