import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { principalMembershipExpression, resolvePrincipalKind } from '@alga-psa/authorization/subject/principalKind';

/** Who is asking, as far as the product surface is concerned. A tenant alone is an ordinary principal. */
export interface ProductPrincipalRef {
  tenantId: string;
  userId?: string | null;
}

export interface LoadedProductPrincipal {
  /** The tenant's raw `product_code`; callers resolve and validate it. */
  rawProductCode: string | null;
  /** The principal kind of the user; null for an ordinary principal. */
  surfaceKind: string | null;
}

/**
 * The one read behind every product-surface decision (route, menu, API, server action).
 *
 * The tenant's product is read with a single statement and, when the caller names a user and a principal
 * kind is registered, that user's membership in the kind's index rides in the same statement. An ordinary
 * user therefore costs nothing over the tenant-only read; only a member pays one more statement, for the
 * facts the kind is decided from. Nothing is cached, so a seat change decides the next request.
 */
export async function loadProductPrincipal(ref: ProductPrincipalRef): Promise<LoadedProductPrincipal> {
  const knex = await getAdminConnection();
  const membership = ref.userId ? principalMembershipExpression(knex, { tenant: ref.tenantId, userId: ref.userId }) : null;
  const query = tenantDb(knex, ref.tenantId).table('tenants');
  const row = membership
    ? await query.select('product_code', knex.raw('? as principal_member', [membership])).first()
    : await query.select('product_code').first();

  const kind = membership && ref.userId
    ? await resolvePrincipalKind(knex, { tenant: ref.tenantId, userId: ref.userId, member: row?.principal_member })
    : null;
  return { rawProductCode: row?.product_code ?? null, surfaceKind: kind?.kind ?? null };
}
