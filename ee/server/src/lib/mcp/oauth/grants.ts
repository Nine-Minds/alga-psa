import crypto from 'node:crypto';
import { getConnection } from '@/lib/db/db';
import { AUTH_CODE_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from './tokens';

/**
 * Grant lifecycle for the MCP Authorization Server: consent records (grants),
 * single-use authorization codes, and rotating refresh tokens. Access tokens are
 * stateless JWTs; the grant row is the revocation anchor the resource server
 * checks. All opaque secrets are stored hashed (sha256).
 */

export class OAuthGrantError extends Error {
  constructor(
    public readonly code: string, // OAuth error code (invalid_grant, ...)
    message: string,
  ) {
    super(message);
    this.name = 'OAuthGrantError';
  }
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function opaque(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface GrantContext {
  grantId: string;
  tenant: string;
  userId: string;
  clientId: string;
  scope: string | null;
  resource: string | null;
}

/** Create or reuse the (tenant, user, client) consent grant; un-revoke on re-consent. */
export async function upsertGrant(params: {
  tenant: string;
  userId: string;
  clientId: string;
  scope?: string | null;
  resource?: string | null;
}): Promise<string> {
  const knex = await getConnection(null);
  const existing = await knex('mcp_oauth_grants')
    .where({ tenant: params.tenant, user_id: params.userId, client_id: params.clientId })
    .first();
  if (existing) {
    await knex('mcp_oauth_grants')
      .where({ grant_id: existing.grant_id })
      .update({
        revoked_at: null,
        scope: params.scope ?? existing.scope,
        resource: params.resource ?? existing.resource,
        consented_at: knex.fn.now(),
      });
    return existing.grant_id;
  }
  const [row] = await knex('mcp_oauth_grants')
    .insert({
      tenant: params.tenant,
      user_id: params.userId,
      client_id: params.clientId,
      scope: params.scope ?? null,
      resource: params.resource ?? null,
    })
    .returning('grant_id');
  return typeof row === 'string' ? row : row.grant_id;
}

/** Whether a grant exists and is not revoked (resource-server revocation check). */
export async function isGrantActive(grantId: string): Promise<boolean> {
  const knex = await getConnection(null);
  const row = await knex('mcp_oauth_grants').where({ grant_id: grantId }).first();
  return Boolean(row && !row.revoked_at);
}

/** Whether the user has an active consent grant for this client (skip re-consent). */
export async function hasActiveConsent(tenant: string, userId: string, clientId: string): Promise<boolean> {
  const knex = await getConnection(null);
  const row = await knex('mcp_oauth_grants')
    .where({ tenant, user_id: userId, client_id: clientId })
    .whereNull('revoked_at')
    .first();
  return Boolean(row);
}

/** Issue a single-use authorization code bound to the grant + PKCE challenge. */
export async function issueAuthCode(params: {
  grantId: string;
  tenant: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource?: string | null;
  scope?: string | null;
}): Promise<string> {
  const knex = await getConnection(null);
  const code = opaque();
  await knex('mcp_oauth_auth_codes').insert({
    code_hash: sha256(code),
    grant_id: params.grantId,
    tenant: params.tenant,
    user_id: params.userId,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    resource: params.resource ?? null,
    scope: params.scope ?? null,
    expires_at: knex.raw(`now() + (? * interval '1 second')`, [AUTH_CODE_TTL_SECONDS]),
  });
  return code;
}

/** Exchange + invalidate an authorization code (single-use, PKCE-verified). */
export async function consumeAuthCode(params: {
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
}): Promise<GrantContext> {
  const knex = await getConnection(null);
  const codeHash = sha256(params.code);
  const row = await knex('mcp_oauth_auth_codes').where({ code_hash: codeHash }).first();
  if (!row) throw new OAuthGrantError('invalid_grant', 'Unknown authorization code.');

  // Replay of a consumed code → revoke the grant defensively.
  if (row.consumed_at) {
    await revokeGrantById(row.grant_id);
    throw new OAuthGrantError('invalid_grant', 'Authorization code already used.');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OAuthGrantError('invalid_grant', 'Authorization code expired.');
  }
  if (row.client_id !== params.clientId) {
    throw new OAuthGrantError('invalid_grant', 'Authorization code was issued to a different client.');
  }
  if (row.redirect_uri !== params.redirectUri) {
    throw new OAuthGrantError('invalid_grant', 'redirect_uri mismatch.');
  }
  if (!verifyPkceS256(params.codeVerifier, row.code_challenge)) {
    throw new OAuthGrantError('invalid_grant', 'PKCE verification failed.');
  }
  await knex('mcp_oauth_auth_codes').where({ code_hash: codeHash }).update({ consumed_at: knex.fn.now() });

  return {
    grantId: row.grant_id,
    tenant: row.tenant,
    userId: row.user_id,
    clientId: row.client_id,
    scope: row.scope,
    resource: row.resource,
  };
}

export async function issueRefreshToken(grantId: string, tenant: string): Promise<string> {
  const knex = await getConnection(null);
  const token = opaque();
  await knex('mcp_oauth_refresh_tokens').insert({
    token_hash: sha256(token),
    grant_id: grantId,
    tenant,
    expires_at: knex.raw(`now() + (? * interval '1 second')`, [REFRESH_TOKEN_TTL_SECONDS]),
  });
  return token;
}

/** Rotate a refresh token; reuse of a consumed token revokes the grant (replay). */
export async function rotateRefreshToken(refreshToken: string): Promise<{ grant: GrantContext; refreshToken: string }> {
  const knex = await getConnection(null);
  const tokenHash = sha256(refreshToken);
  const row = await knex('mcp_oauth_refresh_tokens').where({ token_hash: tokenHash }).first();
  if (!row) throw new OAuthGrantError('invalid_grant', 'Unknown refresh token.');
  if (row.consumed_at) {
    await revokeGrantById(row.grant_id);
    throw new OAuthGrantError('invalid_grant', 'Refresh token already used (replay) — grant revoked.');
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OAuthGrantError('invalid_grant', 'Refresh token expired.');
  }
  const grant = await knex('mcp_oauth_grants').where({ grant_id: row.grant_id }).first();
  if (!grant || grant.revoked_at) {
    throw new OAuthGrantError('invalid_grant', 'Grant is no longer active.');
  }

  const next = await issueRefreshToken(row.grant_id, row.tenant);
  await knex('mcp_oauth_refresh_tokens')
    .where({ token_hash: tokenHash })
    .update({ consumed_at: knex.fn.now(), rotated_to: sha256(next) });

  return {
    grant: {
      grantId: grant.grant_id,
      tenant: grant.tenant,
      userId: grant.user_id,
      clientId: grant.client_id,
      scope: grant.scope,
      resource: grant.resource,
    },
    refreshToken: next,
  };
}

async function revokeGrantById(grantId: string): Promise<void> {
  const knex = await getConnection(null);
  await knex('mcp_oauth_grants').where({ grant_id: grantId }).update({ revoked_at: knex.fn.now() });
  await knex('mcp_oauth_refresh_tokens').where({ grant_id: grantId }).del();
  await knex('mcp_oauth_auth_codes').where({ grant_id: grantId }).whereNull('consumed_at').del();
}

/** RFC 7009: revoke the grant behind a presented refresh token (idempotent). */
export async function revokeByRefreshToken(refreshToken: string): Promise<void> {
  const knex = await getConnection(null);
  const row = await knex('mcp_oauth_refresh_tokens').where({ token_hash: sha256(refreshToken) }).first();
  if (row) await revokeGrantById(row.grant_id);
}

/** Revoke a grant the caller owns (RFC 7009 / disconnect). Tenant+user scoped. */
export async function revokeGrant(params: { tenant: string; userId: string; grantId?: string; clientId?: string }): Promise<number> {
  const knex = await getConnection(null);
  const q = knex('mcp_oauth_grants').where({ tenant: params.tenant, user_id: params.userId });
  if (params.grantId) q.andWhere({ grant_id: params.grantId });
  if (params.clientId) q.andWhere({ client_id: params.clientId });
  const grants = await q.select('grant_id');
  for (const g of grants) await revokeGrantById(g.grant_id);
  return grants.length;
}
