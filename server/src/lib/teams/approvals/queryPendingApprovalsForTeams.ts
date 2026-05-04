import { createTenantKnex, User } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import { hasPermission } from 'server/src/lib/auth/rbac';

export interface TeamsPendingApprovalRecord {
  id: string;
  approval_status: string | null;
  first_name: string | null;
  last_name: string | null;
  period_start_date: string | null;
  period_end_date: string | null;
}

export async function listPendingApprovalsForTeams(params: {
  tenantId: string;
  user: IUserWithRoles;
  limit: number;
  query?: string;
}): Promise<TeamsPendingApprovalRecord[]> {
  const { knex } = await createTenantKnex(params.tenantId);
  const canReadAll = await hasPermission(params.user, 'timesheet', 'read_all', knex);
  const normalizedQuery = params.query?.trim();

  let query = knex('time_sheets')
    .join('users', function joinUsers() {
      this.on('time_sheets.user_id', '=', 'users.user_id').andOn('time_sheets.tenant', '=', 'users.tenant');
    })
    .join('time_periods', function joinPeriods() {
      this.on('time_sheets.period_id', '=', 'time_periods.period_id').andOn('time_sheets.tenant', '=', 'time_periods.tenant');
    })
    .where('time_sheets.tenant', params.tenantId)
    .whereIn('time_sheets.approval_status', ['SUBMITTED', 'CHANGES_REQUESTED'])
    .select(
      'time_sheets.id',
      'time_sheets.approval_status',
      'users.first_name',
      'users.last_name',
      'time_periods.start_date as period_start_date',
      'time_periods.end_date as period_end_date'
    )
    .orderBy('time_sheets.submitted_at', 'asc')
    .limit(params.limit);

  if (normalizedQuery) {
    query = query.where((builder) => {
      builder
        .whereILike('time_sheets.id', `%${normalizedQuery}%`)
        .orWhereILike('users.first_name', `%${normalizedQuery}%`)
        .orWhereILike('users.last_name', `%${normalizedQuery}%`)
        .orWhere(knex.raw(`CONCAT(users.first_name, ' ', users.last_name)`), 'ilike', `%${normalizedQuery}%`);
    });
  }

  if (!canReadAll) {
    const reportsToUserIds = await User.getReportsToSubordinateIds(knex, params.user.user_id);

    query = query
      .where((builder) => {
        builder.whereExists(function managerScope() {
          this.select(1)
            .from('team_members')
            .join('teams', function joinTeams() {
              this.on('team_members.team_id', '=', 'teams.team_id').andOn('team_members.tenant', '=', 'teams.tenant');
            })
            .where('team_members.user_id', knex.ref('users.user_id'))
            .andWhere('teams.manager_id', params.user.user_id)
            .andWhere('teams.tenant', params.tenantId);
        });

        if (reportsToUserIds.length > 0) {
          builder.orWhereIn('users.user_id', reportsToUserIds);
        }
      })
      .distinct();
  }

  return (await query) as TeamsPendingApprovalRecord[];
}
