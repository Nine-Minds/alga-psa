import { Buffer } from 'node:buffer';
import logger from '@alga-psa/shared/core/logger';
import type { IUser } from 'server/src/interfaces/auth.interfaces';
import { buildTenantPortalSlug, isValidTenantSlug, getSlugParts } from 'server/src/lib/utils/tenantSlug';

type InternalUserType = 'internal' | 'client';

async function findUserByEmail(email: string): Promise<IUser | undefined> {
  const User = (await import('server/src/lib/models/user')).default;
  return User.findUserByEmail(email);
}

async function findUserByEmailAndType(email: string, userType: InternalUserType): Promise<IUser | undefined> {
  const User = (await import('server/src/lib/models/user')).default;
  return User.findUserByEmailAndType(email, userType);
}

async function findUserByEmailTenantAndType(
  email: string,
  tenantId: string,
  userType: InternalUserType,
): Promise<IUser | undefined> {
  const User = (await import('server/src/lib/models/user')).default;
  return User.findUserByEmailTenantAndType(email, tenantId, userType);
}

async function resolveTenantIdFromSlug(slug: string): Promise<string | undefined> {
  const normalizedSlug = slug.trim().toLowerCase();
  if (!isValidTenantSlug(normalizedSlug)) {
    return undefined;
  }

  const { getAdminConnection } = await import('@shared/db/admin');
  const knex = await getAdminConnection();
  const { prefix, suffix } = getSlugParts(normalizedSlug);

  const record = await knex('tenants')
    .select('tenant')
    .whereRaw(
      "substring(replace(tenant::text, '-', '') from 1 for 6) = ?",
      [prefix],
    )
    .andWhereRaw(
      "substring(replace(tenant::text, '-', '') from 27 for 6) = ?",
      [suffix],
    )
    .first();

  return record?.tenant;
}

async function resolveTenantIdFromVanityHost(host?: string | null): Promise<string | undefined> {
  if (!host) {
    return undefined;
  }

  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) {
    return undefined;
  }

  const { getAdminConnection } = await import('@shared/db/admin');
  const knex = await getAdminConnection();
  const record = await knex('portal_domains')
    .select('tenant')
    .where({ domain: normalizedHost })
    .first();

  return record?.tenant;
}

export type EnterpriseOAuthProvider = 'google' | 'microsoft';

export interface OAuthProfileMappingInput {
  provider: EnterpriseOAuthProvider;
  email?: string | null;
  image?: unknown;
  profile: Record<string, unknown>;
  tenantHint?: string | null;
  vanityHostHint?: string | null;
  userTypeHint?: string | null;
}

export interface OAuthProfileMappingResult {
  id: string;
  email: string;
  name: string;
  username: string;
  image?: string;
  proToken: string;
  tenant?: string;
  tenantSlug?: string;
  user_type: InternalUserType;
  clientId?: string;
  contactId?: string;
}

function pickUserType(userType: string | undefined | null): InternalUserType {
  if (userType === 'client') {
    return 'client';
  }
  return 'internal';
}

function computeDisplayName(user: IUser): string {
  const names = [user.first_name, user.last_name].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0,
  );

  if (names.length > 0) {
    return names.join(' ');
  }

  return user.username;
}

async function locateUser(
  email: string,
  tenantHint?: string | null,
  userTypeHint?: string | null,
): Promise<IUser | undefined> {
  const defaultUser = await findUserByEmail(email);
  if (defaultUser) {
    return defaultUser;
  }

  const normalizedType = pickUserType(userTypeHint ?? undefined);
  if (tenantHint) {
    const tenantId =
      (await resolveTenantIdFromSlug(tenantHint)) ??
      (await resolveTenantIdFromVanityHost(tenantHint)) ??
      tenantHint;

    if (tenantId) {
      const tenantScopedUser = await findUserByEmailTenantAndType(
        email,
        tenantId,
        normalizedType,
      );
      if (tenantScopedUser) {
        return tenantScopedUser;
      }
    }
  }

  return findUserByEmailAndType(email, normalizedType);
}

function coerceString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStateValue(state: unknown, key: string): string | undefined {
  if (typeof state !== 'string' || state.length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(state);
    const candidate = (parsed as Record<string, unknown>)[key];
    return coerceString(candidate);
  } catch (error) {
    // state might not be JSON; fall back to querystring parsing
  }

  try {
    const params = new URLSearchParams(state);
    const candidate = params.get(key);
    return coerceString(candidate);
  } catch (error) {
    return undefined;
  }
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) {
    return undefined;
  }

  const segments = token.split('.');
  if (segments.length < 2) {
    return undefined;
  }

  const payload = segments[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    logger.warn('[auth] Failed to decode OAuth id_token payload', { error });
    return undefined;
  }
}

function pickFirstCandidate(candidates: Array<unknown>): string | undefined {
  for (const candidate of candidates) {
    const coerced = coerceString(candidate);
    if (coerced) {
      return coerced;
    }
  }
  return undefined;
}

export async function mapOAuthProfileToExtendedUser(
  input: OAuthProfileMappingInput,
): Promise<OAuthProfileMappingResult> {
  const { provider, email, image, profile, tenantHint, userTypeHint, vanityHostHint } = input;

  if (!email || typeof email !== 'string') {
    logger.warn(`[auth] ${provider} profile missing email`, { profile });
    throw new Error('User not found');
  }

  const normalizedEmail = email.toLowerCase();

  const user = await locateUser(normalizedEmail, tenantHint, userTypeHint);
  if (!user || !user.user_id) {
    logger.warn(`[auth] User not found during ${provider} OAuth`, { email: normalizedEmail });
    throw new Error('User not found');
  }

  if (user.is_inactive) {
    logger.warn(`[auth] Inactive user attempted ${provider} OAuth`, { email: normalizedEmail });
    throw new Error('User not found');
  }

  let tenantId = user.tenant;
  if ((!tenantId || tenantId.length === 0) && tenantHint) {
    const resolvedTenant =
      (await resolveTenantIdFromSlug(tenantHint)) ??
      (await resolveTenantIdFromVanityHost(tenantHint));
    if (resolvedTenant) {
      tenantId = resolvedTenant;
    }
  }

  if ((!tenantId || tenantId.length === 0) && vanityHostHint) {
    const resolvedTenant = await resolveTenantIdFromVanityHost(vanityHostHint);
    if (resolvedTenant) {
      tenantId = resolvedTenant;
    }
  }

  const resolvedUserType = pickUserType(userTypeHint ?? user.user_type);
  const tenantSlug = tenantId ? buildTenantPortalSlug(tenantId) : undefined;

  logger.info(`[auth] ${provider} OAuth successful`, { email: normalizedEmail, tenant: tenantId, userType: resolvedUserType });

  return {
    id: user.user_id.toString(),
    email: user.email,
    name: computeDisplayName(user),
    username: user.username,
    image: typeof image === 'string' ? image : undefined,
    proToken: '',
    tenant: tenantId,
    tenantSlug,
    user_type: resolvedUserType,
    clientId: (user as any).client_id ?? undefined,
    contactId: user.contact_id ?? undefined,
  };
}

export async function applyOAuthAccountHints(
  user: OAuthProfileMappingResult,
  account: Record<string, unknown> | null | undefined,
): Promise<OAuthProfileMappingResult> {
  if (!account) {
    return user;
  }

  const idTokenPayload = decodeJwtPayload(coerceString(account.id_token));

  const tenantHint = pickFirstCandidate([
    account.tenant,
    (account.params as Record<string, unknown> | undefined)?.tenant,
    (account.params as Record<string, unknown> | undefined)?.tenant_hint,
    account.tenant_id,
    account.tenantId,
    account.tenant_hint,
    account.tenantHint,
    account.organization,
    parseStateValue(account.state, 'tenant'),
    parseStateValue(account.state, 'tenant_hint'),
    idTokenPayload?.tid,
    idTokenPayload?.tenant,
    idTokenPayload?.tenantId,
  ]);

  const vanityHostHint = pickFirstCandidate([
    (account.params as Record<string, unknown> | undefined)?.vanity_host,
    account.vanity_host,
    parseStateValue(account.state, 'vanity_host'),
  ]);

  const userTypeHint = pickFirstCandidate([
    (account.params as Record<string, unknown> | undefined)?.user_type,
    account.user_type,
    parseStateValue(account.state, 'user_type'),
    idTokenPayload?.user_type,
  ]);

  let tenantIdFromHints: string | undefined;
  if (tenantHint) {
    tenantIdFromHints =
      (await resolveTenantIdFromSlug(tenantHint)) ??
      (await resolveTenantIdFromVanityHost(tenantHint)) ??
      tenantHint;
  }

  if (!tenantIdFromHints && vanityHostHint) {
    tenantIdFromHints = await resolveTenantIdFromVanityHost(vanityHostHint);
  }

  const nextUser: OAuthProfileMappingResult = {
    ...user,
  };

  if (tenantIdFromHints) {
    nextUser.tenant = tenantIdFromHints;
    nextUser.tenantSlug = buildTenantPortalSlug(tenantIdFromHints);
  }

  if (!nextUser.tenant && tenantHint) {
    // Preserve tenantHint for downstream debugging by stashing in slug if we resolved nothing.
    nextUser.tenantSlug = coerceString(tenantHint);
  }

  if (vanityHostHint) {
    // If we resolved tenant from vanity host, the slug has already been updated.
    // Otherwise, leave slug untouched but we can log for diagnostics.
    logger.debug('[auth] OAuth vanity host hint detected', {
      vanityHostHint,
      tenant: nextUser.tenant,
    });
  }

  if (userTypeHint) {
    nextUser.user_type = pickUserType(userTypeHint);
  }

  if (nextUser.tenant && nextUser.tenantSlug) {
    return nextUser;
  }

  if (nextUser.tenant && !nextUser.tenantSlug) {
    nextUser.tenantSlug = buildTenantPortalSlug(nextUser.tenant);
  }

  return nextUser;
}
