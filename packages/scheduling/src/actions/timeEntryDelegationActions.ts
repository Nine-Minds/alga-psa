'use server';

import type { IUser } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';

function sortUsersByName(users: IUser[]): IUser[] {
  return [...users].sort((a, b) => {
    const aLast = (a.last_name ?? '').toLowerCase();
    const bLast = (b.last_name ?? '').toLowerCase();
    if (aLast !== bLast) return aLast.localeCompare(bLast);

    const aFirst = (a.first_name ?? '').toLowerCase();
    const bFirst = (b.first_name ?? '').toLowerCase();
    if (aFirst !== bFirst) return aFirst.localeCompare(bFirst);

    return a.email.toLowerCase().localeCompare(b.email.toLowerCase());
  });
}

function pickUserRow(row: any): IUser {
  return {
    user_id: row.user_id,
    username: row.username,
    first_name: row.first_name ?? undefined,
    last_name: row.last_name ?? undefined,
    email: row.email,
    is_inactive: row.is_inactive,
    tenant: row.tenant,
    user_type: row.user_type,
    timezone: row.timezone ?? undefined
  };
}

export const fetchEligibleTimeEntrySubjects = withAuth(async (user, { tenant }): Promise<IUser[]> => {
  const { knex: db } = await createTenantKnex();

  const subjectsById = new Map<string, IUser>();
  subjectsById.set(user.user_id, user);

  const canApprove = await hasPermission(user, 'timesheet', 'approve', db);
  if (!canApprove) {
    return sortUsersByName(Array.from(subjectsById.values()));
  }

  const canReadAll = await hasPermission(user, 'timesheet', 'read_all', db);

  if (canReadAll) {
    const rows = await db('users')
      .where({ tenant, user_type: 'internal' })
      .select('user_id', 'username', 'first_name', 'last_name', 'email', 'is_inactive', 'tenant', 'user_type', 'timezone');

    for (const row of rows) {
      subjectsById.set(row.user_id, pickUserRow(row));
    }

    return sortUsersByName(Array.from(subjectsById.values()));
  }

  const rows = await db('teams')
    .join('team_members', function joinTeamMembers() {
      this.on('teams.team_id', '=', 'team_members.team_id').andOn('teams.tenant', '=', 'team_members.tenant');
    })
    .join('users', function joinUsers() {
      this.on('team_members.user_id', '=', 'users.user_id').andOn('team_members.tenant', '=', 'users.tenant');
    })
    .where({
      'teams.tenant': tenant,
      'teams.manager_id': user.user_id,
      'users.user_type': 'internal'
    })
    .distinct('users.user_id', 'users.username', 'users.first_name', 'users.last_name', 'users.email', 'users.is_inactive', 'users.tenant', 'users.user_type', 'users.timezone');

  for (const row of rows) {
    subjectsById.set(row.user_id, pickUserRow(row));
  }

  return sortUsersByName(Array.from(subjectsById.values()));
});

