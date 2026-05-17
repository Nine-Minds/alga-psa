'use server';

import { isEnterprise } from '@alga-psa/core/features';
import { createTenantKnex } from '@alga-psa/db';
import { ADD_ONS } from '@alga-psa/types';

type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';

interface TeamsMeetingCapabilityRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: TeamsInstallStatus;
  default_meeting_organizer_upn: string | null;
}

export type TeamsMeetingCapabilityReason = 'ee_disabled' | 'addon_required' | 'not_configured' | 'no_organizer';

export interface TeamsMeetingCapabilityResult {
  available: boolean;
  reason?: TeamsMeetingCapabilityReason;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function tenantHasTeamsAddOn(knex: any, tenantId: string): Promise<boolean> {
  const row = await knex('tenant_addons')
    .where({ tenant: tenantId, addon_key: ADD_ONS.TEAMS })
    .andWhere((builder: any) => {
      builder.whereNull('expires_at').orWhere('expires_at', '>', knex.fn.now());
    })
    .first('addon_key');

  return Boolean(row);
}

export async function getTeamsMeetingCapability(
  tenantId: string
): Promise<TeamsMeetingCapabilityResult> {
  if (!isEnterprise) {
    return { available: false, reason: 'ee_disabled' };
  }

  const { knex } = await createTenantKnex(tenantId);
  if (!(await tenantHasTeamsAddOn(knex, tenantId))) {
    return { available: false, reason: 'addon_required' };
  }

  const integration = await knex<TeamsMeetingCapabilityRow>('teams_integrations')
    .where({ tenant: tenantId })
    .first();

  if (!integration || integration.install_status !== 'active' || !integration.selected_profile_id) {
    return { available: false, reason: 'not_configured' };
  }

  if (!normalizeString(integration.default_meeting_organizer_upn)) {
    return { available: false, reason: 'no_organizer' };
  }

  return { available: true };
}
