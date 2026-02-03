import crypto from 'crypto';
import { z } from 'zod';
import { getConnection } from '../db/db';
import { ApiKeyService } from '../services/apiKeyService';
import { UserSession } from '@alga-psa/db/models/UserSession';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { runWithTenant } from '../db';
import { ForbiddenError, UnauthorizedError } from '../api/middleware/apiMiddleware';

export const mobileDeviceSchema = z
  .object({
    platform: z.string().optional(),
    appVersion: z.string().optional(),
    buildVersion: z.string().optional(),
    deviceId: z.string().optional(),
  })
  .optional();

export const exchangeOttSchema = z.object({
  ott: z.string().min(1),
  state: z.string().min(1),
  device: mobileDeviceSchema,
});

export const refreshSessionSchema = z.object({
  refreshToken: z.string().min(1),
  device: mobileDeviceSchema,
});

export const revokeSessionSchema = z.object({
  refreshToken: z.string().min(1),
});

export type MobileAuthConfig = {
  mobileEnabled: boolean;
  hostedDomainAllowlist: string[];
  ottTtlSec: number;
  accessTtlSec: number;
  refreshTtlSec: number;
};

export function getMobileAuthConfig(): MobileAuthConfig {
  const enabled = (process.env.ALGA_MOBILE_AUTH_ENABLED ?? '').trim().toLowerCase() === 'true';

  const parseNumber = (key: string, fallback: number) => {
    const raw = process.env[key];
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const allowlist = (process.env.ALGA_MOBILE_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    mobileEnabled: enabled,
    hostedDomainAllowlist: allowlist,
    ottTtlSec: parseNumber('ALGA_MOBILE_OTT_TTL_SEC', 60),
    accessTtlSec: parseNumber('ALGA_MOBILE_ACCESS_TTL_SEC', 15 * 60),
    refreshTtlSec: parseNumber('ALGA_MOBILE_REFRESH_TTL_SEC', 30 * 24 * 60 * 60),
  };
}

function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export type IssuedOtt = { ott: string; expiresAtMs: number };

export async function issueMobileOtt(input: {
  tenantId: string;
  userId: string;
  sessionId?: string | null;
  state: string;
  metadata?: Record<string, unknown>;
}): Promise<IssuedOtt> {
  const config = getMobileAuthConfig();
  if (!config.mobileEnabled) {
    throw new ForbiddenError('Mobile auth is disabled');
  }

  const ott = generateOpaqueToken(24);
  const ottHash = sha256(ott);
  const expiresAt = new Date(Date.now() + config.ottTtlSec * 1000);

  const knex = await getConnection(null);
  await knex('mobile_auth_otts').insert({
    tenant: input.tenantId,
    user_id: input.userId,
    session_id: input.sessionId ?? null,
    ott_hash: ottHash,
    state: input.state,
    expires_at: expiresAt,
    used_at: null,
    metadata: input.metadata ?? null,
  });

  return { ott, expiresAtMs: expiresAt.getTime() };
}

type ConsumedOtt = {
  tenant: string;
  user_id: string;
  session_id: string | null;
};

async function consumeMobileOtt(input: {
  ott: string;
  state: string;
  deviceId?: string;
}): Promise<ConsumedOtt | null> {
  const knex = await getConnection(null);
  const ottHash = sha256(input.ott);

  const rows = await knex('mobile_auth_otts')
    .where({ ott_hash: ottHash, state: input.state })
    .whereNull('used_at')
    .where('expires_at', '>', knex.fn.now())
    .update(
      {
        used_at: knex.fn.now(),
        device_id: input.deviceId ?? null,
      },
      ['tenant', 'user_id', 'session_id'],
    );

  const row = (rows as any[])[0] as ConsumedOtt | undefined;
  return row ?? null;
}

type RefreshTokenRow = {
  mobile_refresh_token_id: string;
  tenant: string;
  user_id: string;
  api_key_id: string | null;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
};

async function getActiveRefreshTokenByHash(hash: string): Promise<RefreshTokenRow | null> {
  const knex = await getConnection(null);
  const row = await knex('mobile_refresh_tokens')
    .where({ token_hash: hash })
    .whereNull('revoked_at')
    .where('expires_at', '>', knex.fn.now())
    .first();
  return (row as RefreshTokenRow) ?? null;
}

async function insertRefreshToken(input: {
  tenantId: string;
  userId: string;
  apiKeyId?: string | null;
  expiresAt: Date;
  deviceId?: string;
  device?: Record<string, unknown>;
}): Promise<{ token: string; id: string }> {
  const token = generateOpaqueToken(32);
  const tokenHash = sha256(token);
  const knex = await getConnection(null);

  const [row] = await knex('mobile_refresh_tokens')
    .insert({
      tenant: input.tenantId,
      user_id: input.userId,
      api_key_id: input.apiKeyId ?? null,
      token_hash: tokenHash,
      expires_at: input.expiresAt,
      revoked_at: null,
      replaced_by_id: null,
      last_used_at: null,
      device_id: input.deviceId ?? null,
      device: input.device ?? null,
    })
    .returning(['mobile_refresh_token_id']);

  const id = (row as any)?.mobile_refresh_token_id as string | undefined;
  if (!id) throw new Error('Failed to create refresh token');

  return { token, id };
}

async function revokeRefreshToken(input: { id: string; replacedById?: string | null }): Promise<void> {
  const knex = await getConnection(null);
  await knex('mobile_refresh_tokens')
    .where({ mobile_refresh_token_id: input.id })
    .update({
      revoked_at: knex.fn.now(),
      replaced_by_id: input.replacedById ?? null,
      last_used_at: knex.fn.now(),
    });
}

async function setRefreshTokenLastUsed(id: string): Promise<void> {
  const knex = await getConnection(null);
  await knex('mobile_refresh_tokens')
    .where({ mobile_refresh_token_id: id })
    .update({ last_used_at: knex.fn.now() });
}

export type ExchangeOttResult = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  tenantId: string;
  user?: { id: string; email?: string; name?: string };
};

export async function exchangeOttForSession(input: z.infer<typeof exchangeOttSchema>): Promise<ExchangeOttResult> {
  const config = getMobileAuthConfig();
  if (!config.mobileEnabled) {
    throw new ForbiddenError('Mobile auth is disabled');
  }

  const consumed = await consumeMobileOtt({ ott: input.ott, state: input.state, deviceId: input.device?.deviceId });
  if (!consumed) {
    throw new UnauthorizedError('Invalid or expired one-time token');
  }

  const tenantId = consumed.tenant;
  const userId = consumed.user_id;

  if (consumed.session_id) {
    const session = await UserSession.findById(tenantId, consumed.session_id);
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedError('Login session is no longer valid');
    }
  }

  const accessExpiresAt = new Date(Date.now() + config.accessTtlSec * 1000);
  const refreshExpiresAt = new Date(Date.now() + config.refreshTtlSec * 1000);

  const apiKeyRecord = await ApiKeyService.createApiKey(
    userId,
    'Mobile session',
    accessExpiresAt,
    {
      tenantId,
      purpose: 'mobile_session',
      metadata: {
        device: input.device ?? null,
      },
    },
  );

  try {
    const { token: refreshToken } = await insertRefreshToken({
      tenantId,
      userId,
      apiKeyId: apiKeyRecord.api_key_id,
      expiresAt: refreshExpiresAt,
      deviceId: input.device?.deviceId,
      device: input.device ? { ...input.device } : undefined,
    });

    const user = await runWithTenant(tenantId, async () => findUserByIdForApi(userId, tenantId));
    const name =
      user && (user.first_name || user.last_name)
        ? [user.first_name, user.last_name].filter(Boolean).join(' ')
        : undefined;

    return {
      accessToken: apiKeyRecord.api_key,
      refreshToken,
      expiresInSec: config.accessTtlSec,
      tenantId,
      user: user ? { id: userId, email: user.email ?? undefined, name } : { id: userId },
    };
  } catch (e) {
    // Best-effort cleanup: don't leave an active API key if refresh token creation fails.
    await ApiKeyService.deactivateApiKey(apiKeyRecord.api_key_id, tenantId).catch(() => {});
    throw e;
  }
}

export type RefreshSessionResult = {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
};

export async function refreshMobileSession(input: z.infer<typeof refreshSessionSchema>): Promise<RefreshSessionResult> {
  const config = getMobileAuthConfig();
  if (!config.mobileEnabled) {
    throw new ForbiddenError('Mobile auth is disabled');
  }

  const hash = sha256(input.refreshToken);
  const existing = await getActiveRefreshTokenByHash(hash);
  if (!existing) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const accessExpiresAt = new Date(Date.now() + config.accessTtlSec * 1000);
  const refreshExpiresAt = new Date(Date.now() + config.refreshTtlSec * 1000);

  const apiKeyRecord = await ApiKeyService.createApiKey(
    existing.user_id,
    'Mobile session (refresh)',
    accessExpiresAt,
    {
      tenantId: existing.tenant,
      purpose: 'mobile_session',
      metadata: {
        device: input.device ?? null,
        rotatedFrom: existing.mobile_refresh_token_id,
      },
    },
  );

  const { token: newRefreshToken, id: newRefreshId } = await insertRefreshToken({
    tenantId: existing.tenant,
    userId: existing.user_id,
    apiKeyId: apiKeyRecord.api_key_id,
    expiresAt: refreshExpiresAt,
    deviceId: input.device?.deviceId,
    device: input.device ? { ...input.device } : undefined,
  });

  await revokeRefreshToken({ id: existing.mobile_refresh_token_id, replacedById: newRefreshId });
  if (existing.api_key_id) {
    await ApiKeyService.deactivateApiKey(existing.api_key_id, existing.tenant).catch(() => {});
  }

  return {
    accessToken: apiKeyRecord.api_key,
    refreshToken: newRefreshToken,
    expiresInSec: config.accessTtlSec,
  };
}

export async function revokeMobileSession(input: z.infer<typeof revokeSessionSchema>): Promise<void> {
  const config = getMobileAuthConfig();
  if (!config.mobileEnabled) {
    throw new ForbiddenError('Mobile auth is disabled');
  }

  const hash = sha256(input.refreshToken);
  const existing = await getActiveRefreshTokenByHash(hash);
  if (!existing) {
    // Avoid token enumeration: pretend success.
    return;
  }

  await revokeRefreshToken({ id: existing.mobile_refresh_token_id, replacedById: null });
  if (existing.api_key_id) {
    await ApiKeyService.deactivateApiKey(existing.api_key_id, existing.tenant).catch(() => {});
  }

  await setRefreshTokenLastUsed(existing.mobile_refresh_token_id).catch(() => {});
}

export type MobileAuthCapabilities = {
  mobileEnabled: boolean;
  providers: { microsoft: boolean; google: boolean };
  hostedDomainAllowlist?: string[];
  accessTtlSec?: number;
  refreshTtlSec?: number;
  ottTtlSec?: number;
};

export function getCapabilitiesResponse(): MobileAuthCapabilities {
  const config = getMobileAuthConfig();
  return {
    mobileEnabled: config.mobileEnabled,
    providers: { microsoft: true, google: true },
    hostedDomainAllowlist: config.hostedDomainAllowlist.length ? config.hostedDomainAllowlist : undefined,
    accessTtlSec: config.accessTtlSec,
    refreshTtlSec: config.refreshTtlSec,
    ottTtlSec: config.ottTtlSec,
  };
}
