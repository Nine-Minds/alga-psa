import { getConnection, tenantDb } from '@alga-psa/db';
import { findUserByIdForApi } from '@alga-psa/users/actions';
import { getForKey } from 'server/src/lib/api/rateLimit/apiRateLimitSettingsModel';
import type {
  BoundaryApiContext,
  BoundaryApiKeyRecord,
  BoundaryKeyGateOwner,
  BoundaryRateLimitConfig,
} from '@product/service-principals/types';
import { rateLimitCeiling } from './entitlements';

/**
 * Enterprise edition boundary for service principals (PRD R4.6, R5.1, R6.4, R5.4).
 * CE calls these three hooks through '@product/service-principals/entry'.
 */

export const ACT_AS_HEADER = 'x-alga-act-as';

class BoundaryError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(code: string, message: string, statusCode: number) {
    super(message);
    this.name = 'ServicePrincipalBoundaryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface PrincipalRow {
  user_id: string;
  allow_act_as: boolean;
  archived_at: string | null;
  rate_limit_max_tokens: number | null;
  rate_limit_refill_per_min: number | null;
}

async function loadActivePrincipal(tenant: string, userId: string): Promise<PrincipalRow | null> {
  const knex = await getConnection(tenant);
  const row = (await tenantDb(knex, tenant)
    .table('service_principals')
    .where({ user_id: userId })
    .first('user_id', 'allow_act_as', 'archived_at', 'rate_limit_max_tokens', 'rate_limit_refill_per_min')) as
    | PrincipalRow
    | undefined;
  if (!row || row.archived_at) return null;
  return row;
}

/**
 * Bucket config for a principal's requests (R6.4): a per-key api_rate_limit_settings
 * row wins, then the principal's own override (capped at the Pro ceiling), then the
 * Pro default. `refillRate` is tokens per second.
 */
export function resolvePrincipalRateLimit(input: {
  keyRow?: { maxTokens: number; refillPerMin: number } | null;
  principal: Pick<PrincipalRow, 'rate_limit_max_tokens' | 'rate_limit_refill_per_min'>;
}): BoundaryRateLimitConfig {
  const ceiling = rateLimitCeiling();
  if (input.keyRow) {
    return { maxTokens: input.keyRow.maxTokens, refillRate: input.keyRow.refillPerMin / 60 };
  }
  const { rate_limit_max_tokens: tokens, rate_limit_refill_per_min: perMin } = input.principal;
  if (typeof tokens === 'number' && typeof perMin === 'number') {
    return {
      maxTokens: Math.min(tokens, ceiling.maxTokens),
      refillRate: Math.min(perMin, ceiling.refillPerMin) / 60,
    };
  }
  return { maxTokens: ceiling.maxTokens, refillRate: ceiling.refillPerMin / 60 };
}

async function loadKeyRateLimitRow(tenant: string, apiKeyId: string | undefined) {
  if (!apiKeyId) return null;
  const row = await getForKey(tenant, apiKeyId);
  return row && row.apiKeyId === apiKeyId ? row : null;
}

export async function resolveServicePrincipalApiContext<TUser = unknown>(
  keyRecord: BoundaryApiKeyRecord,
  owner: TUser,
  req: Request,
): Promise<BoundaryApiContext<TUser> | null> {
  const ownerRow = owner as unknown as { user_id?: string; user_type?: string | null };
  if (ownerRow?.user_type !== 'service' || ownerRow.user_id !== keyRecord.user_id) return null;

  const principal = await loadActivePrincipal(keyRecord.tenant, keyRecord.user_id);
  if (!principal) return null;

  const actAsHeader = req.headers.get(ACT_AS_HEADER)?.trim() || null;
  let effectiveUser: TUser = owner;
  let actAsUserId: string | null = null;
  let viaPrincipalUserId: string | null = null;

  if (actAsHeader) {
    if (!principal.allow_act_as) {
      throw new BoundaryError('ACT_AS_NOT_ALLOWED', 'This service principal is not allowed to act as a user', 403);
    }
    const invalidTarget = () =>
      new BoundaryError('ACT_AS_INVALID_TARGET', 'The act-as user must be an active internal user in this tenant', 422);
    // The header is untrusted input: anything that is not a plain uuid is just an invalid target.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actAsHeader)) throw invalidTarget();
    // findUserByIdForApi only returns active users in this tenant.
    const target = await findUserByIdForApi(actAsHeader, keyRecord.tenant);
    if (!target || target.user_type !== 'internal') throw invalidTarget();
    effectiveUser = target as unknown as TUser;
    actAsUserId = target.user_id;
    viaPrincipalUserId = keyRecord.user_id;
  }

  const effectiveUserId = actAsUserId ?? keyRecord.user_id;
  const keyRow = await loadKeyRateLimitRow(keyRecord.tenant, keyRecord.api_key_id);

  return {
    userId: effectiveUserId,
    tenant: keyRecord.tenant,
    apiKeyId: keyRecord.api_key_id,
    user: effectiveUser,
    kind: 'user',
    principal: { userId: keyRecord.user_id, userType: 'service', kind: 'service' },
    actAsUserId,
    effectiveUserId,
    viaPrincipalUserId,
    rateLimitSubjectId: `sp:${keyRecord.user_id}`,
    rateLimitConfig: resolvePrincipalRateLimit({ keyRow, principal }),
  };
}

/**
 * True only for an active (or grandfathered) service principal. Owners below the Pro
 * tier keep authenticating (R6.0a), so this never consults the tier. Archived
 * principals have no keys, and are refused here as well.
 */
export async function servicePrincipalKeyGate(owner: BoundaryKeyGateOwner): Promise<boolean> {
  if (owner.user_type !== 'service' || owner.is_inactive) return false;
  try {
    return (await loadActivePrincipal(owner.tenant, owner.user_id)) !== null;
  } catch {
    return false;
  }
}

/**
 * Rewrites errors that only EE can describe (R5.4, R5.9). The seam erases class
 * identity, so match on the error name.
 */
export function mapServicePrincipalError<T>(error: T): T {
  const err = error as unknown as { name?: string; field?: string; message?: string };
  if (err && err.name === 'HumanWorkOwnerRequiredError') {
    const mapped = new BoundaryError(
      'ACT_AS_REQUIRED',
      `This action must be performed by a person. Send the X-Alga-Act-As header with an active internal user id (the principal must have act-as enabled) so the work is attributed to that user.` +
        (err.field ? ` Field: ${err.field}.` : ''),
      422,
    );
    return mapped as unknown as T;
  }
  return error;
}
