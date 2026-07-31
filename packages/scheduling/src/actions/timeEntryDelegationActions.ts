'use server';

import type { IUser } from '@alga-psa/types';
import { createTenantKnex, tenantDb, User } from '@alga-psa/db';
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
  const scopedDb = tenantDb(db, tenant) as any;

  const subjectsById = new Map<string, IUser>();
  subjectsById.set(user.user_id, user);

  const canApprove = await hasPermission(user, 'timesheet', 'approve', db);
  if (!canApprove) {
    return sortUsersByName(Array.from(subjectsById.values()));
  }

  const canReadAll = await hasPermission(user, 'timesheet', 'read_all', db);

  if (canReadAll) {
    const rows = await scopedDb.table('users')
      .where({ user_type: 'internal' })
      .select('user_id', 'username', 'first_name', 'last_name', 'email', 'is_inactive', 'tenant', 'user_type', 'timezone');

    for (const row of rows) {
      subjectsById.set(row.user_id, pickUserRow(row));
    }

    return sortUsersByName(Array.from(subjectsById.values()));
  }

  const rowsQuery = scopedDb.table('teams')
    .where({
      'teams.manager_id': user.user_id,
      'users.user_type': 'internal'
    })
    .distinct('users.user_id', 'users.username', 'users.first_name', 'users.last_name', 'users.email', 'users.is_inactive', 'users.tenant', 'users.user_type', 'users.timezone');
  scopedDb.tenantJoin(rowsQuery, 'team_members', 'teams.team_id', 'team_members.team_id');
  scopedDb.tenantJoin(rowsQuery, 'users', 'team_members.user_id', 'users.user_id');
  const rows = await rowsQuery;

  for (const row of rows) {
    subjectsById.set(row.user_id, pickUserRow(row));
  }

  const subordinateIds = await User.getReportsToSubordinateIds(db, user.user_id);
  if (subordinateIds.length > 0) {
    const subordinateRows = await scopedDb.table('users')
      .whereIn('user_id', subordinateIds)
      .where({ user_type: 'internal' })
      .select('user_id', 'username', 'first_name', 'last_name', 'email', 'is_inactive', 'tenant', 'user_type', 'timezone');

    for (const row of subordinateRows) {
      subjectsById.set(row.user_id, pickUserRow(row));
    }
  }

  return sortUsersByName(Array.from(subjectsById.values()));
});
