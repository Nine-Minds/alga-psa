import User from '@alga-psa/db/models/user';
import { getTenantIdBySlug } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import type { IUser } from '@alga-psa/types';

import { compareByCreationThenId } from '../signInUserResolution';
import { resolveTenantFromPortalDomain } from '../portalDomainTenant';
import { toResolvedSubject } from './subject';
import type { ResetHint, ResetUserType, ResolvedResetSubject } from './types';

/**
 * Tenants named by the hint. A hint that resolves to nothing (unknown host,
 * malformed slug) contributes nothing, i.e. counts as no hint.
 */
async function resolveHintTenants(hint: ResetHint): Promise<string[]> {
  const tenants: string[] = [];
  const slug = hint.tenantSlug?.trim().toLowerCase();
  if (slug) {
    const tenant = await getTenantIdBySlug(slug);
    if (tenant) tenants.push(tenant);
  }
  const domain = hint.portalDomain?.trim();
  if (domain) {
    const tenant = await resolveTenantFromPortalDomain(domain);
    if (tenant) tenants.push(tenant);
  }
  return tenants;
}

/**
 * Request-time resolution: who does "reset the account with this email" mean?
 *
 * - A hint that resolves to a tenant restricts the answer to that tenant's active
 *   user. If that tenant has none the answer is empty: never another tenant.
 *   (Two hints naming different tenants contradict each other: also empty.)
 * - With no usable hint, every tenant holding an active user is answered for, one
 *   subject per tenant.
 *
 * Inactive users never become subjects.
 */
export async function resolveResetSubjects(
  email: string,
  userType: ResetUserType,
  hint: ResetHint = {}
): Promise<ResolvedResetSubject[]> {
  const normalizedEmail = email.trim().toLowerCase();
  const hintTenants = await resolveHintTenants(hint);
  const scoped = new Set(hintTenants);
  if (scoped.size > 1) {
    logger.warn('[passwordReset] Reset hints name different tenants; resolving to nobody');
    return [];
  }

  const active = (await User.findUsersByEmailAndType(normalizedEmail, userType))
    .filter((user) => !user.is_inactive)
    .filter((user) => scoped.size === 0 || scoped.has(user.tenant));

  // One subject per tenant, deterministic if a tenant somehow holds duplicates.
  const byTenant = new Map<string, IUser>();
  for (const user of [...active].sort(compareByCreationThenId)) {
    if (!byTenant.has(user.tenant)) byTenant.set(user.tenant, user);
  }
  return [...byTenant.values()].map((user) => toResolvedSubject(user, userType));
}
