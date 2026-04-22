'use server';

import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import { User } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationSubject,
} from 'server/src/lib/authorization/kernel';

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

export async function resolveManagedSubjectUserIds(
  db: Knex | Knex.Transaction,
  tenant: string,
  actor: IUser
): Promise<string[]> {
  const teamRows = await db('teams')
    .join('team_members', function joinTeamMembers() {
      this.on('teams.team_id', '=', 'team_members.team_id').andOn('teams.tenant', '=', 'team_members.tenant');
    })
    .where({
      'teams.tenant': tenant,
      'teams.manager_id': actor.user_id,
    })
    .select<{ user_id: string }[]>('team_members.user_id');

  const managedIds = new Set(teamRows.map((row) => row.user_id));

  const reportsToEnabled = await isFeatureFlagEnabled('teams-v2', {
    userId: actor.user_id,
    tenantId: tenant
  });
  if (reportsToEnabled) {
    const reportsToUserIds = await User.getReportsToSubordinateIds(db, actor.user_id);
    for (const userId of reportsToUserIds) {
      managedIds.add(userId);
    }
  }

  return Array.from(managedIds);
}

export async function assertCanActOnBehalf(
  actor: IUser,
  tenant: string,
  subjectUserId: string,
  db: Knex | Knex.Transaction
): Promise<DelegationScope> {
  // Delegation policy:
  // - self: always allowed
  // - otherwise: require `timesheet:approve` AND (`timesheet:read_all` OR manager-of-subject)
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

  const managedUserIds = await resolveManagedSubjectUserIds(db, tenant, actor);
  const authorizationSubject: AuthorizationSubject = {
    tenant,
    userId: actor.user_id,
    userType: actor.user_type,
    clientId: actor.clientId ?? null,
    roleIds: [],
    teamIds: [],
    managedUserIds,
    portfolioClientIds: actor.clientId ? [actor.clientId] : [],
  };

  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules: [{ template: 'managed' }],
    }),
    rbacEvaluator: async () => true,
  });

  const decision = await authorizationKernel.authorizeResource({
    subject: authorizationSubject,
    resource: {
      type: 'timesheet',
      action: 'read',
      id: subjectUserId,
    },
    record: {
      id: subjectUserId,
      ownerUserId: subjectUserId,
      assignedUserIds: [subjectUserId],
    },
    requestCache: new RequestLocalAuthorizationCache(),
    knex: db,
  });

  if (decision.allowed) {
    return 'manager';
  }

  throw new Error('Permission denied: Cannot access other users time sheets');
}
