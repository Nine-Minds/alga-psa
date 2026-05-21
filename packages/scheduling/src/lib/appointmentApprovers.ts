import type { Knex } from 'knex';

/**
 * Shared helpers for resolving who should approve / be notified about appointment
 * requests. Appointment approvers are configured in `availability_settings.config_json`
 * and support multiple users plus teams (teams are expanded to their current members).
 *
 * Backwards compatibility: older configs stored a single `default_approver_id`. When the
 * new array fields are absent we fall back to that single value.
 */

export interface ApproverConfigJson {
  approver_user_ids?: string[];
  approver_team_ids?: string[];
  /** @deprecated legacy single-approver field, kept for backwards compatibility */
  default_approver_id?: string;
  [key: string]: unknown;
}

/**
 * Extract the configured approver user IDs and team IDs from a `config_json` blob,
 * falling back to the legacy single `default_approver_id` when the arrays are empty.
 */
export function readApproverIdsFromConfig(
  config: ApproverConfigJson | null | undefined
): { userIds: string[]; teamIds: string[] } {
  if (!config) {
    return { userIds: [], teamIds: [] };
  }

  const userIds = Array.isArray(config.approver_user_ids)
    ? config.approver_user_ids.filter((id): id is string => Boolean(id))
    : [];
  const teamIds = Array.isArray(config.approver_team_ids)
    ? config.approver_team_ids.filter((id): id is string => Boolean(id))
    : [];

  // Legacy single-approver fallback (only when no multi-approver config is present)
  if (userIds.length === 0 && teamIds.length === 0 && config.default_approver_id) {
    userIds.push(config.default_approver_id);
  }

  return { userIds, teamIds };
}

/** Expand a set of team IDs into the user IDs of their current members. */
export async function expandTeamsToUserIds(
  trx: Knex | Knex.Transaction,
  tenant: string,
  teamIds: string[]
): Promise<string[]> {
  if (!teamIds.length) {
    return [];
  }

  const members = await trx('team_members')
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
  if (preferredTechnicianId) {
    const userSetting = await trx('availability_settings')
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
    const generalSetting = await trx('availability_settings')
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

  const activeUsers = await trx('users')
    .where({ tenant, user_type: 'internal' })
    .whereIn('user_id', candidateIds)
    .where(function (this: Knex.QueryBuilder) {
      this.where('is_inactive', false).orWhereNull('is_inactive');
    })
    .select('user_id');

  return activeUsers.map((u: { user_id: string }) => u.user_id);
}
