import { ADD_ONS } from '@alga-psa/types';
import {
  disabledTeamsAvailability,
  resolveTeamsAvailability,
} from './teamsAvailabilityCore';
import type {
  GetTeamsAvailabilityInput,
  TeamsAvailability,
} from './teamsAvailabilityCore';

export {
  isTeamsEnterpriseEdition,
  resolveTeamsAvailability,
  TEAMS_AVAILABILITY_MESSAGES,
} from './teamsAvailabilityCore';
export type {
  GetTeamsAvailabilityInput,
  ResolveTeamsAvailabilityInput,
  TeamsAvailability,
  TeamsAvailabilityDisabledReason,
} from './teamsAvailabilityCore';

async function tenantHasTeamsAddOn(tenantId: string): Promise<boolean> {
  const { createTenantKnex } = await import('@alga-psa/db');
  const { knex } = await createTenantKnex(tenantId);
  const row = await knex('tenant_addons')
    .where({ tenant: tenantId, addon_key: ADD_ONS.TEAMS })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

export async function getTeamsAvailability(input: GetTeamsAvailabilityInput = {}): Promise<TeamsAvailability> {
  const baseAvailability = resolveTeamsAvailability(input);
  if (baseAvailability.enabled === false) {
    return baseAvailability;
  }

  const tenantId = (input.tenantId || '').trim();
  if (tenantId && !(await tenantHasTeamsAddOn(tenantId))) {
    return disabledTeamsAvailability('addon_required');
  }

  return baseAvailability;
}
