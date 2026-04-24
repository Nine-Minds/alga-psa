'use server';

import { isEnterprise } from '@alga-psa/core/features';
import { createTenantKnex } from '@alga-psa/db';

type TeamsInstallStatus = 'not_configured' | 'install_pending' | 'active' | 'error';

interface TeamsMeetingCapabilityRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: TeamsInstallStatus;
  default_meeting_organizer_upn: string | null;
}

export type TeamsMeetingCapabilityReason = 'ee_disabled' | 'not_configured' | 'no_organizer';

export interface TeamsMeetingCapabilityResult {
  available: boolean;
  reason?: TeamsMeetingCapabilityReason;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function getTeamsMeetingCapability(
  tenantId: string
): Promise<TeamsMeetingCapabilityResult> {
  if (!isEnterprise) {
    return { available: false, reason: 'ee_disabled' };
  }

  const { knex } = await createTenantKnex(tenantId);
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
