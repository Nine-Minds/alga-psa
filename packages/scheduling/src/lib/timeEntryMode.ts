import type { Knex } from 'knex';
import { probeTenantAuthorizationScope } from '@alga-psa/authorization/subject/tenantScope';
import type { AuthorizationRequestCache } from '@alga-psa/authorization/kernel';
import { loadProductPrincipal } from '@shared/services/productPrincipal';
import { CO_MANAGED_SEAT_SURFACE } from '@shared/services/productSurfaceKinds';
import type { CoManagedTimeEntryMode } from '@alga-psa/co-managed/timeEntryBillingMode';

// A1 bridge. The time-entry call sites may not import @alga-psa/co-managed (src/test/timeSourceCoverage.static.test.ts);
// this module is the explicit, allowlisted exception, because seat (operational) mode is decided from the principal and
// written natively, not through a time source. See the allowlist in that test for the rule and why.
// LEVERAGE: friction time-source-seam-vs-principal-mode — operational mode is a per-principal axis on native time,
// which the time-source seam (per work item / tenant) does not model; if a third principal-driven mode appears, give it its own seam.
export { operationalTimeEntryFields, serviceRequiredForTimeEntry } from '@alga-psa/co-managed/timeEntryBillingMode';
export type { CoManagedTimeEntryMode };

/**
 * The one decision of which mode a principal's time entries are written in.
 *
 * `operational` for a co-managed seat technician (the S12 principal kind), `commercial` for everyone else.
 * Decided here, on the server, from the authenticated principal. No client value is an input, so a payload
 * claiming `operational` cannot turn billing off and a seat cannot ask for `commercial`.
 *
 * Hot path (S15 neutrality fence, `timeEntry.create`, run with `npm run budget:hot-path`): the save already asks
 * the cached tenant authorization probe whether any built-in resolver (the seat resolver) has a subject in the
 * tenant. That answer is reused here through the request cache the save shares with its create authorization,
 * so a tenant with no seat technician costs no extra statement. Only an explicit "no resolver subjects" skips the
 * principal read; any other answer (subjects exist, probe failed, a resolver without a fact source) reads the
 * principal, so an uncertain tenant is never treated as commercial. A failed principal read propagates, so a
 * save fails rather than falling back to commercial. The release flag is not consulted: flipping it never makes a
 * seat's time billable.
 */
export function timeEntryModeForSurfaceKind(surfaceKind: string | null | undefined): CoManagedTimeEntryMode {
  return surfaceKind === CO_MANAGED_SEAT_SURFACE ? 'operational' : 'commercial';
}

export async function resolveTimeEntryMode(
  conn: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
  requestCache: AuthorizationRequestCache,
): Promise<CoManagedTimeEntryMode> {
  const scope = await probeTenantAuthorizationScope(conn, tenant, requestCache);
  if (scope.resolverSubjects === false) return 'commercial';
  const { surfaceKind } = await loadProductPrincipal({ tenantId: tenant, userId });
  return timeEntryModeForSurfaceKind(surfaceKind);
}
