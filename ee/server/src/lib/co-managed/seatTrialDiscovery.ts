import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createClientScopeContext } from '@alga-psa/authorization/clientScopeAuthorization';
import { admits } from '@alga-psa/core/capability';
import { isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';

/** Operational discovery for the trial-only root and recovery tab. No billing or client listing. */
export async function canDiscoverSeatTrial(user: { user_type?: string; tenant?: string | null; user_id: string }, tenant: string, clientId?: string) {
  if (user.tenant !== tenant || user.user_type !== 'internal' || !await hasPermission(user as never, 'co_management', 'manage') ||
      !await hasPermission(user as never, 'client', 'read')) return false;
  const { knex } = await createTenantKnex(tenant);
  const home = tenantDb(knex, tenant);
  const pilot = await home.table('co_managed_seat_trials').first('client_id', 'state', 'activated_at', 'conversion_state');
  if (pilot && (pilot.state !== 'ended' || pilot.activated_at || pilot.conversion_state === 'pending')) {
    if (clientId && clientId !== pilot.client_id) return false;
    return (await createClientScopeContext(knex, tenant, user as never)).permits('client', pilot.client_id);
  }
  // A client lookup from a closed tab is only for recovery of an existing pilot.
  return !clientId && await isCoManagedPurchaseSurfaceOpen(tenant) && (await admits('co-managed-seat', tenant)).admitted &&
    Boolean(await home.table('co_managed_trial_sponsors').where('base_until', '>', knex.fn.now()).first('tenant'));
}
