'use server';

import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';

export type DelegationScope = 'self' | 'tenant-wide' | 'manager';

export async function isManagerOfSubject(
  db: Knex | Knex.Transaction,
  tenant: string,
  actorUserId: string,
  subjectUserId: string
): Promise<boolean> {
  const row = await db('teams')
    .join('team_members', function joinTeamMembers() {
      this.on('teams.team_id', '=', 'team_members.team_id').andOn('teams.tenant', '=', 'team_members.tenant');
    })
    .where({
      'teams.tenant': tenant,
      'teams.manager_id': actorUserId,
      'team_members.user_id': subjectUserId
    })
    .first('teams.team_id');

  return !!row;
}

export async function assertCanActOnBehalf(
  actor: IUser,
  tenant: string,
  subjectUserId: string,
  db: Knex | Knex.Transaction
): Promise<DelegationScope> {
  if (actor.user_id === subjectUserId) {
    return 'self';
  }

  const canApprove = await hasPermission(actor, 'timesheet', 'approve', db);
  if (!canApprove) {
    throw new Error('Permission denied: Cannot access other users time sheets');
  }

  const canReadAll = await hasPermission(actor, 'timesheet', 'read_all', db);
  if (canReadAll) {
    return 'tenant-wide';
  }

  if (await isManagerOfSubject(db, tenant, actor.user_id, subjectUserId)) {
    return 'manager';
  }

  throw new Error('Permission denied: Cannot access other users time sheets');
}
