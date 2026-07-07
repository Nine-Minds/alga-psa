import { tenantDb } from '@alga-psa/db';
import { ADD_ONS } from '@alga-psa/types';

/**
 * Lifecycle state of a tenant's Teams add-on entitlement.
 * - `active`: an add-on row exists and is not expired.
 * - `expired`: an add-on row exists but its `expires_at` is in the past (soft-disable).
 * - `absent`: no add-on row exists at all.
 */
export type TeamsAddOnState = 'active' | 'expired' | 'absent';

/** Thrown by {@link assertTeamsAddOn} when the Teams add-on is not active. */
export class TeamsAddOnInactiveError extends Error {
  readonly code = 'addon_inactive' as const;
  readonly state: Exclude<TeamsAddOnState, 'active'>;

  constructor(state: Exclude<TeamsAddOnState, 'active'>, message?: string) {
    super(message ?? `Teams add-on is not active for this tenant (state: ${state})`);
    this.name = 'TeamsAddOnInactiveError';
    this.state = state;
  }
}

interface TenantAddOnRow {
  addon_key: string;
  expires_at: string | Date | null;
}

/**
 * Canonical Teams add-on entitlement check. Returns true when the tenant has a
 * non-expired `ADD_ONS.TEAMS` row. The `expires_at IS NULL OR expires_at > now()`
 * predicate is evaluated in SQL so it matches the database's clock.
 */
export async function tenantHasTeamsAddOn(knex: any, tenantId: string): Promise<boolean> {
  const row = await tenantDb(knex, tenantId).table('tenant_addons')
    .where({ addon_key: ADD_ONS.TEAMS })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

/**
 * Resolves the add-on lifecycle state, distinguishing an expired row (`expired`)
 * from no row at all (`absent`). The row (including `expires_at`) is read and the
 * expiry is interpreted in JS so callers can react to a lapsed-but-preserved
 * entitlement (soft-disable) differently from one that was never purchased.
 */
export async function getTeamsAddOnState(knex: any, tenantId: string): Promise<TeamsAddOnState> {
  const row = await tenantDb(knex, tenantId).table<TenantAddOnRow>('tenant_addons')
    .where({ addon_key: ADD_ONS.TEAMS })
    .first('addon_key', 'expires_at');

  if (!row) {
    return 'absent';
  }

  if (row.expires_at === null || row.expires_at === undefined) {
    return 'active';
  }

  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime())) {
    // Unparseable expiry behaves like an open-ended entitlement (fail open).
    return 'active';
  }

  return expiresAt.getTime() > Date.now() ? 'active' : 'expired';
}

/**
 * Throws {@link TeamsAddOnInactiveError} unless the tenant's Teams add-on is active.
 * Use where callers currently branch on {@link tenantHasTeamsAddOn} and need a
 * typed failure carrying the distinguishing state.
 */
export async function assertTeamsAddOn(knex: any, tenantId: string): Promise<void> {
  const state = await getTeamsAddOnState(knex, tenantId);
  if (state !== 'active') {
    throw new TeamsAddOnInactiveError(state);
  }
}
