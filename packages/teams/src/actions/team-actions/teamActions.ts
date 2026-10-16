'use server'

import Team from '../../models/team';
import type { DeletionValidationResult, IRole, ITeam, ITeamMember, IUser, IUserWithRoles } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { permissionError, type ActionMessageError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { teamActionErrorFrom, type TeamActionError } from './teamActionErrors';

export type TeamMutationResult = ITeam | ActionMessageError | ActionPermissionError;
export type TeamReadResult = ITeam | TeamActionError;
export type TeamsReadResult = ITeam[] | TeamActionError;
export type TeamsBasicReadResult = Omit<ITeam, 'members'>[] | TeamActionError;

async function getUsersWithRoles(
  trx: Knex | Knex.Transaction,
  tenant: string,
  members: Array<{ user_id: string; role: 'member' | 'lead' }>,
): Promise<ITeamMember[]> {
  if (members.length === 0) {
    return [];
  }

  const userIds = members.map((member) => member.user_id);
  const db = tenantDb(trx, tenant);
  const users = await db.table<IUser>('users')
    .select('*')
    .whereIn('user_id', userIds);

  const rolesQuery = db.table<IRole>('roles');
  db.tenantJoin(rolesQuery, 'user_roles', 'roles.role_id', 'user_roles.role_id');

  const roles = await rolesQuery
    .whereIn('user_roles.user_id', userIds)
    .select('roles.*', 'user_roles.user_id as user_id');

  const rolesByUser = new Map<string, IRole[]>();
  for (const row of roles as any[]) {
    const userId = row.user_id as string;
    const role: IRole = { ...(row as any) };
    delete (role as any).user_id;
    const list = rolesByUser.get(userId) ?? [];
    list.push(role);
    rolesByUser.set(userId, list);
  }

  const roleByUser = new Map(members.map((member) => [member.user_id, member.role]));

  return users.map((user) => ({
    ...(user as any),
    roles: rolesByUser.get(user.user_id) ?? [],
    role: roleByUser.get(user.user_id) ?? 'member',
  }));
}

/**
 * Point a team at a new lead, or clear the lead (`null` = "Not assigned").
 * Keeps teams.manager_id and team_members.role in step: every previous lead is
 * demoted to 'member' (clearing the lead keeps everyone as members), and a new
 * lead is added to the team if they are not already on it.
 */
async function applyTeamLead(
  trx: Knex.Transaction,
  tenant: string,
  teamId: string,
  managerId: string | null,
): Promise<void> {
  const db = tenantDb(trx, tenant);

  await Team.update(trx, tenant, teamId, { manager_id: managerId });

  await db.table('team_members')
    .where({ team_id: teamId, role: 'lead' })
    .update({ role: 'member' });

  if (!managerId) {
    return;
  }

  const existingMember = await db.table('team_members')
    .where({ team_id: teamId, user_id: managerId })
    .first();
  if (existingMember) {
    await db.table('team_members')
      .where({ team_id: teamId, user_id: managerId })
      .update({ role: 'lead' });
  } else {
    await Team.addMember(trx, tenant, teamId, managerId, 'lead');
  }
}

export const createTeam = withAuth(async (user, { tenant }, teamData: Omit<ITeam, 'members'> & { members?: IUserWithRoles[] }): Promise<TeamMutationResult> => {
  const { knex: db } = await createTenantKnex();
  const canCreate = await hasPermission(user, 'user_settings', 'create', db);
  if (!canCreate) {
    return permissionError('Permission denied: cannot create team.', 'msp/settings:errors.teams.permissions.create');
  }

  try {
    // Extract members from teamData
    const { members, ...teamDataWithoutMembers } = teamData;

    // If no manager_id is provided and there are members, use the first member as manager
    if (!teamDataWithoutMembers.manager_id && members && members.length > 0) {
      teamDataWithoutMembers.manager_id = members[0].user_id;
    } else if (!teamDataWithoutMembers.manager_id) {
      throw new Error('A team must have a manager. Please specify a manager_id or provide at least one team member.');
    }

    const createdTeam = await withTransaction(db, async (trx: Knex.Transaction) => {
      // Create the team first
      const team = await Team.create(trx, tenant, teamDataWithoutMembers);

      // Collect all member IDs including the manager
      const allMemberRoles = new Map<string, 'member' | 'lead'>();

      // Add provided members
      if (members && members.length > 0) {
        members.forEach(member => allMemberRoles.set(member.user_id, 'member'));
      }

      // Add manager as a member if specified
      if (teamDataWithoutMembers.manager_id) {
        allMemberRoles.set(teamDataWithoutMembers.manager_id, 'lead');
      }

      // Add all members to the team
      if (allMemberRoles.size > 0) {
        await Promise.all(
          Array.from(allMemberRoles.entries()).map(([userId, role]): Promise<void> =>
            Team.addMember(trx, tenant, team.team_id, userId, role)
          )
        );
      }

      return team;
    });

    // Return the complete team with members
    return await getTeamByIdInternal(db, tenant, createdTeam.team_id);
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

// Internal helper function for getting team by ID (used by other actions within the same withAuth context)
async function getTeamByIdInternal(knex: Knex, tenant: string, teamId: string): Promise<ITeam> {
  const team = await Team.get(knex, tenant, teamId);
  if (!team) {
    throw new Error('Team not found');
  }
  const memberEntries = await Team.getMembers(knex, tenant, teamId);
  const members = await getUsersWithRoles(knex, tenant, memberEntries);

  return { ...team, members };
}

export const updateTeam = withAuth(async (user, { tenant }, teamId: string, teamData: Partial<ITeam>): Promise<TeamMutationResult> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    return permissionError('Permission denied: cannot update team.', 'msp/settings:errors.teams.permissions.update');
  }

  try {
    const { manager_id: managerId, members: _members, ...fields } = teamData as Partial<ITeam> & { members?: unknown };
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      if (Object.keys(fields).length > 0) {
        await Team.update(trx, tenant, teamId, fields);
      }
      // `undefined` = leave the lead alone; `null` = Not assigned.
      if (managerId !== undefined) {
        await applyTeamLead(trx, tenant, teamId, managerId);
      }
    });
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const deleteTeam = withAuth(async (
  user,
  { tenant },
  teamId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean }> => {
  const { knex } = await createTenantKnex();
  const canDelete = await hasPermission(user, 'user_settings', 'delete', knex);
  if (!canDelete) {
    return {
      success: false,
      canDelete: false,
      code: 'PERMISSION_DENIED',
      message: 'Permission denied: cannot delete team.',
      dependencies: [],
      alternatives: []
    };
  }

  try {

    const result = await deleteEntityWithValidation('team', teamId, knex, tenant, async (trx, tenantId) => {
      // Calendar shares granted to the team (polymorphic grantee, no FK).
      await tenantDb(trx, tenantId).table('calendar_shares')
        .where({ grantee_type: 'team', grantee_id: teamId })
        .del();
      await Team.delete(trx, tenantId, teamId);
    });

    return {
      ...result,
      success: result.deleted === true,
      deleted: result.deleted
    };
  } catch (error) {
    console.error(error);
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: 'Failed to delete team',
      dependencies: [],
      alternatives: []
    };
  }
});

export const addUserToTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<TeamMutationResult> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    return permissionError('Permission denied: cannot modify team members.', 'msp/settings:errors.teams.permissions.modifyMembers');
  }

  try {
    await Team.addMember(knex, tenant, teamId, userId);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const removeUserFromTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<TeamMutationResult> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    return permissionError('Permission denied: cannot modify team members.', 'msp/settings:errors.teams.permissions.modifyMembers');
  }

  try {
    // Prevent removing the team manager without reassigning
    const team = await Team.get(knex, tenant, teamId);
    if (team && team.manager_id === userId) {
      throw new Error('Cannot remove the team lead. Please assign a new team lead first.');
    }

    await Team.removeMember(knex, tenant, teamId, userId);
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error: any) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getTeamById = withAuth(async (user, { tenant }, teamId: string): Promise<TeamReadResult> => {
  const { knex } = await createTenantKnex();
  const canRead = await hasPermission(user, 'user_settings', 'read', knex);
  if (!canRead) {
    return permissionError('Permission denied: cannot view team.', 'msp/settings:errors.teams.permissions.view');
  }

  try {
    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

/**
 * Lightweight version of getTeams — returns team rows without loading members.
 * Use when you only need team_id, team_name, manager_id (e.g., for display badges).
 */
export const getTeamsBasic = withAuth(async (user, { tenant }): Promise<TeamsBasicReadResult> => {
  const { knex } = await createTenantKnex();
  const canRead = await hasPermission(user, 'user_settings', 'read', knex);
  if (!canRead) {
    return permissionError('Permission denied: cannot view teams.', 'msp/settings:errors.teams.permissions.viewAll');
  }

  try {
    return await Team.getAll(knex, tenant);
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const getTeams = withAuth(async (user, { tenant }): Promise<TeamsReadResult> => {
  const { knex } = await createTenantKnex();
  const canRead = await hasPermission(user, 'user_settings', 'read', knex);
  if (!canRead) {
    return permissionError('Permission denied: cannot view teams.', 'msp/settings:errors.teams.permissions.viewAll');
  }

  try {
    const teams = await Team.getAll(knex, tenant);
    const teamsWithMembers = await Promise.all(teams.map(async (team): Promise<ITeam> => {
      const memberEntries = await Team.getMembers(knex, tenant, team.team_id);
      const members = await getUsersWithRoles(knex, tenant, memberEntries);
      return { ...team, members };
    }));
    return teamsWithMembers;
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export interface TeamChanges {
  /** New lead's user id, `null` for "Not assigned", or omitted to leave the lead unchanged. */
  managerId?: string | null;
  addUserIds: string[];
  removeUserIds: string[];
}

export const saveTeamChanges = withAuth(async (user, { tenant }, teamId: string, changes: TeamChanges): Promise<TeamMutationResult> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    return permissionError('Permission denied: cannot modify team.', 'msp/settings:errors.teams.permissions.modify');
  }

  try {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

      // Read the lead as it is *before* this save so removals are judged against
      // the lead the user is looking at, not the one this save is about to set.
      // This also rejects promoting a user to lead and removing them in the same
      // save, which would leave manager_id pointing at a non-member.
      const currentTeam = await Team.get(trx, tenant, teamId);
      if (!currentTeam) {
        throw new Error('Team not found');
      }
      const leadAfterSave = changes.managerId === undefined ? currentTeam.manager_id : changes.managerId;
      if (changes.removeUserIds.length > 0 && leadAfterSave && changes.removeUserIds.includes(leadAfterSave)) {
        throw new Error('Cannot remove the team lead. Please assign a new team lead first.');
      }

      if (changes.managerId !== undefined) {
        await applyTeamLead(trx, tenant, teamId, changes.managerId);
      }

      // Batch remove members
      if (changes.removeUserIds.length > 0) {
        await db.table('team_members')
          .where({ team_id: teamId })
          .whereIn('user_id', changes.removeUserIds)
          .del();
      }

      // Batch add members (with inactive user validation)
      if (changes.addUserIds.length > 0) {
        const activeUsers = await db.table('users')
          .select('user_id')
          .where({ is_inactive: false })
          .whereIn('user_id', changes.addUserIds);

        const activeUserIds = new Set(activeUsers.map((u: { user_id: string }) => u.user_id));
        const inactiveIds = changes.addUserIds.filter(id => !activeUserIds.has(id));
        if (inactiveIds.length > 0) {
          throw new Error('Cannot add inactive users to team');
        }

        await db.table('team_members').insert(
          changes.addUserIds.map(userId => ({
            team_id: teamId,
            user_id: userId,
            tenant,
            role: 'member' as const,
          }))
        );
      }
    });

    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const assignManagerToTeam = withAuth(async (user, { tenant }, teamId: string, userId: string): Promise<TeamMutationResult> => {
  const { knex } = await createTenantKnex();
  const canUpdate = await hasPermission(user, 'user_settings', 'update', knex);
  if (!canUpdate) {
    return permissionError('Permission denied: cannot assign team manager.', 'msp/settings:errors.teams.permissions.assignManager');
  }

  try {

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

      // Update team manager
      await Team.update(trx, tenant, teamId, { manager_id: userId });

      // Demote any existing leads to 'member'
      await db.table('team_members')
        .where({ team_id: teamId, role: 'lead' })
        .update({ role: 'member' });

      // Add or promote the new manager
      const existingMember = await db.table('team_members')
        .where({ team_id: teamId, user_id: userId })
        .first();
      if (existingMember) {
        await db.table('team_members')
          .where({ team_id: teamId, user_id: userId })
          .update({ role: 'lead' });
      } else {
        await Team.addMember(trx, tenant, teamId, userId, 'lead');
      }
    });

    return await getTeamByIdInternal(knex, tenant, teamId);
  } catch (error) {
    console.error(error);
    const expected = teamActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
