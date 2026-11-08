import { createTenantKnex } from '@alga-psa/db';
import { CapabilityUnavailableError } from '@alga-psa/core/capability/server';
import { forcedValue } from '@alga-psa/core/capability';
import { resolveCoManagedUpgradeAccess } from '@alga-psa/co-managed';

/** Upgrade admission also serves former customers, whose completion receipt survives participation.
 * Keep the kill switch ahead of connection acquisition; the domain gate checks the release flag,
 * relationship, closure wiring and completion receipt before returning an open state. */
export async function requireCoManagedUpgradeAccess(tenant: string) {
  const forced = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  if (forced === 'off' || forced === 'malformed') throw new CapabilityUnavailableError();
  const { knex } = await createTenantKnex(tenant);
  const access = await resolveCoManagedUpgradeAccess(knex, tenant);
  if (access === 'closed') throw new CapabilityUnavailableError();
  return { knex, access };
}

/** Mutations require a current customer; completed former customers only retain read access. */
export async function requireCoManagedUpgradeCustomer(tenant: string) {
  const context = await requireCoManagedUpgradeAccess(tenant);
  if (context.access !== 'customer') throw new CapabilityUnavailableError();
  return context;
}
