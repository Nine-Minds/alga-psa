import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import crypto from 'node:crypto';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';

/**
 * DB-backed grant lifecycle for the MCP Authorization Server (plan tests T004,
 * T005, T008, T017). Exercises real queries against the migrated mcp_oauth_*
 * schema: consent grants, single-use PKCE-bound auth codes, rotating refresh
 * tokens (with replay detection), and revocation. The only seam mocked is the DB
 * connection accessor, pointed at the test database.
 */
let db: Knex;

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => db),
}));

import {
  upsertGrant,
  issueAuthCode,
  consumeAuthCode,
  issueRefreshToken,
  rotateRefreshToken,
  isGrantActive,
  hasActiveConsent,
  revokeGrant,
  OAuthGrantError,
} from '@ee/lib/mcp/oauth/grants';

const HOOK_TIMEOUT = 120_000;
const TENANT_PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
let tenant = TENANT_PLACEHOLDER;
const userId = uuidv4();
const clientId = 'https://claude.ai/.well-known/oauth-client';
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';

function s256(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

describe('MCP OAuth grant lifecycle – DB integration', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    await runServerMigrations(db);
    await applyMcpOAuthMigration(db);
    tenant = await ensureTenant(db);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db) await db.destroy();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    await db('mcp_oauth_refresh_tokens').del();
    await db('mcp_oauth_auth_codes').del();
    await db('mcp_oauth_grants').del();
  }, HOOK_TIMEOUT);

  it('creates and reuses a consent grant; reports active (T017 happy)', async () => {
    const grantId = await upsertGrant({ tenant, userId, clientId, scope: 'mcp' });
    expect(grantId).toBeTruthy();
    expect(await isGrantActive(grantId)).toBe(true);
    expect(await hasActiveConsent(tenant, userId, clientId)).toBe(true);

    // Re-consent reuses the same grant row (unique on tenant+user+client).
    const again = await upsertGrant({ tenant, userId, clientId, scope: 'mcp' });
    expect(again).toBe(grantId);
    const rows = await db('mcp_oauth_grants').where({ tenant, user_id: userId, client_id: clientId });
    expect(rows).toHaveLength(1);
  });

  it('exchanges a PKCE auth code once; rejects replay + wrong verifier (T004)', async () => {
    const verifier = 'v'.repeat(64);
    const grantId = await upsertGrant({ tenant, userId, clientId });

    // Wrong verifier is rejected (guard).
    const badCode = await issueAuthCode({ grantId, tenant, userId, clientId, redirectUri, codeChallenge: s256(verifier) });
    await expect(
      consumeAuthCode({ code: badCode, redirectUri, clientId, codeVerifier: 'not-the-verifier' }),
    ).rejects.toBeInstanceOf(OAuthGrantError);

    // Correct verifier succeeds once.
    const code = await issueAuthCode({ grantId, tenant, userId, clientId, redirectUri, codeChallenge: s256(verifier) });
    const ctx = await consumeAuthCode({ code, redirectUri, clientId, codeVerifier: verifier });
    expect(ctx.grantId).toBe(grantId);
    expect(ctx.tenant).toBe(tenant);
    expect(ctx.userId).toBe(userId);

    // Replay of a consumed code fails AND revokes the grant defensively.
    await expect(
      consumeAuthCode({ code, redirectUri, clientId, codeVerifier: verifier }),
    ).rejects.toBeInstanceOf(OAuthGrantError);
    expect(await isGrantActive(grantId)).toBe(false);
  });

  it('rotates refresh tokens and detects replay (T005)', async () => {
    const grantId = await upsertGrant({ tenant, userId, clientId });
    const r1 = await issueRefreshToken(grantId, tenant);

    const rotated = await rotateRefreshToken(r1);
    expect(rotated.grant.grantId).toBe(grantId);
    expect(rotated.refreshToken).not.toBe(r1);

    // The new token works.
    const rotated2 = await rotateRefreshToken(rotated.refreshToken);
    expect(rotated2.refreshToken).not.toBe(rotated.refreshToken);

    // Reusing the original (already-consumed) token is a replay → grant revoked.
    await expect(rotateRefreshToken(r1)).rejects.toBeInstanceOf(OAuthGrantError);
    expect(await isGrantActive(grantId)).toBe(false);
  });

  it('revokes a grant; access checks then fail (T008)', async () => {
    const grantId = await upsertGrant({ tenant, userId, clientId });
    await issueRefreshToken(grantId, tenant);
    expect(await isGrantActive(grantId)).toBe(true);

    const n = await revokeGrant({ tenant, userId, grantId });
    expect(n).toBe(1);
    expect(await isGrantActive(grantId)).toBe(false);
    expect(await hasActiveConsent(tenant, userId, clientId)).toBe(false);
    // Refresh tokens for the grant are gone (guard).
    const refresh = await db('mcp_oauth_refresh_tokens').where({ grant_id: grantId });
    expect(refresh).toHaveLength(0);
  });
});

// --- harness helpers (mirrors other ee integration tests) -------------------

async function runServerMigrations(connection: Knex): Promise<void> {
  process.env.APP_ENV = process.env.APP_ENV || 'test';
  process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
  const dbUserServer = process.env.DB_USER_SERVER || 'app_user';
  const dbPasswordServer = process.env.DB_PASSWORD_SERVER || 'test_password';
  process.env.DB_USER_SERVER = dbUserServer;
  process.env.DB_PASSWORD_SERVER = dbPasswordServer;

  await connection.raw(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${dbUserServer}') THEN
        CREATE ROLE ${dbUserServer} LOGIN PASSWORD '${dbPasswordServer}';
      ELSE
        ALTER ROLE ${dbUserServer} WITH LOGIN PASSWORD '${dbPasswordServer}';
      END IF;
    END
  $$;`);
  await connection.raw('DROP SCHEMA IF EXISTS public CASCADE');
  await connection.raw('CREATE SCHEMA public');
  await connection.raw('GRANT ALL ON SCHEMA public TO public');
  await connection.raw(`GRANT ALL ON SCHEMA public TO ${process.env.DB_USER_ADMIN}`);
  await connection.raw(`GRANT ALL ON SCHEMA public TO ${dbUserServer}`);
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  await connection.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

  const migrationsDir = path.resolve(process.cwd(), '..', '..', 'server', 'migrations');
  await connection.migrate.latest({ directory: migrationsDir, loadExtensions: ['.cjs', '.js'] });
}

async function applyMcpOAuthMigration(connection: Knex): Promise<void> {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const mod = require(path.resolve(repoRoot, 'ee', 'server', 'migrations', '20260627170000_create_mcp_oauth.cjs'));
  await mod.up(connection);
}

async function ensureTenant(connection: Knex): Promise<string> {
  const row = await connection('tenants').first<{ tenant: string }>('tenant');
  if (row?.tenant) return row.tenant;
  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'MCP OAuth Test Co',
    email: 'mcp-oauth@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now(),
  });
  return newTenantId;
}
