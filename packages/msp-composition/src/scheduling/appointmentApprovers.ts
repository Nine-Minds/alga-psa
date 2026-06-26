import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  readApproverIdsFromConfig,
  type ApproverConfigJson,
} from '@alga-psa/scheduling/lib/appointmentApprovers';

/**
 * Cross-feature resolution of who should approve / be notified about appointment
 * requests. This lives in the composition layer because it joins the scheduling
 * feature's approver config (`availability_settings`) with the teams and users
 * features — composing across feature packages without creating feature-to-feature
 * imports.
 */

/** Expand a set of team IDs into the user IDs of their current members. */
export async function expandTeamsToUserIds(
  trx: Knex | Knex.Transaction,
  tenant: string,
  teamIds: string[]
): Promise<string[]> {
  if (!teamIds.length) {
    return [];
  }

  const members = await tenantDb(trx, tenant).table('team_members')
    .where({ tenant })
    .whereIn('team_id', teamIds)
    .select('user_id');

  return members.map((m: { user_id: string }) => m.user_id).filter(Boolean);
}

/**
 * Resolve the set of active, internal user IDs that should approve / be notified for an
 * appointment request.
 *
 * - When a preferred technician has approvers configured on their own (`user_hours`)
 *   setting, those override the company-wide approvers for that request.
 * - Otherwise the company-wide (`general_settings`) approvers are used.
 * - Configured teams are expanded to their current members.
 * - Inactive and non-internal users are filtered out.
 */
export async function resolveAppointmentApproverUserIds(
  trx: Knex | Knex.Transaction,
  tenant: string,
  options?: { preferredTechnicianId?: string | null }
): Promise<string[]> {
  const preferredTechnicianId = options?.preferredTechnicianId || null;

  let config: ApproverConfigJson | null = null;

  // Per-technician override takes precedence when it actually configures approvers.
  const scopedDb = tenantDb(trx, tenant);
  if (preferredTechnicianId) {
    const userSetting = await scopedDb.table('availability_settings')
      .where({ tenant, setting_type: 'user_hours', user_id: preferredTechnicianId })
      .whereNotNull('config_json')
      .first();

    const candidate = (userSetting?.config_json as ApproverConfigJson | undefined) ?? null;
    const { userIds, teamIds } = readApproverIdsFromConfig(candidate);
    if (userIds.length || teamIds.length) {
      config = candidate;
    }
  }

  // Company-wide fallback.
  if (!config) {
    const generalSetting = await scopedDb.table('availability_settings')
      .where({ tenant, setting_type: 'general_settings' })
      .whereNotNull('config_json')
      .first();
    config = (generalSetting?.config_json as ApproverConfigJson | undefined) ?? null;
  }

  const { userIds, teamIds } = readApproverIdsFromConfig(config);
  const teamMemberIds = await expandTeamsToUserIds(trx, tenant, teamIds);

  const candidateIds = Array.from(new Set([...userIds, ...teamMemberIds].filter(Boolean)));
  if (!candidateIds.length) {
    return [];
  }

  const activeUsers = await scopedDb.table('users')
    .where({ tenant, user_type: 'internal' })
    .whereIn('user_id', candidateIds)
    .where(function (this: Knex.QueryBuilder) {
      this.where('is_inactive', false).orWhereNull('is_inactive');
    })
    .select('user_id');

  return activeUsers.map((u: { user_id: string }) => u.user_id);
}
