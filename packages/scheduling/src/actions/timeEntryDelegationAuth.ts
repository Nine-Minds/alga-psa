'use server';

import type { IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';
import { tenantDb, User } from '@alga-psa/db';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationEvaluationInput,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

export type DelegationScope = 'self' | 'tenant-wide' | 'manager';

async function resolveBundleRulesOrThrow(
  db: Knex | Knex.Transaction,
  input: AuthorizationEvaluationInput,
  permissionDeniedMessage: string
) {
  try {
    return await resolveBundleNarrowingRulesForEvaluation(db, input);
  } catch (error) {
    console.error('Failed to resolve time delegation bundle rules', error);
    throw new Error(permissionDeniedMessage);
  }
}

export async function isManagerOfSubject(
  db: Knex | Knex.Transaction,
  tenant: string,
  actorUserId: string,
  subjectUserId: string
): Promise<boolean> {
  const scopedDb = tenantDb(db, tenant);
  const query = scopedDb.table('teams')
    .where({
      'teams.manager_id': actorUserId,
      'team_members.user_id': subjectUserId
    })
    .first('teams.team_id');
  scopedDb.tenantJoin(query, 'team_members', 'teams.team_id', 'team_members.team_id');
  const row = await query;

  return !!row;
}

export async function resolveManagedSubjectUserIds(
  db: Knex | Knex.Transaction,
  tenant: string,
  actor: IUser
): Promise<string[]> {
  const scopedDb = tenantDb(db, tenant);
  const teamRows = await scopedDb.table('teams')
    .where({
      'teams.manager_id': actor.user_id,
    })
    .modify((query) => {
      scopedDb.tenantJoin(query, 'team_members', 'teams.team_id', 'team_members.team_id');
    })
    .select<{ user_id: string }[]>('team_members.user_id');

  const managedIds = new Set(teamRows.map((row) => row.user_id));

  const reportsToUserIds = await User.getReportsToSubordinateIds(db, actor.user_id);
  for (const userId of reportsToUserIds) {
    managedIds.add(userId);
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
  const managedUserIds = canReadAll ? [] : await resolveManagedSubjectUserIds(db, tenant, actor);
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
      relationshipRules: canReadAll ? [] : [{ template: 'managed' }],
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) =>
        resolveBundleRulesOrThrow(db, input, 'Permission denied: Cannot access other users time sheets'),
    }),
    rbacEvaluator: async () => true,
  });

  const decision = await authorizationKernel.authorizeResource({
    subject: authorizationSubject,
    resource: {
      type: 'time_entry',
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
    if (managedUserIds.includes(subjectUserId)) {
      return 'manager';
    }
    if (canReadAll) {
      return 'tenant-wide';
    }
    return 'manager';
  }

  throw new Error('Permission denied: Cannot access other users time sheets');
}

export async function assertCanApproveSubject(
  actor: IUser,
  tenant: string,
  subjectUserId: string,
  db: Knex | Knex.Transaction
): Promise<DelegationScope> {
  const scope = await assertCanActOnBehalf(actor, tenant, subjectUserId, db);
  const managedUserIds = scope === 'tenant-wide' ? [] : await resolveManagedSubjectUserIds(db, tenant, actor);

  const subject: AuthorizationSubject = {
    tenant,
    userId: actor.user_id,
    userType: actor.user_type,
    clientId: actor.clientId ?? null,
    roleIds: [],
    teamIds: [],
    managedUserIds,
    portfolioClientIds: actor.clientId ? [actor.clientId] : [],
  };

  const approvalKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) =>
        resolveBundleRulesOrThrow(db, input, 'Permission denied: Cannot approve time submissions'),
    }),
    rbacEvaluator: async () => true,
  });

  const approvalDecision = await approvalKernel.authorizeMutation({
    subject,
    resource: {
      type: 'time_entry',
      action: 'approve',
      id: subjectUserId,
    },
    record: {
      id: subjectUserId,
      ownerUserId: subjectUserId,
    },
    mutation: {
      kind: 'approve',
      record: {
        id: subjectUserId,
        ownerUserId: subjectUserId,
      },
    },
    requestCache: new RequestLocalAuthorizationCache(),
    knex: db,
  });

  if (!approvalDecision.allowed) {
    throw new Error('Permission denied: Cannot approve your own time submissions');
  }

  return scope;
}
