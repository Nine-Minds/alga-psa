import User from '@alga-psa/db/models/user';
import logger from '@alga-psa/core/logger';
import type { IUser } from '@alga-psa/types';

export type SignInUserType = 'client' | 'internal';

/**
 * Raised when an email authenticates live users of one type in more than one
 * tenant and no tenant scope was supplied. Callers translate it into their own
 * surface (`TENANT_REQUIRED` for credentials, `tenant_required` for SSO).
 */
export class TenantRequiredResolutionError extends Error {
  readonly code = 'TENANT_REQUIRED';
  constructor() {
    super('Sign-in resolves to users in more than one tenant');
    this.name = 'TenantRequiredResolutionError';
  }
}

export interface ResolveSignInUserParams {
  /** Already-normalized email. */
  email: string;
  userType: SignInUserType;
  /**
   * Trusted tenant scope (URL slug, signed SSO cookie, Teams tenant). When set,
   * only that tenant is considered. Never derive this from IdP profile claims.
   */
  scopeTenantId?: string | null;
  /**
   * Proves the attempt's credential against one live candidate. Password
   * sign-in checks the stored hash; SSO has no further factor, so the IdP's
   * proof of mailbox control is shared equally by every candidate.
   */
  verify: (candidate: IUser) => boolean | Promise<boolean>;
}

export interface ResolvedSignInUser {
  user: IUser | undefined;
  /** True when `user` was proven by `verify` during this resolution. */
  verified: boolean;
}

/**
 * Oldest account first, then user_id: a total order on immutable columns, so
 * the same duplicates always resolve to the same user.
 */
export function compareByCreationThenId(a: IUser, b: IUser): number {
  const aCreated = a.created_at ? new Date(a.created_at).getTime() : Number.POSITIVE_INFINITY;
  const bCreated = b.created_at ? new Date(b.created_at).getTime() : Number.POSITIVE_INFINITY;
  if (aCreated !== bCreated) {
    return aCreated < bCreated ? -1 : 1;
  }
  return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0;
}

/**
 * The one way a sign-in finds its user. A `.first()` lookup answers an
 * arbitrary tenant and can select an inactive restored account instead of the
 * live workspace, so with no tenant in hand look at every match and refuse when
 * the attempt proves out in more than one tenant.
 */
export async function resolveSignInUser(params: ResolveSignInUserParams): Promise<ResolvedSignInUser> {
  const { email, userType, scopeTenantId, verify } = params;

  if (scopeTenantId) {
    const scoped = await User.findUserByEmailTenantAndType(email, scopeTenantId, userType);
    return { user: scoped, verified: false };
  }

  const candidates = await User.findUsersByEmailAndType(email, userType);
  if (candidates.length <= 1) {
    return { user: candidates[0], verified: false };
  }

  const verifiedCandidates: IUser[] = [];
  for (const candidate of candidates) {
    if (candidate.is_inactive) {
      continue;
    }
    if (await verify(candidate)) {
      verifiedCandidates.push(candidate);
    }
  }

  const tenants = new Set(verifiedCandidates.map((candidate) => candidate.tenant));
  if (tenants.size > 1) {
    logger.warn('[resolveSignInUser] Credentials resolve to users in multiple tenants', {
      email,
      userType,
      tenantCount: tenants.size,
    });
    throw new TenantRequiredResolutionError();
  }

  if (verifiedCandidates.length > 0) {
    verifiedCandidates.sort(compareByCreationThenId);
    return { user: verifiedCandidates[0], verified: true };
  }

  // Nobody proved out. When nobody is live either, hand back the oldest
  // candidate unverified so the caller's inactive handling still runs; a live
  // candidate that failed `verify` must not be disclosed.
  if (candidates.every((candidate) => candidate.is_inactive)) {
    return { user: [...candidates].sort(compareByCreationThenId)[0], verified: false };
  }
  return { user: undefined, verified: false };
}
