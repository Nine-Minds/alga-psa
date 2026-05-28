/**
 * Pure helpers for reading the appointment-approver configuration stored in
 * `availability_settings.config_json`. Appointment approvers support multiple users
 * plus teams (teams are expanded to their current members at resolution time).
 *
 * This module is intentionally free of cross-feature data access so it can live in the
 * scheduling feature package. The cross-feature resolution that expands teams and filters
 * users lives in the composition layer (`@alga-psa/msp-composition/scheduling/appointmentApprovers`).
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
